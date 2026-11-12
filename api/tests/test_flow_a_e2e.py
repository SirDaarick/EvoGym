"""End-to-End unified verification suite for Flow A decisions (D-A1 through D-A8).

Tests every decision end-to-end:
1. Real API action execution following business rules.
2. Direct database row persistence & invariant inspection (Expense, PayrollAdvance, Shift,
   MemberCheckIn, StaffAttendanceCorrection, Plan, PlanVersion, SyncAuditFlag).
3. Read endpoints consumed by the frontend (GET /owner-overview/alerts, GET /catalog/plans,
   GET /sync/audit-flags, GET /admin/payroll/weeks/{week}).
"""

from datetime import date, datetime, time, timedelta, timezone
from hashlib import sha256
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from admin_session_helpers import approved_admin_headers
from app.auth.admin import ADMIN_IDLE_SECONDS
from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session
from app.catalog.schemas import PlanVersionServiceCreateDTO, PublishPlanVersionDTO
from app.db.base import Base
from app.db.models import (
    Branch,
    CashRegister,
    ContingencyEvent,
    Expense,
    Member,
    MemberCheckIn,
    MembershipDebt,
    MembershipPeriod,
    Order,
    OrderItem,
    Payment,
    PayrollAdvance,
    PayrollPayment,
    Plan,
    PlanVersion,
    RoleGrant,
    Shift,
    StaffAttendanceCorrection,
    StaffAttendanceRecord,
    StaffCredential,
    StaffRosterProfile,
    StaffUser,
    SyncAuditFlag,
    SyncDevice,
)
from app.main import create_app
from app.shifts.queries import create_cash_register, shift_financial_summary
from app.sync.envelope import payload_hash
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings, seed_admin
from test_shifts import open_shift


def _setup_db(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'flow_a_e2e.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    return url, engine, factory


def _seed_branch(factory, code="flow-a-branch", name="Flow A Central", tz="America/Mexico_City") -> UUID:
    with factory.begin() as session:
        branch = Branch(code=code, name=name, timezone=tz, is_active=True)
        session.add(branch)
        session.flush()
        return branch.id


def _seed_receptionist(factory, branch_id: UUID, login="recep-flow-a@evogym.com", pin="1234", name="Sofia Recepcionista") -> tuple[UUID, str]:
    with factory.begin() as session:
        staff = StaffUser(login_identifier=login)
        session.add(staff)
        session.flush()
        session.add_all([
            RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch_id, is_active=True),
            StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin(pin)),
        ])
        profile = StaffRosterProfile(
            branch_id=branch_id,
            staff_user_id=staff.id,
            full_name=name,
            position="Recepcionista",
            monthly_salary_minor=800000,
        )
        session.add(profile)
        session.flush()
        staff_id = staff.id

    now = datetime.now(timezone.utc)
    issued = issue_session(factory, login, pin, branch_id, now + timedelta(hours=2))
    return staff_id, issued.token


def _bootstrap_sync_device(client: TestClient, branch_id: UUID, token: str, station_code: str = "SYNCA1") -> tuple[str, str]:
    res = client.post(
        "/api/v1/sync/bootstrap",
        json={"station_code": station_code},
        headers={"Authorization": f"Bearer {token}", "X-Branch-ID": str(branch_id)},
    )
    assert res.status_code == 200, res.text
    data = res.json()["device"]
    return data["token"], data["device_prefix"]


def _post_sync_event(
    client: TestClient,
    device_token: str,
    device_prefix: str,
    sequence_no: int,
    event_type: str,
    payload: dict,
    actor_staff_id: UUID | str | None = None,
) -> dict:
    now_iso = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    envelope = {
        "event_id": f"{device_prefix}-{sequence_no:05d}",
        "seq": sequence_no,
        "event_type": event_type,
        "schema_version": 1,
        "actor_staff_id": str(actor_staff_id) if actor_staff_id else str(uuid4()),
        "payload": payload,
        "payload_hash": payload_hash(payload),
        "client_recorded_at": now_iso,
        "clock_anchor_utc": now_iso,
        "clock_monotonic_delta_ms": 0,
    }
    res = client.post(
        "/api/v1/sync/contingency-events",
        json={"events": [envelope]},
        headers={"Authorization": f"Bearer {device_token}"},
    )
    assert res.status_code == 200, res.text
    return res.json()["ingested"][0]


# ==============================================================================
# D-A1: Payroll cash handling (owner's account, advances cash/transfer, drawer untouched)
# ==============================================================================

