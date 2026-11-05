"""Tests for Phase 5 B3: POST /api/v1/sync/contingency-events (T5.7)."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.deps import get_session, get_session_factory
from app.api.sync.bootstrap import router as sync_bootstrap_router
from app.api.sync.events import router as sync_events_router
from app.db.base import Base
from app.db.models import (
    Branch,
    CashRegister,
    Member,
    MembershipPeriod,
    Order,
    OrderItem,
    Plan,
    PlanVersion,
    Product,
    RoleGrant,
    Shift,
    StaffUser,
    SyncDevice,
)
from app.errors import install_error_handlers
from app.settings import Settings
from app.sync.envelope import canonical_json, payload_hash


def _app(factory, settings, mock_staff_id):
    app = FastAPI()
    install_error_handlers(app)
    app.state.session_factory = factory
    app.state.settings = settings
    app.include_router(sync_bootstrap_router)
    app.include_router(sync_events_router)

    from app.api.sync import bootstrap as router_module
    router_module._resolve_staff_for_branch = lambda req, creds, b_id: mock_staff_id

    app.dependency_overrides[get_session_factory] = lambda: factory
    def _override_session():
        with factory() as session:
            yield session
    app.dependency_overrides[get_session] = _override_session

    return app


@pytest.fixture
def ingest_env(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'ingest.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    settings = Settings(environment="test", debug=True, _env_file=None)

    with factory.begin() as session:
        branch = Branch(code="sur", name="Sur", timezone="America/Mexico_City", is_active=True)
        staff = StaffUser(login_identifier="staff@example.invalid")
        session.add_all([branch, staff])
        session.flush()

        branch_id = branch.id
        staff_id = staff.id

        grant = RoleGrant(
            staff_id=staff_id,
            role="receptionist",
            scope_kind="branch",
            branch_id=branch_id,
            is_active=True,
        )
        session.add(grant)

        # Cash Register
        reg = CashRegister(branch_id=branch_id, name="Caja 1", code="caja-1", status="active")
        session.add(reg)
        session.flush()
        reg_id = reg.id

        # Product
        p1 = Product(
            code="agua",
            name="Agua 500ml",
            price_minor=1500,
            is_active=True,
            created_by=staff_id,
        )
        session.add(p1)
        session.flush()
        p1_id = p1.id

    app = _app(factory, settings, staff_id)
    client = TestClient(app)
    return {
        "client": client,
        "factory": factory,
        "branch_id": branch_id,
        "staff_id": staff_id,
        "reg_id": reg_id,
        "p1_id": p1_id,
    }


def _bootstrap_device(client, branch_id, station_code="SUR1"):
    res = client.post(
        "/api/v1/sync/bootstrap",
        json={"station_code": station_code},
        headers={"Authorization": "Bearer fake", "X-Branch-ID": str(branch_id)},
    )
    assert res.status_code == 200
    data = res.json()["device"]
    return data["token"], data["device_prefix"]


def test_sync_ingest_pos_cash_sale_sequential(ingest_env):
    client = ingest_env["client"]
    branch_id = ingest_env["branch_id"]
    staff_id = ingest_env["staff_id"]
    reg_id = ingest_env["reg_id"]
    p1_id = ingest_env["p1_id"]

    token, prefix = _bootstrap_device(client, branch_id)

    # 1. First event: Shift open
    payload1 = {
        "register_id": str(reg_id),
        "opening_cash_minor": 100000,
        "denomination_counts": [{"denomination_minor": 10000, "quantity": 10}],
    }
    h1 = payload_hash(payload1)
    now_iso = datetime.now(timezone.utc).isoformat()
    ev1 = {
        "event_id": f"{prefix}-00001",
        "seq": 1,
        "event_type": "shift.open",
        "schema_version": 1,
        "actor_staff_id": str(staff_id),
        "payload": payload1,
        "payload_hash": h1,
        "client_recorded_at": now_iso,
        "clock_anchor_utc": now_iso,
        "clock_monotonic_delta_ms": 100,
    }

    # 2. Second event: Cash sale
    payload2 = {
        "register_id": str(reg_id),
        "local_shift_ref": "shift-offline-1",
        "member_id": None,
        "items": [{"product_id": str(p1_id), "quantity": 2, "unit_price_minor": 1500}],
        "total_minor": 3000,
        "online_idempotency_key": "sale-1",
    }
    h2 = payload_hash(payload2)
    ev2 = {
        "event_id": f"{prefix}-00002",
        "seq": 2,
        "event_type": "pos.cash_sale",
        "schema_version": 1,
        "actor_staff_id": str(staff_id),
        "payload": payload2,
        "payload_hash": h2,
        "client_recorded_at": now_iso,
        "clock_anchor_utc": now_iso,
        "clock_monotonic_delta_ms": 200,
    }

    res = client.post(
        "/api/v1/sync/contingency-events",
        json={"events": [ev1, ev2]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["last_ingested_seq"] == 2
    assert len(data["ingested"]) == 2
    assert data["ingested"][0]["event_id"] == f"{prefix}-00001"
    assert data["ingested"][0]["status"] == "accepted"


def test_sync_ingest_idempotent_replay(ingest_env):
    client = ingest_env["client"]
    branch_id = ingest_env["branch_id"]
    staff_id = ingest_env["staff_id"]
    reg_id = ingest_env["reg_id"]

    token, prefix = _bootstrap_device(client, branch_id)

    payload = {
        "register_id": str(reg_id),
        "opening_cash_minor": 50000,
        "denomination_counts": [],
    }
    h = payload_hash(payload)
    now_iso = datetime.now(timezone.utc).isoformat()
    ev = {
        "event_id": f"{prefix}-00001",
        "seq": 1,
        "event_type": "shift.open",
        "schema_version": 1,
        "actor_staff_id": str(staff_id),
        "payload": payload,
        "payload_hash": h,
        "client_recorded_at": now_iso,
        "clock_anchor_utc": now_iso,
        "clock_monotonic_delta_ms": 50,
    }

    # First upload
    res1 = client.post(
        "/api/v1/sync/contingency-events",
        json={"events": [ev]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res1.status_code == 200
    assert res1.json()["ingested"][0]["status"] == "accepted"

    # Replay same event
    res2 = client.post(
        "/api/v1/sync/contingency-events",
        json={"events": [ev]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res2.status_code == 200
    assert res2.json()["ingested"][0]["status"] == "accepted"
    assert res2.json()["last_ingested_seq"] == 1


def test_sync_ingest_sequence_gap_rejected(ingest_env):
    client = ingest_env["client"]
    branch_id = ingest_env["branch_id"]
    staff_id = ingest_env["staff_id"]
    reg_id = ingest_env["reg_id"]

    token, prefix = _bootstrap_device(client, branch_id)

    # seq 2 instead of seq 1
    payload = {"register_id": str(reg_id), "opening_cash_minor": 50000, "denomination_counts": []}
    ev = {
        "event_id": f"{prefix}-00002",
        "seq": 2,
        "event_type": "shift.open",
        "schema_version": 1,
        "actor_staff_id": str(staff_id),
        "payload": payload,
        "payload_hash": payload_hash(payload),
        "client_recorded_at": datetime.now(timezone.utc).isoformat(),
        "clock_anchor_utc": datetime.now(timezone.utc).isoformat(),
        "clock_monotonic_delta_ms": 50,
    }

    res = client.post(
        "/api/v1/sync/contingency-events",
        json={"events": [ev]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409


def test_sync_ingest_hash_mismatch_rejected(ingest_env):
    client = ingest_env["client"]
    branch_id = ingest_env["branch_id"]
    staff_id = ingest_env["staff_id"]
    reg_id = ingest_env["reg_id"]

    token, prefix = _bootstrap_device(client, branch_id)

    payload = {"register_id": str(reg_id), "opening_cash_minor": 50000, "denomination_counts": []}
    ev = {
        "event_id": f"{prefix}-00001",
        "seq": 1,
        "event_type": "shift.open",
        "schema_version": 1,
        "actor_staff_id": str(staff_id),
        "payload": payload,
        "payload_hash": "0000000000000000000000000000000000000000000000000000000000000000",
        "client_recorded_at": datetime.now(timezone.utc).isoformat(),
        "clock_anchor_utc": datetime.now(timezone.utc).isoformat(),
        "clock_monotonic_delta_ms": 50,
    }

    res = client.post(
        "/api/v1/sync/contingency-events",
        json={"events": [ev]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 422
