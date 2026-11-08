"""Tests for Phase 5 B3: Reconciliation, audit flags and financial summary (T5.8, T5.9)."""

from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.deps import get_session, get_session_factory
from app.api.sync.audit import router as sync_audit_router
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
    SyncAuditFlag,
)
from app.errors import install_error_handlers
from app.settings import Settings
from app.shifts.queries import shift_financial_summary
from app.sync.envelope import payload_hash


def _app(factory, settings, mock_staff_id):
    app = FastAPI()
    install_error_handlers(app)
    app.state.session_factory = factory
    app.state.settings = settings
    app.include_router(sync_bootstrap_router)
    app.include_router(sync_events_router)
    app.include_router(sync_audit_router)

    from app.api.sync import audit as audit_module
    from app.api.sync import bootstrap as router_module
    router_module._resolve_staff_for_branch = lambda req, creds, b_id: mock_staff_id
    app.dependency_overrides[audit_module._resolve_audit_staff] = lambda: mock_staff_id

    app.dependency_overrides[get_session_factory] = lambda: factory
    def _override_session():
        with factory() as session:
            yield session
    app.dependency_overrides[get_session] = _override_session

    return app


@pytest.fixture
def recon_env(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'recon.db').as_posix()}")
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
        session.add(RoleGrant(staff_id=staff_id, role="receptionist", scope_kind="branch", branch_id=branch_id, is_active=True))

        # Cash Register
        reg = CashRegister(branch_id=branch_id, name="Caja 1", code="caja-1", status="active")
        session.add(reg)
        session.flush()
        reg_id = reg.id

        # Member
        m1 = Member(
            member_number="1001",
            full_name="Pedro Gomez",
            phone="+525599998888",
            status="active",
        )
        session.add(m1)
        session.flush()
        m1_id = m1.id

        # First Shift for order foreign key
        shift0 = Shift(cash_register_id=reg_id, opened_by=staff_id, status="closed", opened_at=datetime(2025, 1, 1, tzinfo=timezone.utc), closed_at=datetime(2025, 1, 1, 23, 0, tzinfo=timezone.utc), opening_cash_minor=0)
        session.add(shift0)
        session.flush()

        order = Order(
            branch_id=branch_id,
            register_id=reg_id,
            shift_id=shift0.id,
            seller_id=staff_id,
            member_id=m1_id,
            order_kind="membership",
            idempotency_key="seed-1",
            request_fingerprint="0" * 64,
            total_minor=50000,
        )
        session.add(order)
        session.flush()

        plan = Plan(name="Plan Basico", code="basico", status="active")
        session.add(plan)
        session.flush()

        pv = PlanVersion(
            plan_id=plan.id,
            version_number=1,
            name="Plan Basico v1",
            price_minor=50000,
            entitlement_mode="period",
            duration_value=1,
            duration_unit="month",
            is_active=True,
        )
        session.add(pv)
        session.flush()

        oi = OrderItem(
            order_id=order.id,
            line_number=1,
            item_kind="membership",
            plan_version_id=pv.id,
            description_snapshot="Plan Basico",
            unit_amount_minor=50000,
            line_total_minor=50000,
            quantity=1,
            entitlement_mode="period",
            duration_value=1,
            duration_unit="month",
        )
        session.add(oi)
        session.flush()

        # Expired membership period (access will be denied on sync)
        period = MembershipPeriod(
            member_id=m1_id,
            order_item_id=oi.id,
            plan_version_id=pv.id,
            starts_on=date(2025, 1, 1),
            ends_on=date(2025, 1, 31),
            activated_by=staff_id,
        )
        session.add(period)
        session.flush()
        period_id = period.id

    app = _app(factory, settings, staff_id)
    client = TestClient(app)
    return {
        "client": client,
        "factory": factory,
        "branch_id": branch_id,
        "staff_id": staff_id,
        "reg_id": reg_id,
        "m1_id": m1_id,
        "period_id": period_id,
    }


def _bootstrap(client, branch_id):
    res = client.post(
        "/api/v1/sync/bootstrap",
        json={"station_code": "SUR1"},
        headers={"Authorization": "Bearer fake", "X-Branch-ID": str(branch_id)},
    )
    assert res.status_code == 200
    data = res.json()["device"]
    return data["token"], data["device_prefix"]