def test_flow_a_d_a1_payroll_cash_handling(tmp_path):
    """D-A1: Payroll advances allow cash or transfer.

    - Money comes from the owner's account (Expense.shift_id is None).
    - An open shift's expected cash is never reduced.
    - Advance payment method is recorded on the Expense and queryable.
    """
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "flow-a-d1", "D-A1 Branch")
        recep_id, recep_token = _seed_receptionist(factory, branch_id)
        admin_id = seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        with factory.begin() as session:
            # Seed employee roster profile with monthly salary
            profile = StaffRosterProfile(
                branch_id=branch_id,
                full_name="Carlos Trainer",
                position="Entrenador",
                monthly_salary_minor=1400000,
            )
            session.add(profile)
            session.flush()
            profile_id = profile.id

            # Seed open shift with 50,000 minor opening cash
            register = create_cash_register(session, branch_id, "reg-d1", "Caja D1")
            shift = open_shift(
                session,
                register_id=register.id,
                opened_by=recep_id,
                denomination_counts=[{"denomination_minor": 50000, "quantity": 1}],
            )
            shift_id = shift.id

        with TestClient(app, raise_server_exceptions=True) as client:
            admin_headers = approved_admin_headers(client, delivery)
            week = "2026-10-26"

            # 1. Record advance with CASH payment_method
            adv_cash_payload = {
                "branch_id": str(branch_id),
                "staff_profile_id": str(profile_id),
                "week_start": week,
                "amount_minor": 20000,
                "payment_method": "cash",
            }
            res_adv_cash = client.post(
                "/api/v1/admin/payroll/advances",
                headers={**admin_headers, "Idempotency-Key": "adv-cash-001"},
                json=adv_cash_payload,
            )
            assert res_adv_cash.status_code == 201, res_adv_cash.text
            assert res_adv_cash.json()["amount_minor"] == 20000

            # 2. Record second advance with TRANSFER payment_method
            adv_transfer_payload = {
                "branch_id": str(branch_id),
                "staff_profile_id": str(profile_id),
                "week_start": week,
                "amount_minor": 30000,
                "payment_method": "transfer",
            }
            res_adv_transfer = client.post(
                "/api/v1/admin/payroll/advances",
                headers={**admin_headers, "Idempotency-Key": "adv-transfer-002"},
                json=adv_transfer_payload,
            )
            assert res_adv_transfer.status_code == 201, res_adv_transfer.text
            assert res_adv_transfer.json()["amount_minor"] == 30000

            # 3. Record remaining weekly payment with CASH payment_method (net = 300,000)
            pay_cash_payload = {
                "branch_id": str(branch_id),
                "staff_profile_id": str(profile_id),
                "week_start": week,
                "payment_method": "cash",
            }
            res_pay_cash = client.post(
                "/api/v1/admin/payroll/payments",
                headers={**admin_headers, "Idempotency-Key": "pay-cash-001"},
                json=pay_cash_payload,
            )
            assert res_pay_cash.status_code == 201, res_pay_cash.text
            assert res_pay_cash.json()["net_minor"] == 300000
            assert res_pay_cash.json()["payment_method"] == "cash"

            # 4. Direct DB Inspection:
            # - Expense rows have shift_id = None (owner's account, not drawer)
            # - Expense rows store payment_method ("cash" vs "transfer")
            # - Open shift expected_cash_minor remains 50000 untouched!
            with factory() as session:
                expenses = session.scalars(
                    select(Expense).where(Expense.branch_id == branch_id).order_by(Expense.created_at.asc())
                ).all()
                assert len(expenses) == 3
                for exp in expenses:
                    assert exp.shift_id is None, "Payroll expenses must not link to cash drawer shift"
                assert expenses[0].concept == "Adelanto de nómina" and expenses[0].payment_method == "cash"
                assert expenses[1].concept == "Adelanto de nómina" and expenses[1].payment_method == "transfer"
                assert expenses[2].concept == "Nómina semanal" and expenses[2].payment_method == "cash"

                payment_row = session.scalars(
                    select(PayrollPayment).where(PayrollPayment.staff_profile_id == profile_id)
                ).one()
                assert payment_row.base_minor == 350000
                assert payment_row.advances_minor == 50000
                assert payment_row.net_minor == 300000
                assert payment_row.payment_method == "cash"

                open_shift_db = session.get(Shift, shift_id)
                assert open_shift_db.status == "open"
                assert open_shift_db.opening_cash_minor == 50000
                financial_summary = shift_financial_summary(session, open_shift_db)
                assert financial_summary["expected_cash_minor"] == 50000, (
                    "Shift expected cash must remain 50,000 untouched by payroll cash payments and advances"
                )

            # 5. Frontend Read Endpoints
            # GET /api/v1/admin/payroll/weeks/{week} returns accurate advance & paid totals
            get_week = client.get(f"/api/v1/admin/payroll/weeks/{week}?branch_id={branch_id}", headers=admin_headers)
            assert get_week.status_code == 200
            week_items = get_week.json()["items"]
            trainer_items = [it for it in week_items if it["profile_id"] == str(profile_id)]
            assert len(trainer_items) == 1
            assert trainer_items[0]["base_minor"] == 350000
            assert trainer_items[0]["advances_minor"] == 50000
            assert trainer_items[0]["advance_payment_method"] in ("cash", "transfer")
            assert trainer_items[0]["net_minor"] == 300000
            assert trainer_items[0]["paid"]["payment_method"] == "cash"

            # GET /api/v1/admin/payroll/history (consumed by LivePayrollView.tsx)
            get_history = client.get(
                f"/api/v1/admin/payroll/history?from={week}&to=2026-11-02&branch_id={branch_id}",
                headers=admin_headers,
            )
            assert get_history.status_code == 200
            history_weeks = get_history.json()["weeks"]
            assert len(history_weeks) >= 1
            target_week = next(w for w in history_weeks if w["week_start"] == week)
            trainer_hist = next(it for it in target_week["items"] if it["profile_id"] == str(profile_id))
            assert trainer_hist["advance_payment_method"] in ("cash", "transfer")
            assert trainer_hist["paid"]["payment_method"] == "cash"
            assert trainer_hist["advances_minor"] == 50000
            assert trainer_hist["paid_minor"] == 300000
            assert trainer_hist["outflow_minor"] == 350000
    finally:
        engine.dispose()


