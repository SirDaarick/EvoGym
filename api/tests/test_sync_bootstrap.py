"""Tests for Phase 5 B4: POST /api/v1/sync/bootstrap and GET /api/v1/sync/status (T5.4, T5.10)."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.deps import get_session, get_session_factory
from app.api.sync.bootstrap import router as sync_bootstrap_router
from app.db.base import Base
from app.db.models import Branch, CashRegister, Member, Product, StaffUser, SyncDevice
from app.errors import install_error_handlers
from app.settings import Settings
from app.sync.devices import get_sync_device, provision_device


def _app(factory, settings, mock_staff_id, mock_branch_id):
    app = FastAPI()
    install_error_handlers(app)
    app.state.session_factory = factory
    app.state.settings = settings
    app.include_router(sync_bootstrap_router)

    # Override staff auth resolver for testing
    from app.api.sync import bootstrap as router_module
    router_module._resolve_staff_for_branch = lambda req, creds, b_id: mock_staff_id

    app.dependency_overrides[get_session_factory] = lambda: factory
    def _override_session():
        with factory() as session:
            yield session
    app.dependency_overrides[get_session] = _override_session

    return app


@pytest.fixture
def sync_env(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'bootstrap.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    settings = Settings(environment="test", debug=True, _env_file=None)

    with factory.begin() as session:
        branch = Branch(code="sur", name="Sur", timezone="America/Mexico_City", is_active=True)
        inactive_branch = Branch(code="ina", name="Inactiva", is_active=False)
        staff = StaffUser(login_identifier="staff@example.invalid")
        session.add_all([branch, inactive_branch, staff])
        session.flush()

        # Seed member
        m1 = Member(
            member_number="1001",
            full_name="Maria Gonzalez",
            phone="+525512345678",
            status="active",
        )
        # Seed product
        p1 = Product(code="p1", name="Agua Natural 600ml", unit="piece", price_minor=1500, is_active=True, created_by=staff.id)
        # Seed register
        reg1 = CashRegister(branch_id=branch.id, code="c1", name="Caja 1", status="active")

        session.add_all([m1, p1, reg1])
        session.flush()

        b_id, inact_id, s_id = branch.id, inactive_branch.id, staff.id

    app = _app(factory, settings, s_id, b_id)
    client = TestClient(app)
    return {"client": client, "branch_id": b_id, "inactive_id": inact_id, "staff_id": s_id, "factory": factory, "settings": settings}


def test_sync_bootstrap_success(sync_env):
    client = sync_env["client"]
    branch_id = str(sync_env["branch_id"])

    res = client.post(
        "/api/v1/sync/bootstrap",
        json={"station_code": "SUR1", "client_schema_version": 1},
        headers={"Authorization": "Bearer fake-token", "X-Branch-ID": branch_id},
    )
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["device"]["device_prefix"] == "REC-SUR1"
    assert data["device"]["next_seq"] == 1
    assert data["device"]["token"]
    assert data["branch"]["id"] == branch_id
    assert data["branch"]["timezone"] == "America/Mexico_City"

    # Verify roster, catalog, registers
    assert len(data["roster"]) == 1
    assert data["roster"][0]["member_number"] == "1001"
    assert data["roster"][0]["phone_last4"] == "5678"
    assert len(data["catalog"]) == 1
    assert data["catalog"][0]["code"] == "p1"
    assert len(data["registers"]) == 1
    assert data["registers"][0]["name"] == "Caja 1"
    assert data["cursor"] is not None


def test_sync_bootstrap_rotate_continues_seq(sync_env):
    client = sync_env["client"]
    branch_id = str(sync_env["branch_id"])

    # 1. First bootstrap
    r1 = client.post(
        "/api/v1/sync/bootstrap",
        json={"station_code": "SUR1"},
        headers={"Authorization": "Bearer fake", "X-Branch-ID": branch_id},
    )
    assert r1.status_code == 200
    t1 = r1.json()["device"]["token"]

    # Ingest some sequence on the first device
    with sync_env["factory"].begin() as session:
        from app.sync.devices import authenticate_device_token
        d = authenticate_device_token(session, t1)
        d.last_ingested_seq = 42

    # 2. Re-bootstrap with rotate=True
    r2 = client.post(
        "/api/v1/sync/bootstrap",
        json={"station_code": "SUR1", "rotate": True},
        headers={"Authorization": "Bearer fake", "X-Branch-ID": branch_id},
    )
    assert r2.status_code == 200
    data2 = r2.json()
    assert data2["device"]["next_seq"] == 43
    assert data2["device"]["token"] != t1


def test_sync_bootstrap_inactive_branch_fails(sync_env):
    client = sync_env["client"]
    inactive_id = str(sync_env["inactive_id"])

    res = client.post(
        "/api/v1/sync/bootstrap",
        json={"station_code": "SUR1"},
        headers={"Authorization": "Bearer fake", "X-Branch-ID": inactive_id},
    )
    assert res.status_code == 404


def test_sync_status_endpoint(sync_env):
    client = sync_env["client"]
    branch_id = str(sync_env["branch_id"])

    # Bootstrap device to get token
    boot = client.post(
        "/api/v1/sync/bootstrap",
        json={"station_code": "SUR2"},
        headers={"Authorization": "Bearer fake", "X-Branch-ID": branch_id},
    ).json()
    token = boot["device"]["token"]

    res = client.get("/api/v1/sync/status", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["branch_active"] is True
    assert data["snapshot_required"] is False
    assert "server_time" in data
