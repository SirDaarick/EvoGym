"""End-to-End verification of Flow B: API Actions -> DB Persistence -> Frontend Read Contracts (S1-S4)."""

from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from admin_session_helpers import approved_admin_headers
from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session
from app.db.base import Base
from app.db.models.member_check_ins import MemberCheckInVisit
from app.db.models import (
    Branch,
    CashRegister,
    ContingencyEvent,
    Member,
    MemberCheckIn,
    MembershipDebt,
    MembershipDebtPayment,
    MembershipPeriod,
    Order,
    OrderItem,
    Payment,
    Plan,
    PlanVersion,
    RoleGrant,
    Shift,
    StaffCredential,
    StaffUser,
    SyncAuditFlag,
    SyncDevice,
)
from app.main import create_app
from app.shifts.queries import create_cash_register
from test_shifts import open_shift
from app.sync.envelope import payload_hash
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin


def _setup_db(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'flow_b_e2e.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    return url, engine, factory


def _seed_branch(factory, code="flow-b-central", name="Central Branch", tz="America/Mexico_City") -> UUID:
    with factory.begin() as session:
        branch = Branch(code=code, name=name, timezone=tz, is_active=True)
        session.add(branch)
        session.flush()
        return branch.id


def _seed_receptionist(factory, branch_id: UUID, login="recep@evogym.com", pin="1234") -> tuple[UUID, str]:
    with factory.begin() as session:
        staff = StaffUser(login_identifier=login)
        session.add(staff)
        session.flush()
        session.add_all([
            RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch_id, is_active=True),
            StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin(pin)),
        ])
        staff_id = staff.id

    now = datetime.now(timezone.utc)
    issued = issue_session(factory, login, pin, branch_id, now + timedelta(hours=1))
    return staff_id, issued.token


def _seed_plan_and_shift(factory, branch_id: UUID, receptionist_id: UUID, code: str, price_minor: int = 10000):
    with factory.begin() as session:
        plan = Plan(code=f"plan-{code.lower()}", name=f"Plan {code}", kind="membership", status="active")
        session.add(plan)
        session.flush()
        version = PlanVersion(
            plan_id=plan.id,
            version_number=1,
            name=f"Plan {code} Monthly",
            price_minor=price_minor,
            currency="MXN",
            duration_value=1,
            duration_unit="month",
            is_active=True,
        )
        session.add(version)
        session.flush()
        register = create_cash_register(session, branch_id, f"reg-{code.lower()}", f"Register {code}")
        open_shift(
            session,
            register_id=register.id,
            opened_by=receptionist_id,
            denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
        )
        return plan.id, version.id, register.id