# ==============================================================================
# D-A2: Alerts on member entry with debt (recorded authorized_by & admin overview alert)
# ==============================================================================

def test_flow_a_d_a2_debt_override_checkin_alerts(tmp_path):
    """D-A2: When reception exceptionally authorizes entry for a member with debt,
    the authorizer identity is recorded and surfaced in GET /owner-overview/alerts.
    """
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "flow-a-d2", "D-A2 Branch")
        recep_id, recep_token = _seed_receptionist(factory, branch_id, login="recep.d2@evogym.com", name="Recepcionista Sofia")
        admin_id = seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        with factory.begin() as session:
            # Seed plan and cash register
            plan = Plan(code="plan-d2", name="Plan D2", kind="membership", status="active")
            session.add(plan)
            session.flush()
            version = PlanVersion(
                plan_id=plan.id,
                version_number=1,
                name="Plan D2 Monthly",
                price_minor=10000,
                currency="MXN",
                duration_value=1,
                duration_unit="month",
                is_active=True,
            )
            session.add(version)
            session.flush()
            version_id = version.id
            register = create_cash_register(session, branch_id, "reg-d2", "Caja D2")
            register_id = register.id
            open_shift(
                session,
                register_id=register_id,
                opened_by=recep_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            )

        with TestClient(app, raise_server_exceptions=True) as client:
            recep_headers = {"Authorization": f"Bearer {recep_token}"}
            admin_headers = approved_admin_headers(client, delivery)

            # Register member
            reg_res = client.post(
                "/api/v1/members",
                headers=recep_headers,
                json={"member_number": "SOC-DA2-001", "full_name": "Rodrigo Mendez", "phone": "5511223344"},
            )
            assert reg_res.status_code == 201
            member_id = UUID(reg_res.json()["id"])

            # Sell membership with partial payment -> outstanding debt
            sale_res = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={**recep_headers, "Idempotency-Key": "sale-d2-debt"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id), "cash_amount_minor": 4000},
            )
            assert sale_res.status_code == 201
            period_id = sale_res.json()["membership"]["id"]

            checkin_url = f"/api/v1/member-check-ins/branches/{branch_id}/periods/{period_id}"

            # 1. Check-in without debt confirmation -> 409 conflict
            unconfirmed = client.post(
                checkin_url,
                headers={**recep_headers, "Idempotency-Key": "chk-d2-unconf"},
                json={"confirm_outstanding_balance": False},
            )
            assert unconfirmed.status_code == 409, unconfirmed.text
            assert unconfirmed.json()["error"]["code"] == "debt_confirmation_required"

            # 2. Check-in with explicit debt override confirmation -> 201 Created
            confirmed = client.post(
                checkin_url,
                headers={**recep_headers, "Idempotency-Key": "chk-d2-conf"},
                json={"confirm_outstanding_balance": True},
            )
            assert confirmed.status_code == 201, confirmed.text
            checkin_id = UUID(confirmed.json()["id"])

            # 3. Direct DB Inspection:
            # MemberCheckIn has access_warnings with both markers, recorded_by == recep_id
            with factory() as session:
                chk_db = session.get(MemberCheckIn, checkin_id)
                assert chk_db is not None
                assert chk_db.recorded_by == recep_id
                assert "outstanding_balance" in chk_db.access_warnings
                assert "outstanding_balance_confirmed" in chk_db.access_warnings

            # 4. Frontend Alert Endpoints:
            # - Receptionist cannot read owner alerts (403)
            recep_forbidden = client.get("/api/v1/owner/overview/alerts", headers=recep_headers)
            assert recep_forbidden.status_code == 403

            # - Admin reads GET /api/v1/owner/overview/alerts
            admin_alerts = client.get("/api/v1/owner/overview/alerts", headers=admin_headers)
            assert admin_alerts.status_code == 200, admin_alerts.text
            data = admin_alerts.json()
            alerts = data["alerts"]
            debt_alerts = [a for a in alerts if a["category"] == "debt_override_checkin"]
            assert len(debt_alerts) == 1
            alert = debt_alerts[0]
            assert alert["id"] == str(checkin_id)
            assert alert["member_name"] == "Rodrigo Mendez"
            assert alert["member_number"] == "SOC-DA2-001"
            assert alert["authorized_by_user_id"] == str(recep_id)
            assert alert["authorized_by_name"] == "Recepcionista Sofia"
            assert alert["branch_id"] == str(branch_id)
            assert "occurred_at" in alert

            # - Receptionist branch debt alerts endpoint
            admin_branch_debt = client.get(f"/api/v1/member-check-ins/branches/{branch_id}/debt-alerts", headers=admin_headers)
            assert admin_branch_debt.status_code == 200
            assert len(admin_branch_debt.json()) == 1
            assert admin_branch_debt.json()[0]["authorized_by_user_id"] == str(recep_id)
            assert admin_branch_debt.json()[0]["authorized_by_name"] == "Recepcionista Sofia"
    finally:
        engine.dispose()


