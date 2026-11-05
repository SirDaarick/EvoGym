"""Tests for Phase 5 B4: GET /api/v1/sync/roster-delta (T5.6)."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.deps import get_session, get_session_factory
from app.api.sync.bootstrap import router as sync_bootstrap_router
from app.api.sync.delta import router as sync_delta_router
from app.db.base import Base
from app.db.models import Branch, CashRegister, Member, Product, StaffUser, SyncDevice
from app.errors import install_error_handlers
from app.settings import Settings
from app.sync.devices import provision_device


def _app(factory, settings, mock_staff_id, mock_branch_id):
    app = FastAPI()
    install_error_handlers(app)
    app.state.session_factory = factory
    app.state.settings = settings
    app.include_router(sync_bootstrap_router)
    app.include_router(sync_delta_router)

    from app.api.sync import bootstrap as router_module
    router_module._resolve_staff_for_branch = lambda req, creds, b_id: mock_staff_id

    app.dependency_overrides[get_session_factory] = lambda: factory
    def _override_session():
        with factory() as session:
            yield session
    app.dependency_overrides[get_session] = _override_session

    return app


@pytest.fixture
def delta_env(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'delta.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    settings = Settings(environment="test", debug=True, _env_file=None)

    now = datetime.now(timezone.utc)
    t_base = now - timedelta(days=3)
    t_m1 = t_base
    t_m2 = t_base + timedelta(hours=1)
    t_p1 = t_base + timedelta(hours=2)

    with factory.begin() as session:
        branch = Branch(code="sur", name="Sur", timezone="America/Mexico_City", is_active=True)
        staff = StaffUser(login_identifier="staff@example.invalid")
        session.add_all([branch, staff])
        session.flush()

        branch_id = branch.id
        staff_id = staff.id

        # Members
        m1 = Member(
            member_number="1001",
            full_name="Carlos R",
            phone="+525511112222",
            status="active",
            created_at=t_m1,
            updated_at=t_m1,
        )
        m2 = Member(
            member_number="1002",
            full_name="Diana S",
            phone="+525533334444",
            status="active",
            created_at=t_m2,
            updated_at=t_m2,
        )
        session.add_all([m1, m2])
        session.flush()

        m1_id = m1.id
        m2_id = m2.id

        # Product
        p1 = Product(
            code="agua",
            name="Agua 500ml",
            price_minor=1500,
            is_active=True,
            created_by=staff.id,
            updated_at=t_p1,
        )
        session.add(p1)
        session.flush()
        p1_id = p1.id

    app = _app(factory, settings, staff_id, branch_id)
    client = TestClient(app)
    return {
        "client": client,
        "factory": factory,
        "branch_id": branch_id,
        "staff_id": staff_id,
        "m1_id": m1_id,
        "m2_id": m2_id,
        "p1_id": p1_id,
        "t_m1": t_m1,
    }


def test_sync_delta_missing_or_invalid_cursor(delta_env):
    client = delta_env["client"]
    branch_id = str(delta_env["branch_id"])

    # 1. Bootstrap to get device token
    r = client.post(
        "/api/v1/sync/bootstrap",
        json={"station_code": "SUR1"},
        headers={"Authorization": "Bearer fake", "X-Branch-ID": branch_id},
    )
    token = r.json()["device"]["token"]

    # No cursor passed -> snapshot_required
    res = client.get("/api/v1/sync/roster-delta", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["snapshot_required"] is True
    assert data["members"] == []

    # Invalid cursor format -> snapshot_required
    res = client.get("/api/v1/sync/roster-delta?cursor=not-a-valid-cursor", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["snapshot_required"] is True


def test_sync_delta_cursor_older_than_max_age(delta_env):
    client = delta_env["client"]
    branch_id = str(delta_env["branch_id"])

    r = client.post(
        "/api/v1/sync/bootstrap",
        json={"station_code": "SUR1"},
        headers={"Authorization": "Bearer fake", "X-Branch-ID": branch_id},
    )
    token = r.json()["device"]["token"]

    old_dt = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    old_cursor = f"{old_dt}|{delta_env['m1_id']}"
    res = client.get("/api/v1/sync/roster-delta", params={"cursor": old_cursor}, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["snapshot_required"] is True


def test_sync_delta_incremental_changes_and_catalog(delta_env):
    client = delta_env["client"]
    branch_id = delta_env["branch_id"]
    factory = delta_env["factory"]

    r = client.post(
        "/api/v1/sync/bootstrap",
        json={"station_code": "SUR1"},
        headers={"Authorization": "Bearer fake", "X-Branch-ID": str(branch_id)},
    )
    token = r.json()["device"]["token"]

    # Set cursor right at m1's updated_at
    m1_dt = delta_env["t_m1"].isoformat()
    cursor = f"{m1_dt}|{delta_env['m1_id']}"

    res = client.get("/api/v1/sync/roster-delta", params={"cursor": cursor}, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["snapshot_required"] is False
    # m2 has updated_at = t_m2 > t_m1 -> m2 should be returned
    assert len(data["members"]) == 1
    assert data["members"][0]["member_id"] == str(delta_env["m2_id"])
    assert data["removed_member_ids"] == []
    # Catalog was updated after cursor_dt (t_p1 > t_m1)
    assert data["catalog"] is not None

    # Now update a member to inactive (removal)
    with factory.begin() as session:
        m2 = session.get(Member, delta_env["m2_id"])
        m2.status = "inactive"
        m2.updated_at = datetime.now(timezone.utc)

    # Next cursor
    next_c = f"{data['next_cursor']['changed_at']}|{data['next_cursor']['id']}"
    res2 = client.get("/api/v1/sync/roster-delta", params={"cursor": next_c}, headers={"Authorization": f"Bearer {token}"})
    assert res2.status_code == 200
    data2 = res2.json()
    assert str(delta_env["m2_id"]) in data2["removed_member_ids"]