def _bootstrap_sync_device(client: TestClient, branch_id: UUID, token: str, station_code: str = "SUR1") -> tuple[str, str, str]:
    res = client.post(
        "/api/v1/sync/bootstrap",
        json={"station_code": station_code},
        headers={"Authorization": f"Bearer {token}", "X-Branch-ID": str(branch_id)},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    device_data = data["device"]
    cursor = data.get("cursor")
    cursor_str = f"{cursor['changed_at']}|{cursor['id']}" if cursor else f"{(datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()}|00000000-0000-0000-0000-000000000000"
    return device_data["token"], device_data["device_prefix"], cursor_str


# ---------------------------------------------------------------------------
# S1 — Shared Phones in Registration & Lookup
# ---------------------------------------------------------------------------

def test_flow_b_s1_shared_phones_registration_and_lookup(tmp_path):
    """S1: Reception creates Member A and Member B with identical phone number.

    - DB verification: both rows in Member table exist with phone_search_key == "5512345678".
    - Frontend endpoint GET /api/v1/members?q=5512345678 returns both members with name and number.
    """
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "flow-b-s1", "S1 Branch")
        _, recep_token = _seed_receptionist(factory, branch_id)
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        with TestClient(app) as client:
            headers = {"Authorization": f"Bearer {recep_token}"}

            # 1. Register Member A with formatted phone 55-1234-5678
            res_a = client.post(
                "/api/v1/members",
                headers=headers,
                json={
                    "member_number": "SOC-S1-001",
                    "full_name": "Valeria Ramirez",
                    "phone": "55-1234-5678",
                },
            )
            assert res_a.status_code == 201, res_a.text
            member_a_id = UUID(res_a.json()["id"])

            # 2. Register Member B with unformatted phone 5512345678
            res_b = client.post(
                "/api/v1/members",
                headers=headers,
                json={
                    "member_number": "SOC-S1-002",
                    "full_name": "Santiago Ramirez",
                    "phone": "5512345678",
                },
            )
            assert res_b.status_code == 201, res_b.text
            member_b_id = UUID(res_b.json()["id"])

            # 3. DB Direct Row Inspection (SQLAlchemy select)
            with factory() as session:
                rows = session.execute(
                    select(Member).where(Member.phone_key == "5512345678").order_by(Member.member_number.asc())
                ).scalars().all()
                assert len(rows) == 2
                member_a_db, member_b_db = rows[0], rows[1]

                assert member_a_db.id == member_a_id
                assert member_a_db.full_name == "Valeria Ramirez"
                assert member_a_db.phone == "55-1234-5678"
                assert member_a_db.phone_key == "5512345678"

                assert member_b_db.id == member_b_id
                assert member_b_db.full_name == "Santiago Ramirez"
                assert member_b_db.phone == "5512345678"
                assert member_b_db.phone_key == "5512345678"

            # 4. Frontend Consumption Endpoint Inspection (GET /api/v1/members?search=5512345678)
            get_search = client.get("/api/v1/members?search=5512345678", headers=headers)
            assert get_search.status_code == 200, get_search.text
            items = get_search.json()["items"]
            assert len(items) == 2
            returned_numbers = {it["member_number"]: it["full_name"] for it in items}
            assert returned_numbers == {
                "SOC-S1-001": "Valeria Ramirez",
                "SOC-S1-002": "Santiago Ramirez",
            }
    finally:
        engine.dispose()


# ---------------------------------------------------------------------------
# S2 — Membership Sale with Debt -> Check-in Confirmation -> Admin Alert -> Repayment
# ---------------------------------------------------------------------------