# ==============================================================================
# D-A3: Attendance correction alerts (receptionist append-only correction surfaces alert)
# ==============================================================================

def test_flow_a_d_a3_attendance_correction_alerts(tmp_path):
    """D-A3: Receptionist records an append-only attendance correction;
    an administrator alert is surfaced in GET /owner-overview/alerts.
    """
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "flow-a-d3", "D-A3 Branch")
        recep_id, recep_token = _seed_receptionist(factory, branch_id, login="recep.d3@evogym.com", name="Recepcionista Sofia")
        admin_id = seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        with factory.begin() as session:
            # Seed staff member profile being corrected with explicit schedule
            trainer_profile = StaffRosterProfile(
                branch_id=branch_id,
                full_name="Entrenador Miguel",
                position="Entrenador",
                expected_entry_time=time(8, 0),
                grace_tolerance_minutes=15,
                monthly_salary_minor=1200000,
            )
            session.add(trainer_profile)
            session.flush()
            trainer_id = trainer_profile.id

        with TestClient(app, raise_server_exceptions=True) as client:
            recep_headers = {"Authorization": f"Bearer {recep_token}"}
            admin_headers = approved_admin_headers(client, delivery)

            # 1. Record staff attendance entry for Trainer Miguel
            entry_res = client.post(
                f"/api/v1/staff-attendance/branches/{branch_id}/profiles/{trainer_id}",
                headers=recep_headers,
                json={},
            )
            assert entry_res.status_code == 201, entry_res.text
            record_id = UUID(entry_res.json()["id"])

            # 2. Receptionist records an attendance correction
            correction_payload = {
                "field_name": "status",
                "corrected_value": "present",
                "reason": "Supervisor confirmed terminal was offline during start time",
            }
            corr_res = client.post(
                f"/api/v1/staff-attendance/{record_id}/corrections",
                headers=recep_headers,
                json=correction_payload,
            )
            assert corr_res.status_code == 201, corr_res.text
            corr_id = UUID(corr_res.json()["id"])

            # 3. Direct DB Inspection:
            # - StaffAttendanceCorrection row exists with corrected_by == recep_id
            # - StaffAttendanceRecord is unmodified (append-only)
            # - Mutating StaffAttendanceCorrection directly is rejected by trigger
            with factory() as session:
                corr_db = session.get(StaffAttendanceCorrection, corr_id)
                assert corr_db is not None
                assert corr_db.attendance_id == record_id
                assert corr_db.corrected_by == recep_id
                assert corr_db.field_name == "status"
                assert corr_db.corrected_value == "present"
                assert corr_db.reason == "Supervisor confirmed terminal was offline during start time"

                rec_db = session.get(StaffAttendanceRecord, record_id)
                assert rec_db is not None

            with factory.begin() as session:
                corr_row = session.get(StaffAttendanceCorrection, corr_id)
                corr_row.reason = "Tampered reason"
                with pytest.raises(ValueError, match="Staff attendance corrections are append-only"):
                    session.flush()

            # 4. Frontend Alert Read Endpoint:
            # GET /api/v1/owner/overview/alerts includes attendance_correction alert for admin
            overview_res = client.get("/api/v1/owner/overview/alerts", headers=admin_headers)
            assert overview_res.status_code == 200, overview_res.text
            alerts = overview_res.json()["alerts"]
            corr_alerts = [a for a in alerts if a["category"] == "attendance_correction"]
            assert len(corr_alerts) == 1
            alert = corr_alerts[0]
            assert alert["id"] == str(corr_id)
            assert alert["attendance_id"] == str(record_id)
            assert alert["staff_member_name"] == "Entrenador Miguel"
            assert alert["corrected_by_user_id"] == str(recep_id)
            assert alert["corrected_by_name"] == "Recepcionista Sofia"
            assert alert["field_name"] == "status"
            assert alert["corrected_value"] == "present"
            assert alert["reason"] == "Supervisor confirmed terminal was offline during start time"
            assert "occurred_at" in alert
    finally:
        engine.dispose()