def test_reconcile_attendance_denied_on_sync_flags_audit(recon_env):
    client = recon_env["client"]
    branch_id = recon_env["branch_id"]
    staff_id = recon_env["staff_id"]
    m1_id = recon_env["m1_id"]
    period_id = recon_env["period_id"]

    token, prefix = _bootstrap(client, branch_id)

    payload = {
        "member_id": str(m1_id),
        "period_id": str(period_id),
        "branch_id": str(branch_id),
        "local_access_decision": "valid",
    }
    h = payload_hash(payload)
    now_iso = datetime.now(timezone.utc).isoformat()
    ev = {
        "event_id": f"{prefix}-00001",
        "seq": 1,
        "event_type": "attendance.check_in",
        "schema_version": 1,
        "actor_staff_id": str(staff_id),
        "payload": payload,
        "payload_hash": h,
        "client_recorded_at": now_iso,
        "clock_anchor_utc": now_iso,
        "clock_monotonic_delta_ms": 100,
    }

    res = client.post(
        "/api/v1/sync/contingency-events",
        json={"events": [ev]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    data = res.json()["ingested"][0]
    assert data["status"] == "flagged_audit"
    assert data["reason_code"] == "entitlement_denied_on_sync"

    # Verify audit flag in API
    flags_res = client.get(
        "/api/v1/sync/audit-flags",
        headers={"Authorization": "Bearer fake"},
    )
    assert flags_res.status_code == 200
    flags = flags_res.json()
    assert len(flags) == 1
    assert flags[0]["kind"] == "entitlement_denied_on_sync"
    flag_id = flags[0]["id"]

    # Resolve audit flag
    resolve_res = client.post(
        f"/api/v1/sync/audit-flags/{flag_id}/resolve",
        headers={"Authorization": "Bearer fake"},
    )
    assert resolve_res.status_code == 200
    assert resolve_res.json()["resolved_at"] is not None

    # Now open_only should return 0 flags
    flags_res2 = client.get(
        "/api/v1/sync/audit-flags?open_only=true",
        headers={"Authorization": "Bearer fake"},
    )
    assert flags_res2.status_code == 200
    assert len(flags_res2.json()) == 0


def test_reconcile_shift_open_and_close_with_discrepancy(recon_env):
    client = recon_env["client"]
    branch_id = recon_env["branch_id"]
    staff_id = recon_env["staff_id"]
    reg_id = recon_env["reg_id"]
    factory = recon_env["factory"]

    token, prefix = _bootstrap(client, branch_id)

    # 1. Open shift
    p_open = {
        "register_id": str(reg_id),
        "opening_cash_minor": 50000,
        "denomination_counts": [],
    }
    now_iso = datetime.now(timezone.utc).isoformat()
    ev1 = {
        "event_id": f"{prefix}-00001",
        "seq": 1,
        "event_type": "shift.open",
        "schema_version": 1,
        "actor_staff_id": str(staff_id),
        "payload": p_open,
        "payload_hash": payload_hash(p_open),
        "client_recorded_at": now_iso,
        "clock_anchor_utc": now_iso,
        "clock_monotonic_delta_ms": 100,
    }

    # 2. Close shift with discrepancy (counted 40000 instead of expected 50000)
    p_close = {
        "shift_ref": "unknown-offline-ref",
        "denomination_counts": [{"denomination_minor": 10000, "quantity": 4}],
        "voucher_count": 0,
        "closing_notes": "Faltaron 100 pesos",
    }
    ev2 = {
        "event_id": f"{prefix}-00002",
        "seq": 2,
        "event_type": "shift.arqueo_close",
        "schema_version": 1,
        "actor_staff_id": str(staff_id),
        "payload": p_close,
        "payload_hash": payload_hash(p_close),
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
    ingested = res.json()["ingested"]
    assert ingested[0]["status"] == "accepted"
    # ev2 should be flagged for cash discrepancy
    assert ingested[1]["status"] == "flagged_audit"
    assert ingested[1]["reason_code"] == "cash_discrepancy"

    # Check shift_financial_summary includes contingency_flags_count
    with factory() as session:
        shift = session.query(Shift).filter(Shift.cash_register_id == reg_id).order_by(Shift.opened_at.desc()).first()
        assert shift is not None
        summary = shift_financial_summary(session, shift)
        assert "contingency_flags_count" in summary
        assert summary["contingency_flags_count"] >= 1


def _post_event(env, token, prefix, seq, event_type, payload, actor_id=None):
    now_iso = datetime.now(timezone.utc).isoformat()
    event = {
        "event_id": f"{prefix}-{seq:05d}", "seq": seq, "event_type": event_type, "schema_version": 1,
        "actor_staff_id": str(actor_id or env["staff_id"]), "payload": payload, "payload_hash": payload_hash(payload),
        "client_recorded_at": now_iso, "clock_anchor_utc": now_iso, "clock_monotonic_delta_ms": 100,
    }
    res = env["client"].post("/api/v1/sync/contingency-events", json={"events": [event]},
                             headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    return res.json()["ingested"][0]


def _close_payload(shift_ref):
    return {"shift_ref": str(shift_ref), "denomination_counts": [{"denomination_minor": 10000, "quantity": 1}],
            "voucher_count": 0, "closing_notes": None}


def test_arqueo_close_manual_total_persists_counted_cash_and_replays(recon_env):
    token, prefix = _bootstrap(recon_env["client"], recon_env["branch_id"])
    with recon_env["factory"].begin() as session:
        shift = Shift(cash_register_id=recon_env["reg_id"], opened_by=recon_env["staff_id"], status="open",
                      opened_at=datetime.now(timezone.utc) - timedelta(hours=1), opening_cash_minor=0)
        session.add(shift)
        session.flush()
        shift_id = shift.id
    payload = {"shift_ref": str(shift_id), "counted_cash_minor": 12345, "voucher_count": 0, "closing_notes": None}
    first = _post_event(recon_env, token, prefix, 1, "shift.arqueo_close", payload)
    assert first["status"] in ("accepted", "flagged_audit"), first
    with recon_env["factory"]() as session:
        closed = session.get(Shift, shift_id)
        assert closed.status == "closed"
        assert closed.counted_cash_minor == 12345
        assert closed.difference_minor == 12345 - closed.expected_cash_at_close_minor
        snapshot = (closed.counted_cash_minor, closed.difference_minor, closed.closed_at)
    # Replaying the same event id is idempotent and leaves the close untouched.
    _post_event(recon_env, token, prefix, 1, "shift.arqueo_close", payload)
    with recon_env["factory"]() as session:
        again = session.get(Shift, shift_id)
        assert (again.counted_cash_minor, again.difference_minor, again.closed_at) == snapshot


def test_actor_without_active_grants_is_flagged_not_authorized(recon_env):
    token, prefix = _bootstrap(recon_env["client"], recon_env["branch_id"])
    with recon_env["factory"].begin() as session:
        revoked = StaffUser(login_identifier="revoked@example.invalid")
        session.add(revoked)
        session.flush()
        session.add(RoleGrant(staff_id=revoked.id, role="receptionist", scope_kind="branch",
                              branch_id=recon_env["branch_id"], is_active=False))
        revoked_id = revoked.id
    payload = {"register_id": str(recon_env["reg_id"]), "opening_cash_minor": 0, "denomination_counts": []}
    result = _post_event(recon_env, token, prefix, 1, "shift.open", payload, actor_id=revoked_id)
    assert (result["status"], result["reason_code"]) == ("flagged_audit", "actor_not_authorized")


def test_arqueo_close_cannot_close_a_shift_of_another_branch(recon_env):
    token, prefix = _bootstrap(recon_env["client"], recon_env["branch_id"])
    with recon_env["factory"].begin() as session:
        other = Branch(code="norte", name="Norte", timezone="America/Mexico_City", is_active=True)
        session.add(other)
        session.flush()
        register = CashRegister(branch_id=other.id, name="Caja N", code="caja-n", status="active")
        session.add(register)
        session.flush()
        foreign = Shift(cash_register_id=register.id, opened_by=recon_env["staff_id"], status="open",
                        opened_at=datetime.now(timezone.utc), opening_cash_minor=0)
        session.add(foreign)
        session.flush()
        foreign_id = foreign.id
    result = _post_event(recon_env, token, prefix, 1, "shift.arqueo_close", _close_payload(foreign_id))
    assert (result["status"], result["reason_code"]) == ("flagged_audit", "orphan_shift_reference")
    with recon_env["factory"]() as session:
        assert session.get(Shift, foreign_id).status == "open"


def test_arqueo_close_of_an_already_closed_shift_is_flagged_and_does_not_block_the_batch(recon_env):
    token, prefix = _bootstrap(recon_env["client"], recon_env["branch_id"])
    with recon_env["factory"].begin() as session:
        closed = Shift(cash_register_id=recon_env["reg_id"], opened_by=recon_env["staff_id"], status="closed",
                       opened_at=datetime(2025, 2, 1, tzinfo=timezone.utc), closed_at=datetime(2025, 2, 1, 20, tzinfo=timezone.utc),
                       opening_cash_minor=0)
        session.add(closed)
        session.flush()
        closed_id = closed.id
    first = _post_event(recon_env, token, prefix, 1, "shift.arqueo_close", _close_payload(closed_id))
    assert (first["status"], first["reason_code"]) == ("flagged_audit", "orphan_shift_reference")
    # The device watermark advanced, so the next event is accepted in sequence.
    open_payload = {"register_id": str(recon_env["reg_id"]), "opening_cash_minor": 0, "denomination_counts": []}
    assert _post_event(recon_env, token, prefix, 2, "shift.open", open_payload)["status"] == "accepted"