def test_flow_b_s2_membership_sale_debt_checkin_alert_repayment(tmp_path):
    """S2: Full debt lifecycle across API, DB persistence, and frontend read contracts.

    1. Sale with debt balance: Order & Period created in DB; reload shows has_pending_balance=True,
       access_status="restricted_unpaid"; sync delta reports has_debt=True, access="valid_with_outstanding_balance".
    2. Check-in without confirmation: 409 debt_confirmation_required; 0 check-ins and visits in DB; alert list empty.
    3. Check-in with confirmation: 201; MemberCheckIn row with outstanding_balance and
       outstanding_balance_confirmed warnings, and MemberCheckInVisit row created in DB.
    4. Frontend debt alerts: Admin role receives alert item with name/number/time; Receptionist receives 403.
    5. Debt repayment: debt payment endpoint clears balance; DB debt is 0; sync delta reports has_debt=False and access="valid".
    """
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "flow-b-s2", "S2 Branch")
        receptionist_id, recep_token = _seed_receptionist(factory, branch_id)
        admin_id = seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        _, plan_version_id, register_id = _seed_plan_and_shift(
            factory, branch_id, receptionist_id, "S2PLAN", price_minor=10000
        )

        with TestClient(app) as client:
            recep_headers = {"Authorization": f"Bearer {recep_token}"}
            admin_headers = approved_admin_headers(client, delivery)

            # Provision device for sync delta verification
            device_token, _, cursor = _bootstrap_sync_device(client, branch_id, recep_token, station_code="STA2")
            device_headers = {"Authorization": f"Bearer {device_token}"}

            # 1. Register Member
            reg_res = client.post(
                "/api/v1/members",
                headers=recep_headers,
                json={"member_number": "SOC-S2-100", "full_name": "Daniel Morales", "phone": "5551230000"},
            )
            assert reg_res.status_code == 201
            member_id = UUID(reg_res.json()["id"])

            # 2. Sell membership with partial cash (4,000 paid / 6,000 debt on a 10,000 plan)
            sale_res = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={**recep_headers, "Idempotency-Key": "sale-s2-debt-001"},
                json={
                    "member_id": str(member_id),
                    "plan_version_id": str(plan_version_id),
                    "cash_amount_minor": 4000,
                },
            )
            assert sale_res.status_code == 201, sale_res.text
            period_id = UUID(sale_res.json()["membership"]["id"])
            order_id = UUID(sale_res.json()["order"]["id"])

            # 3. DB Direct Inspection (Order, MembershipPeriod, MembershipDebt)
            with factory() as session:
                order_row = session.execute(select(Order).where(Order.id == order_id)).scalar_one()
                assert order_row.total_minor == 10000
                assert order_row.member_id == member_id

                period_row = session.execute(select(MembershipPeriod).where(MembershipPeriod.id == period_id)).scalar_one()
                assert period_row.member_id == member_id

                debt_row = session.execute(select(MembershipDebt).where(MembershipDebt.order_id == order_id)).scalar_one()
                assert debt_row.initial_outstanding_minor == 6000
                assert debt_row.member_id == member_id

            # 4. Frontend Consumption: Member Reload & Sync Delta
            reload_res = client.get(f"/api/v1/members/{member_id}/reload", headers=recep_headers)
            assert reload_res.status_code == 200, reload_res.text
            reload_data = reload_res.json()
            assert reload_data["financial"]["has_pending_balance"] is True
            assert reload_data["active_periods"][0]["access_status"] == "restricted_unpaid"

            delta_res = client.get(f"/api/v1/sync/roster-delta?cursor={cursor}", headers=device_headers)
            assert delta_res.status_code == 200, delta_res.text
            members_delta = {m["member_id"]: m for m in delta_res.json()["members"]}
            assert str(member_id) in members_delta
            roster_member = members_delta[str(member_id)]
            assert roster_member["has_debt"] is True
            assert roster_member["active_periods"][0]["access"] == "valid_with_outstanding_balance"

            # 5. Check-in attempt WITHOUT confirmation (confirm_outstanding_balance=False)
            checkin_path = f"/api/v1/member-check-ins/branches/{branch_id}/periods/{period_id}"
            denied_res = client.post(
                checkin_path,
                headers={**recep_headers, "Idempotency-Key": "checkin-s2-unconfirmed"},
                json={"confirm_outstanding_balance": False},
            )
            assert denied_res.status_code == 409, denied_res.text
            assert denied_res.json()["error"]["code"] == "debt_confirmation_required"

            # Verify DB: 0 MemberCheckIn and 0 MemberCheckInVisit rows created
            with factory() as session:
                checkins = session.scalars(select(MemberCheckIn).where(MemberCheckIn.member_id == member_id)).all()
                assert len(checkins) == 0
                visits = session.scalars(select(MemberCheckInVisit).where(MemberCheckInVisit.member_id == member_id)).all()
                assert len(visits) == 0

            # Verify debt-alerts list is empty
            alerts_path = f"/api/v1/member-check-ins/branches/{branch_id}/debt-alerts"
            admin_alerts_initial = client.get(alerts_path, headers=admin_headers)
            assert admin_alerts_initial.status_code == 200
            assert admin_alerts_initial.json() == []

            # 6. Check-in confirmed with debt (confirm_outstanding_balance=True)
            confirmed_res = client.post(
                checkin_path,
                headers={**recep_headers, "Idempotency-Key": "checkin-s2-confirmed"},
                json={"confirm_outstanding_balance": True},
            )
            assert confirmed_res.status_code == 201, confirmed_res.text
            check_in_id = UUID(confirmed_res.json()["id"])
            visit_id = UUID(confirmed_res.json()["visit_id"])

            # Verify DB: MemberCheckIn and MemberCheckInVisit persisted with correct warning markers
            with factory() as session:
                check_in_row = session.execute(select(MemberCheckIn).where(MemberCheckIn.id == check_in_id)).scalar_one()
                assert check_in_row.member_id == member_id
                assert "outstanding_balance" in check_in_row.access_warnings
                assert "outstanding_balance_confirmed" in check_in_row.access_warnings

                visit_row = session.execute(select(MemberCheckInVisit).where(MemberCheckInVisit.id == visit_id)).scalar_one()
                assert visit_row.member_id == member_id
                assert check_in_row.visit_id == visit_row.id

            # 7. Frontend Debt Alerts Consumption: Admin sees alert, Reception receives 403
            recep_forbidden = client.get(alerts_path, headers=recep_headers)
            assert recep_forbidden.status_code == 403

            admin_alerts = client.get(alerts_path, headers=admin_headers)
            assert admin_alerts.status_code == 200
            alert_items = admin_alerts.json()
            assert len(alert_items) == 1
            alert_entry = alert_items[0]
            assert alert_entry["id"] == str(check_in_id)
            assert alert_entry["member_name"] == "Daniel Morales"
            assert alert_entry["member_number"] == "SOC-S2-100"
            assert "occurred_at" in alert_entry

            # 8. Pay off remaining debt (6,000 minor)
            repay_res = client.post(
                f"/api/v1/registers/{register_id}/membership-debt-payments",
                headers={**recep_headers, "Idempotency-Key": "repay-s2-full"},
                json={"order_id": str(order_id), "amount_minor": 6000},
            )
            assert repay_res.status_code == 201, repay_res.text
            assert repay_res.json()["remaining_balance_minor"] == 0

            # Verify DB debt is 0
            with factory() as session:
                payments_sum = session.scalar(
                    select(func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0))
                    .join(MembershipDebt, MembershipDebt.id == MembershipDebtPayment.debt_id)
                    .where(MembershipDebt.order_id == order_id)
                )
                assert payments_sum == 6000

            # Verify Frontend sync delta reports has_debt=False and access="valid"
            delta_cleared = client.get(f"/api/v1/sync/roster-delta?cursor={cursor}", headers=device_headers)
            assert delta_cleared.status_code == 200
            cleared_members = {m["member_id"]: m for m in delta_cleared.json()["members"]}
            roster_cleared = cleared_members[str(member_id)]
            assert roster_cleared["has_debt"] is False
            assert roster_cleared["active_periods"][0]["access"] == "valid"
    finally:
        engine.dispose()