# ==============================================================================
# D-A4: Catalog (one current offer per plan & active/inactive status)
# ==============================================================================

def test_flow_a_d_a4_catalog_one_offer_per_plan_and_active_inactive(tmp_path):
    """D-A4: Catalog shows one current offer per plan.

    - Publishing a new version creates a new PlanVersion; existing versions remain in DB.
    - Immutability: existing paid periods retain purchased PlanVersion terms & price.
    - GET /catalog/plans returns one current offer per plan (the latest published version).
    - Renewals use the current active offer.
    - Inactive plans are excluded from active sales while history is preserved.
    """
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "flow-a-d4", "D-A4 Branch")
        recep_id, recep_token = _seed_receptionist(factory, branch_id, login="recep.d4@evogym.com", name="Recepcionista D4")
        admin_id = seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "reg-d4", "Caja D4")
            register_id = register.id
            open_shift(
                session,
                register_id=register_id,
                opened_by=recep_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            )

        with TestClient(app, raise_server_exceptions=True) as client:
            admin_headers = approved_admin_headers(client, delivery)
            recep_headers = {"Authorization": f"Bearer {recep_token}", "X-Branch-ID": str(branch_id)}

            # 1. Create a commercial service and plan with Version 1 (price 10,000, "General v1")
            svc_res = client.post(
                "/api/v1/catalog/services",
                headers=admin_headers,
                json={"code": "gym", "name": "Gym Area", "status": "active"},
            )
            assert svc_res.status_code == 201
            service_id = svc_res.json()["id"]

            plan_res = client.post(
                "/api/v1/catalog/plans",
                headers=admin_headers,
                json={
                    "code": "plan-general",
                    "name": "General Gym",
                    "kind": "membership",
                    "initial_version": {
                        "name": "General v1",
                        "price_minor": 10000,
                        "currency": "MXN",
                        "duration_value": 1,
                        "duration_unit": "month",
                        "entitlement_mode": "period",
                        "services": [{"service_id": service_id}],
                    },
                },
            )
            assert plan_res.status_code == 201
            plan_id = UUID(plan_res.json()["id"])
            v1_id = UUID(plan_res.json()["current_version"]["id"])

            # 2. Register member and sell them membership on Version 1
            reg_member = client.post(
                "/api/v1/members",
                headers=recep_headers,
                json={"member_number": "SOC-DA4-001", "full_name": "Valeria Sanchez", "phone": "5522334455"},
            )
            assert reg_member.status_code == 201
            member_id = UUID(reg_member.json()["id"])

            sale_v1 = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={**recep_headers, "Idempotency-Key": "sale-d4-v1"},
                json={"member_id": str(member_id), "plan_version_id": str(v1_id), "cash_amount_minor": 10000},
            )
            assert sale_v1.status_code == 201, sale_v1.text
            period_v1_id = UUID(sale_v1.json()["membership"]["id"])

            # 3. Publish Version 2 (price 15,000, "General v2")
            v2_res = client.post(
                f"/api/v1/catalog/plans/{plan_id}/versions",
                headers=admin_headers,
                json={
                    "name": "General v2",
                    "price_minor": 15000,
                    "currency": "MXN",
                    "duration_value": 1,
                    "duration_unit": "month",
                    "entitlement_mode": "period",
                    "services": [{"service_id": service_id}],
                },
            )
            assert v2_res.status_code == 201
            v2_id = UUID(v2_res.json()["id"])

            # 4. Direct DB Inspection & Frontend Read reload endpoint:
            # - Existing paid period retains Version 1 price (10,000) & name ("General v1")
            with factory() as session:
                versions = session.scalars(
                    select(PlanVersion).where(PlanVersion.plan_id == plan_id).order_by(PlanVersion.version_number.asc())
                ).all()
                assert len(versions) == 2
                assert versions[0].id == v1_id and versions[0].price_minor == 10000
                assert versions[1].id == v2_id and versions[1].price_minor == 15000

                p1 = session.get(MembershipPeriod, period_v1_id)
                assert p1.plan_version_id == v1_id
                item1 = session.get(OrderItem, p1.order_item_id)
                assert item1.plan_version_id == v1_id
                assert item1.unit_amount_minor == 10000
                assert item1.description_snapshot == "General v1"

            reload_v1 = client.get(f"/api/v1/members/{member_id}/reload", headers=recep_headers)
            assert reload_v1.status_code == 200
            periods_v1 = reload_v1.json()["active_periods"]
            assert len(periods_v1) == 1
            assert periods_v1[0]["plan_version_id"] == str(v1_id)
            assert periods_v1[0]["plan_name"] == "General v1"

            # 5. Frontend Read Contract:
            # Active catalog returns ONE current offer per plan (the latest version 2)
            catalog_res = client.get("/api/v1/catalog/plans?status=active", headers=admin_headers)
            assert catalog_res.status_code == 200
            plans = catalog_res.json()
            assert len(plans) == 1
            plan_dto = plans[0]
            assert plan_dto["id"] == str(plan_id)
            assert plan_dto["current_version"]["id"] == str(v2_id)
            assert plan_dto["current_version"]["version_number"] == 2
            assert plan_dto["current_version"]["price_minor"] == 15000
            assert plan_dto["current_version"]["name"] == "General v2"

            # 6. Renewal sale uses the current active offer (Version 2)
            sale_v2 = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={**recep_headers, "Idempotency-Key": "sale-d4-v2-renewal"},
                json={"member_id": str(member_id), "plan_version_id": str(v2_id), "cash_amount_minor": 15000},
            )
            assert sale_v2.status_code == 201, sale_v2.text
            period_v2_id = UUID(sale_v2.json()["membership"]["id"])

            # Verify in DB and GET /api/v1/members/{member_id}/reload:
            # First period retains Version 1 (10,000), new period uses Version 2 (15,000)
            with factory() as session:
                p1_db = session.get(MembershipPeriod, period_v1_id)
                p2_db = session.get(MembershipPeriod, period_v2_id)
                assert p1_db.plan_version_id == v1_id
                assert p2_db.plan_version_id == v2_id
                it1_db = session.get(OrderItem, p1_db.order_item_id)
                it2_db = session.get(OrderItem, p2_db.order_item_id)
                assert it1_db.plan_version_id == v1_id and it1_db.unit_amount_minor == 10000 and it1_db.description_snapshot == "General v1"
                assert it2_db.plan_version_id == v2_id and it2_db.unit_amount_minor == 15000 and it2_db.description_snapshot == "General v2"

            reload_v2 = client.get(f"/api/v1/members/{member_id}/reload", headers=recep_headers)
            assert reload_v2.status_code == 200
            periods_v2 = reload_v2.json()["active_periods"]
            assert len(periods_v2) == 2
            p1_read = next(p for p in periods_v2 if p["id"] == str(period_v1_id))
            p2_read = next(p for p in periods_v2 if p["id"] == str(period_v2_id))
            assert p1_read["plan_version_id"] == str(v1_id)
            assert p1_read["plan_name"] == "General v1"
            assert p2_read["plan_version_id"] == str(v2_id)
            assert p2_read["plan_name"] == "General v2"

            # 7. Set plan to inactive status
            patch_res = client.patch(
                f"/api/v1/catalog/plans/{plan_id}",
                headers=admin_headers,
                json={"status": "inactive"},
            )
            assert patch_res.status_code == 200
            assert patch_res.json()["status"] == "inactive"

            # GET /catalog/plans?status=active excludes the inactive plan from new sales offers
            active_only = client.get("/api/v1/catalog/plans?status=active", headers=admin_headers)
            assert active_only.status_code == 200
            assert len(active_only.json()) == 0

            # History is preserved in DB and GET /api/v1/members/{member_id}/reload
            with factory() as session:
                assert session.get(Plan, plan_id).status == "inactive"
                assert len(session.scalars(select(PlanVersion).where(PlanVersion.plan_id == plan_id)).all()) == 2

            reload_final = client.get(f"/api/v1/members/{member_id}/reload", headers=recep_headers)
            assert reload_final.status_code == 200
            periods_final = reload_final.json()["active_periods"]
            assert len(periods_final) == 2
            p1_fin = next(p for p in periods_final if p["id"] == str(period_v1_id))
            p2_fin = next(p for p in periods_final if p["id"] == str(period_v2_id))
            assert p1_fin["plan_version_id"] == str(v1_id)
            assert p1_fin["plan_name"] == "General v1"
            assert p2_fin["plan_version_id"] == str(v2_id)
            assert p2_fin["plan_name"] == "General v2"
    finally:
        engine.dispose()


# ==============================================================================
# D-A5, D-A6, D-A7: Retained Behaviors (Audit flags scope, sync auth, admin idle timeout)
# ==============================================================================

def test_flow_a_d_a5_d_a6_d_a7_retained_behaviors(tmp_path):
    """D-A5: Permitted administrators may read sync audit flags across all branches, receptionists cannot.
    D-A6: Administrators may provision a sync device for any branch.
    D-A7: ADMIN_IDLE_SECONDS is retained at 30 days.
    """
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_1 = _seed_branch(factory, "flow-a-branch-1", "Branch 1")
        branch_2 = _seed_branch(factory, "flow-a-branch-2", "Branch 2")
        recep_id, recep_token = _seed_receptionist(factory, branch_1)
        admin_id = seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        # Seed device, contingency event and audit flag in branch 2
        with factory.begin() as session:
            dev = SyncDevice(
                branch_id=branch_2,
                device_prefix="REC-STA2",
                token_digest=sha256(b"token-test").hexdigest(),
                provisioned_by=admin_id,
                issued_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            )
            session.add(dev)
            session.flush()
            event = ContingencyEvent(
                device_id=dev.id,
                event_id="REC-STA2-000001",
                seq=1,
                event_type="shift.arqueo_close",
                schema_version=1,
                actor_staff_id=admin_id,
                payload={},
                payload_hash=sha256(b"{}").hexdigest(),
                client_recorded_at=datetime.now(timezone.utc),
                status="flagged_audit",
            )
            session.add(event)
            session.flush()
            flag = SyncAuditFlag(
                event_row_id=event.id,
                branch_id=branch_2,
                kind="orphan_shift_reference",
                details={"note": "Offline event reference"},
            )
            session.add(flag)

        with TestClient(app, raise_server_exceptions=True) as client:
            admin_headers = approved_admin_headers(client, delivery)
            recep_headers = {"Authorization": f"Bearer {recep_token}"}

            # D-A5: Permitted admin reads sync audit flags across all branches
            admin_flags = client.get("/api/v1/sync/audit-flags", headers=admin_headers)
            assert admin_flags.status_code == 200, admin_flags.text
            assert len(admin_flags.json()) >= 1

            # Receptionist cannot read audit flags (F-A1 / D-A5)
            recep_flags = client.get("/api/v1/sync/audit-flags", headers=recep_headers)
            assert recep_flags.status_code == 401

            # D-A6: Admin provisions a sync device for Branch 2 (even without specific branch assignment)
            dev_token, dev_prefix = _bootstrap_sync_device(
                client, branch_2, admin_headers["Authorization"].split()[1], station_code="STAB2"
            )
            assert dev_token is not None
            assert dev_prefix is not None

            with factory() as session:
                dev_db = session.scalars(select(SyncDevice).where(SyncDevice.branch_id == branch_2, SyncDevice.device_prefix == dev_prefix)).first()
                assert dev_db is not None
                assert dev_db.device_prefix == dev_prefix

            # D-A7: ADMIN_IDLE_SECONDS is retained at 30 days (2,592,000 seconds)
            assert ADMIN_IDLE_SECONDS == 30 * 24 * 60 * 60
    finally:
        engine.dispose()