# ---------------------------------------------------------------------------
# S3 — 31-Day Inactivity Status & Branch Timezone
# ---------------------------------------------------------------------------

def test_flow_b_s3_inactivity_status_and_branch_timezone(tmp_path):
    """S3: Status computation based on branch timezone date boundaries.

    - 10 days expired: returns status="expired" in GET /members and GET /members/{id}.
    - 31 days expired: returns status="inactive" in GET /members and GET /members/{id}.
    - When an inactive member buys a new membership: status returns to "active", and check-in
      succeeds normally (201) without any extra blockage.
    """
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "flow-b-s3", "S3 Branch", tz="America/Mexico_City")
        receptionist_id, recep_token = _seed_receptionist(factory, branch_id)
        seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        _, plan_version_id, register_id = _seed_plan_and_shift(
            factory, branch_id, receptionist_id, "S3PLAN", price_minor=10000
        )

        with factory() as session:
            branch = session.get(Branch, branch_id)
            today = datetime.now(ZoneInfo(branch.timezone)).date()

        with TestClient(app) as client:
            headers = {"Authorization": f"Bearer {recep_token}"}

            # 1. Register Member 1 (10 days expired) and Member 2 (31 days expired)
            m1_res = client.post("/api/v1/members", headers=headers, json={
                "member_number": "SOC-S3-EXP10", "full_name": "Elena Expired", "phone": "5551110010"
            })
            assert m1_res.status_code == 201
            m1_id = UUID(m1_res.json()["id"])

            m2_res = client.post("/api/v1/members", headers=headers, json={
                "member_number": "SOC-S3-INACT31", "full_name": "Ignacio Inactive", "phone": "5551110031"
            })
            assert m2_res.status_code == 201
            m2_id = UUID(m2_res.json()["id"])

            # 2. Directly seed periods in DB: 10 days ago vs 31 days ago in branch timezone
            with factory.begin() as session:
                session.add_all([
                    MembershipPeriod(
                        id=uuid4(),
                        member_id=m1_id,
                        order_item_id=uuid4(),
                        plan_version_id=plan_version_id,
                        starts_on=today - timedelta(days=40),
                        ends_on=today - timedelta(days=10),
                        activated_by=receptionist_id,
                    ),
                    MembershipPeriod(
                        id=uuid4(),
                        member_id=m2_id,
                        order_item_id=uuid4(),
                        plan_version_id=plan_version_id,
                        starts_on=today - timedelta(days=61),
                        ends_on=today - timedelta(days=31),
                        activated_by=receptionist_id,
                    ),
                ])

            # 3. Verify Frontend GET /api/v1/members list endpoint
            list_res = client.get("/api/v1/members?limit=50", headers=headers)
            assert list_res.status_code == 200, list_res.text
            items_by_num = {it["member_number"]: it for it in list_res.json()["items"]}

            assert items_by_num["SOC-S3-EXP10"]["membership_status"] == "expired"
            assert items_by_num["SOC-S3-EXP10"]["status"] == "expired"

            assert items_by_num["SOC-S3-INACT31"]["membership_status"] == "inactive"
            assert items_by_num["SOC-S3-INACT31"]["status"] == "inactive"

            # 4. Verify Frontend GET /api/v1/members/{id} detail endpoint
            m1_detail = client.get(f"/api/v1/members/{m1_id}", headers=headers)
            assert m1_detail.status_code == 200
            assert m1_detail.json()["membership_status"] == "expired"
            assert m1_detail.json()["status"] == "expired"

            m2_detail = client.get(f"/api/v1/members/{m2_id}", headers=headers)
            assert m2_detail.status_code == 200
            assert m2_detail.json()["membership_status"] == "inactive"
            assert m2_detail.json()["status"] == "inactive"

            # 5. Inactive member buys a new membership
            new_sale = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={**headers, "Idempotency-Key": "sale-s3-reactivate"},
                json={"member_id": str(m2_id), "plan_version_id": str(plan_version_id)},
            )
            assert new_sale.status_code == 201, new_sale.text
            new_period_id = UUID(new_sale.json()["membership"]["id"])

            # 6. Verify status returns to "active" in both endpoints
            m2_list_after = client.get("/api/v1/members?search=SOC-S3-INACT31", headers=headers)
            assert m2_list_after.status_code == 200
            m2_item_after = m2_list_after.json()["items"][0]
            assert m2_item_after["membership_status"] == "active"
            assert m2_item_after["status"] == "active"

            m2_detail_after = client.get(f"/api/v1/members/{m2_id}", headers=headers)
            assert m2_detail_after.status_code == 200
            assert m2_detail_after.json()["membership_status"] == "active"
            assert m2_detail_after.json()["status"] == "active"

            # 7. Check-in proceeds normally (201) with NO extra restriction/block
            checkin_res = client.post(
                f"/api/v1/member-check-ins/branches/{branch_id}/periods/{new_period_id}",
                headers={**headers, "Idempotency-Key": "checkin-s3-reactivated"},
            )
            assert checkin_res.status_code == 201, checkin_res.text
            assert checkin_res.json()["access_reason"] == "valid"

            with factory() as session:
                checkins = session.scalars(select(MemberCheckIn).where(MemberCheckIn.member_id == m2_id)).all()
                assert len(checkins) == 1
    finally:
        engine.dispose()