# ==============================================================================
# D-A8: Closed-shift offline replay (identical retry accepted vs differing close flagged)
# ==============================================================================

def test_flow_a_d_a8_closed_shift_replay(tmp_path):
    """D-A8: When an offline shift.arqueo_close is resent after the shift is already closed:
    - If the close payload is identical: accepted as a retry without an AuditFlag.
    - If the close payload differs: flagged orphan_shift_reference for admin review.
    """
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "flow-a-d8", "D-A8 Branch")
        recep_id, recep_token = _seed_receptionist(factory, branch_id)
        admin_id = seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "reg-d8", "Caja D8")
            reg_id = register.id

        with TestClient(app, raise_server_exceptions=True) as client:
            admin_headers = approved_admin_headers(client, delivery)
            dev_token, dev_prefix = _bootstrap_sync_device(client, branch_id, recep_token, station_code="STAD8")

            # 1. Open shift via sync event
            open_res = _post_sync_event(
                client, dev_token, dev_prefix, 1, "shift.open",
                {"register_id": str(reg_id), "opening_cash_minor": 10000, "denomination_counts": []},
                actor_staff_id=recep_id,
            )
            assert open_res["status"] == "accepted"

            with factory() as session:
                shift = session.scalars(
                    select(Shift).where(Shift.cash_register_id == reg_id, Shift.status == "open")
                ).one()
                shift_id = shift.id

            # 2. Close shift via sync event (Initial close)
            close_payload = {
                "shift_ref": str(shift_id),
                "denomination_counts": [{"denomination_minor": 5000, "quantity": 2}],
                "voucher_count": 0,
                "closing_notes": "Close count exact 10,000",
            }
            close_res = _post_sync_event(client, dev_token, dev_prefix, 2, "shift.arqueo_close", close_payload, actor_staff_id=recep_id)
            assert close_res["status"] == "accepted"

            with factory() as session:
                closed_shift = session.get(Shift, shift_id)
                assert closed_shift.status == "closed"
                assert closed_shift.counted_cash_minor == 10000
                flags = session.scalars(select(SyncAuditFlag).where(SyncAuditFlag.shift_id == shift_id)).all()
                assert len(flags) == 0

            # 3. Replay with IDENTICAL close payload (sequence 3)
            # D-A8: Identical replay on already closed shift is accepted without raising an AuditFlag
            replay_res = _post_sync_event(client, dev_token, dev_prefix, 3, "shift.arqueo_close", close_payload, actor_staff_id=recep_id)
            assert replay_res["status"] == "accepted"
            assert replay_res.get("reason_code") is None

            with factory() as session:
                flags = session.scalars(select(SyncAuditFlag).where(SyncAuditFlag.shift_id == shift_id)).all()
                assert len(flags) == 0, "Identical close replay must not create an AuditFlag"

            # 4. Replay with DIFFERING close payload (sequence 4)
            # D-A8: Differing close must be flagged for review!
            diff_payload = {
                "shift_ref": str(shift_id),
                "denomination_counts": [{"denomination_minor": 5000, "quantity": 4}],  # 20,000 instead of 10,000
                "voucher_count": 0,
                "closing_notes": "Different close count",
            }
            diff_res = _post_sync_event(client, dev_token, dev_prefix, 4, "shift.arqueo_close", diff_payload, actor_staff_id=recep_id)
            assert diff_res["status"] == "flagged_audit"
            assert diff_res["reason_code"] == "orphan_shift_reference"

            with factory() as session:
                flags = session.scalars(select(SyncAuditFlag).where(SyncAuditFlag.shift_id == shift_id)).all()
                assert len(flags) == 1
                assert flags[0].kind == "orphan_shift_reference"

            # 5. Read endpoint GET /sync/audit-flags shows the flagged audit row to admin
            audit_flags_res = client.get("/api/v1/sync/audit-flags", headers=admin_headers)
            assert audit_flags_res.status_code == 200
            flag_items = audit_flags_res.json()
            assert any(f["shift_id"] == str(shift_id) for f in flag_items)
    finally:
        engine.dispose()