# ---------------------------------------------------------------------------
# S4 — Offline Contingency Check-in Sync -> DB -> Frontend Delta/Alerts
# ---------------------------------------------------------------------------

def test_flow_b_s4_offline_contingency_checkin_sync_and_replay(tmp_path):
    """S4: Offline check-in ingestion, reconciliation, idempotent replay, and alert reflection.

    1. Ingest offline attendance.check_in event with confirm_outstanding_balance=True on member with debt.
    2. DB verification: ContingencyEvent is reconciled ('accepted', result_check_in_id not None),
       MemberCheckIn and MemberCheckInVisit rows are persisted with debt warning flags.
    3. Frontend alerts verification: GET /branches/{id}/debt-alerts reflects the confirmed offline entry.
    4. Replay verification: Ingesting again or replaying with online_idempotency_key creates 0 duplicate rows.
    """
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "flow-b-s4", "S4 Branch")
        receptionist_id, recep_token = _seed_receptionist(factory, branch_id)
        admin_id = seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        _, plan_version_id, register_id = _seed_plan_and_shift(
            factory, branch_id, receptionist_id, "S4PLAN", price_minor=10000
        )

        with TestClient(app) as client:
            recep_headers = {"Authorization": f"Bearer {recep_token}"}
            admin_headers = approved_admin_headers(client, delivery)

            device_token, prefix, _ = _bootstrap_sync_device(client, branch_id, recep_token, station_code="STA4")
            device_headers = {"Authorization": f"Bearer {device_token}"}

            # 1. Register Member and Sale with Debt
            reg_res = client.post("/api/v1/members", headers=recep_headers, json={
                "member_number": "SOC-S4-001", "full_name": "Carla Contingency", "phone": "5559870001"
            })
            assert reg_res.status_code == 201
            member_id = UUID(reg_res.json()["id"])

            sale_res = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={**recep_headers, "Idempotency-Key": "sale-s4-debt"},
                json={"member_id": str(member_id), "plan_version_id": str(plan_version_id), "cash_amount_minor": 3000},
            )
            assert sale_res.status_code == 201
            period_id = UUID(sale_res.json()["membership"]["id"])

            # 2. Ingest offline attendance.check_in event with confirm_outstanding_balance=True via POST /api/v1/sync/events
            now_utc = datetime.now(timezone.utc)
            event_id = f"{prefix}-00001"
            payload = {
                "member_id": str(member_id),
                "period_id": str(period_id),
                "branch_id": str(branch_id),
                "local_access_decision": "valid_with_outstanding_balance",
                "confirm_outstanding_balance": True,
            }
            event_envelope = {
                "event_id": event_id,
                "seq": 1,
                "event_type": "attendance.check_in",
                "schema_version": 1,
                "actor_staff_id": str(receptionist_id),
                "payload": payload,
                "payload_hash": payload_hash(payload),
                "client_recorded_at": now_utc.isoformat(),
                "clock_anchor_utc": now_utc.isoformat(),
                "clock_monotonic_delta_ms": 0,
            }

            upload_res = client.post(
                "/api/v1/sync/contingency-events",
                headers=device_headers,
                json={"events": [event_envelope]},
            )
            assert upload_res.status_code == 200, upload_res.text
            ingested = upload_res.json()["ingested"]
            assert len(ingested) == 1
            assert ingested[0]["status"] == "accepted"
            assert ingested[0]["reason_code"] is None

            # 3. DB Direct Inspection: ContingencyEvent reconciled, MemberCheckIn and MemberCheckInVisit rows persisted
            with factory() as session:
                ce = session.execute(
                    select(ContingencyEvent).where(ContingencyEvent.event_id == event_id)
                ).scalar_one()
                assert ce.status == "accepted"
                assert ce.result_check_in_id is not None

                check_in = session.execute(
                    select(MemberCheckIn).where(MemberCheckIn.id == ce.result_check_in_id)
                ).scalar_one()
                assert check_in.member_id == member_id
                assert "outstanding_balance" in check_in.access_warnings
                assert "outstanding_balance_confirmed" in check_in.access_warnings

                visit = session.execute(
                    select(MemberCheckInVisit).where(MemberCheckInVisit.id == check_in.visit_id)
                ).scalar_one()
                assert visit.member_id == member_id

            # 4. Frontend Alerts Endpoint reflects the confirmed offline check-in
            alerts_path = f"/api/v1/member-check-ins/branches/{branch_id}/debt-alerts"
            admin_alerts = client.get(alerts_path, headers=admin_headers)
            assert admin_alerts.status_code == 200
            alert_items = admin_alerts.json()
            assert len(alert_items) == 1
            assert alert_items[0]["id"] == str(ce.result_check_in_id)
            assert alert_items[0]["member_name"] == "Carla Contingency"
            assert alert_items[0]["member_number"] == "SOC-S4-001"

            # 5. Exact event replay: Ingesting the same event again produces no duplicates
            replay_res = client.post(
                "/api/v1/sync/contingency-events",
                headers=device_headers,
                json={"events": [event_envelope]},
            )
            assert replay_res.status_code == 200
            assert replay_res.json()["ingested"][0]["status"] == "accepted"

            with factory() as session:
                total_checkins = session.scalar(
                    select(func.count(MemberCheckIn.id)).where(MemberCheckIn.member_id == member_id)
                )
                assert total_checkins == 1
                total_visits = session.scalar(
                    select(func.count(MemberCheckInVisit.id)).where(MemberCheckInVisit.member_id == member_id)
                )
                assert total_visits == 1

            # 6. Uncertain online request key replay
            # First, online check-in succeeds with confirm_outstanding_balance=True and key="uncertain-online-key-4"
            online_key = "uncertain-online-key-4"
            online_checkin = client.post(
                f"/api/v1/member-check-ins/branches/{branch_id}/periods/{period_id}",
                headers={**recep_headers, "Idempotency-Key": online_key},
                json={"confirm_outstanding_balance": True},
            )
            assert online_checkin.status_code == 201
            online_checkin_id = UUID(online_checkin.json()["id"])

            with factory() as session:
                assert session.scalar(select(func.count(MemberCheckIn.id)).where(MemberCheckIn.member_id == member_id)) == 2

            # Now an offline contingency event arrives carrying the same online_idempotency_key
            replay_payload = {
                **payload,
                "online_idempotency_key": online_key,
                "confirm_outstanding_balance": True,
            }
            replay_event = {
                "event_id": f"{prefix}-00002",
                "seq": 2,
                "event_type": "attendance.check_in",
                "schema_version": 1,
                "actor_staff_id": str(receptionist_id),
                "payload": replay_payload,
                "payload_hash": payload_hash(replay_payload),
                "client_recorded_at": now_utc.isoformat(),
                "clock_anchor_utc": now_utc.isoformat(),
                "clock_monotonic_delta_ms": 0,
            }
            reconcile_res = client.post(
                "/api/v1/sync/contingency-events",
                headers=device_headers,
                json={"events": [replay_event]},
            )
            assert reconcile_res.status_code == 200
            assert reconcile_res.json()["ingested"][0]["status"] == "accepted"

            with factory() as session:
                # Count MUST remain 2: no extra duplicate MemberCheckIn created
                assert session.scalar(select(func.count(MemberCheckIn.id)).where(MemberCheckIn.member_id == member_id)) == 2
                event_row = session.execute(select(ContingencyEvent).where(ContingencyEvent.event_id == f"{prefix}-00002")).scalar_one()
                assert event_row.status == "accepted"
                assert event_row.result_check_in_id == online_checkin_id
    finally:
        engine.dispose()
