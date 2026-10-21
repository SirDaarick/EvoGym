from datetime import datetime, timezone
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event, func, select, text
from sqlalchemy.exc import IntegrityError

from app.db.models import Branch, CashRegister, Member, MembershipDebt, MembershipPeriod, Order, OrderItem, Payment, Plan, PlanVersion, Shift
from app.memberships.eligibility import is_membership_period_eligible
from app.main import create_app
from app.sales.queries import _add_duration, post_membership_cash_sale
from app.shifts.queries import close_shift
from test_admin_auth import configured_settings
from test_shifts import _seed_receptionist, _setup_db, _seed_branch, open_shift


def test_cash_membership_sale_activates_once_on_an_authorized_open_shift(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            member = Member(member_number="SOC-1001", full_name="Synthetic Member", phone="5550100")
            plan = Plan(code="gym-month", name="Gym Month", kind="membership", status="active")
            session.add_all([member, plan])
            branch = session.get(Branch, branch_id)
            branch.timezone = "America/Tijuana"
            session.flush()
            version = PlanVersion(
                plan_id=plan.id,
                version_number=1,
                name="Gym Month 2026",
                price_minor=125000,
                currency="MXN",
                duration_value=1,
                duration_unit="month",
                is_active=True,
            )
            session.add(version)
            session.flush()
            member_id, version_id = member.id, version.id
            from app.shifts.queries import create_cash_register
            register = create_cash_register(session, branch_id, "cash-01", "Front Desk")
            register_id = register.id
            open_shift(
                session,
                register_id=register_id,
                opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            )

        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            response = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "cash-sale-001"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)},
            )
            assert response.status_code == 201, response.text
            first = response.json()
            assert first["payment"]["method"] == "cash"
            assert first["payment"]["status"] == "confirmed"
            assert first["payment"]["amount_minor"] == 125000
            assert first["order"]["seller_id"] == str(staff_id)
            assert first["membership"]["member_id"] == str(member_id)

            replay = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "cash-sale-001"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)},
            )
            assert replay.status_code == 200, replay.text
            assert replay.json() == first

            conflicting_replay = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "cash-sale-001"},
                json={"member_id": str(uuid4()), "plan_version_id": str(version_id)},
            )
            assert conflicting_replay.status_code == 409

            client_total = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "cash-sale-002"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id), "total_minor": 1},
            )
            assert client_total.status_code == 422

            second = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "cash-sale-003"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)},
            )
            assert second.status_code == 201, second.text
            assert second.json()["membership"]["starts_on"] == first["membership"]["ends_on"]

            local_today = datetime.now(timezone.utc).astimezone(ZoneInfo("America/Tijuana")).date()
            assert first["membership"]["starts_on"] == local_today.isoformat()
            assert first["membership"]["ends_on"] == _add_duration(local_today, 1, "month").isoformat()

        with factory() as session:
            periods = session.scalars(select(MembershipPeriod).order_by(MembershipPeriod.starts_on)).all()
            assert len(periods) == 2
            assert all(period.member_id == member_id for period in periods)
            assert session.scalar(select(func.count()).select_from(Order)) == 2
            assert session.scalar(select(func.count()).select_from(OrderItem)) == 2
            assert session.scalar(select(func.count()).select_from(Payment)) == 2
            assert session.scalar(select(func.count()).select_from(MembershipDebt)) == 0
    finally:
        engine.dispose()


def test_partial_membership_cash_sale_records_received_cash_and_operational_warning(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "partial-branch", "Partial Branch")
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            member = Member(member_number="SOC-PARTIAL", full_name="Partial Member", phone="5550177")
            other_member = Member(member_number="SOC-PARTIAL-OTHER", full_name="Other Member", phone="5550178")
            plan = Plan(code="partial-month", name="Partial Month", kind="membership", status="active")
            free_plan = Plan(code="free-month", name="Free Month", kind="membership", status="active")
            session.add_all([member, other_member, plan, free_plan])
            session.flush()
            version = PlanVersion(plan_id=plan.id, version_number=1, name="Partial Month v1", price_minor=12500,
                                  currency="MXN", duration_value=1, duration_unit="month", is_active=True)
            session.add(version)
            session.flush()
            free_version = PlanVersion(plan_id=free_plan.id, version_number=1, name="Free Month v1", price_minor=0,
                                       currency="MXN", duration_value=1, duration_unit="month", is_active=True)
            session.add(free_version)
            session.flush()
            from app.shifts.queries import create_cash_register
            register = create_cash_register(session, branch_id, "partial-register", "Partial Register")
            shift = open_shift(session, register_id=register.id, opened_by=staff_id,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            member_id, other_member_id, version_id, free_version_id, register_id, shift_id = (
                member.id, other_member.id, version.id, free_version.id, register.id, shift.id
            )

        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "partial-cash-001"}
            path = f"/api/v1/registers/{register_id}/membership-sales"
            payload = {"member_id": str(member_id), "plan_version_id": str(version_id), "cash_amount_minor": 5000}
            response = client.post(path, headers=headers, json=payload)
            assert response.status_code == 201, response.text
            sale = response.json()
            assert sale["order"]["total_minor"] == 12500
            assert sale["item"]["unit_amount_minor"] == sale["item"]["line_total_minor"] == 12500
            assert sale["payment"]["amount_minor"] == 5000
            assert sale["membership"] is not None

            replay = client.post(path, headers=headers, json=payload)
            assert replay.status_code == 200
            assert replay.json() == sale
            mismatch = client.post(path, headers=headers, json={**payload, "cash_amount_minor": 6000})
            assert mismatch.status_code == 409

            detail = client.get(f"/api/v1/members/{member_id}", headers={"Authorization": f"Bearer {token}"})
            assert detail.status_code == 200, detail.text
            assert detail.json()["pending_balance_minor"] == 7500
            assert detail.json()["has_pending_balance"] is True
            assert "orders" not in detail.json() and "payments" not in detail.json()
            other_detail = client.get(
                f"/api/v1/members/{other_member_id}", headers={"Authorization": f"Bearer {token}"}
            )
            assert other_detail.status_code == 200
            assert other_detail.json()["pending_balance_minor"] == 0
            assert other_detail.json()["has_pending_balance"] is False
            for invalid_amount in (None, 0, -1, True, 12501):
                invalid = client.post(
                    path,
                    headers={"Authorization": f"Bearer {token}", "Idempotency-Key": f"invalid-{invalid_amount}"},
                    json={"member_id": str(member_id), "plan_version_id": str(version_id),
                          "cash_amount_minor": invalid_amount},
                )
                assert invalid.status_code == 422

            free_sale = client.post(
                path,
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "partial-test-free-plan"},
                json={"member_id": str(other_member_id), "plan_version_id": str(free_version_id)},
            )
            assert free_sale.status_code == 201, free_sale.text
            assert free_sale.json()["payment"]["amount_minor"] == 0
            assert free_sale.json()["order"]["total_minor"] == 0
            assert free_sale.json()["membership"] is not None

            from app.shifts.queries import close_shift
            with factory.begin() as session:
                closed = close_shift(
                    session, shift_id=shift_id, closed_by=staff_id,
                    denomination_counts=[{"denomination_minor": 100, "quantity": 50}],
                )
                assert closed.shift.expected_cash_at_close_minor == 5000
            with factory() as session:
                assert is_membership_period_eligible(
                    session, UUID(sale["membership"]["id"]),
                    datetime.fromisoformat(sale["order"]["created_at"]).date(),
                )
                assert session.scalar(select(func.count()).select_from(Order)) == 2
                assert session.scalar(select(func.count()).select_from(Payment)) == 2
                assert session.scalar(select(func.count()).select_from(MembershipDebt)) == 1
                assert session.get(Member, member_id).status == "active"
                debt = session.scalar(select(MembershipDebt))
                with pytest.raises(ValueError, match="immutable"):
                    debt.initial_outstanding_minor = 1
                    session.flush()
            transfer = client.post(
                f"/api/v1/registers/{register_id}/membership-transfer-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "no-transfer-partial"},
                json={**payload, "cash_amount_minor": 5000},
            )
            assert transfer.status_code == 422
    finally:
        engine.dispose()


def test_pending_membership_transfer_does_not_activate_or_count_as_cash(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "transfer-branch", "Transfer Branch")
        other_branch_id = _seed_branch(factory, "transfer-other", "Transfer Other")
        staff_id, token = _seed_receptionist(factory, branch_id)
        other_staff_id, other_token = _seed_receptionist(factory, other_branch_id, "transfer-other@example.invalid")
        with factory.begin() as session:
            member = Member(member_number="SOC-XFER", full_name="Transfer Member", phone="5550199")
            plan = Plan(code="transfer-month", name="Transfer Month", kind="membership", status="active")
            session.add_all([member, plan])
            session.flush()
            version = PlanVersion(plan_id=plan.id, version_number=1, name="Transfer Month",
                                  price_minor=9000, currency="MXN", duration_value=1,
                                  duration_unit="month", is_active=True)
            inactive_version = PlanVersion(plan_id=plan.id, version_number=2, name="Inactive Transfer Month",
                                            price_minor=9000, currency="MXN", duration_value=1,
                                            duration_unit="month", is_active=False)
            unpublished_plan = Plan(code="unpublished-transfer", name="Unpublished Transfer",
                                    kind="membership", status="inactive")
            session.add(unpublished_plan)
            session.flush()
            unpublished_version = PlanVersion(plan_id=unpublished_plan.id, version_number=1,
                                               name="Unpublished Transfer Month", price_minor=9000,
                                               currency="MXN", duration_value=1,
                                               duration_unit="month", is_active=True)
            session.add_all([version, inactive_version, unpublished_version])
            session.flush()
            from app.shifts.queries import create_cash_register
            register = create_cash_register(session, branch_id, "transfer-register", "Transfer Register")
            other_register = create_cash_register(session, other_branch_id, "transfer-other-register", "Other Register")
            open_shift(session, register_id=register.id, opened_by=staff_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            open_shift(session, register_id=other_register.id, opened_by=other_staff_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            member_id, version_id, register_id = member.id, version.id, register.id
            inactive_version_id, unpublished_version_id = inactive_version.id, unpublished_version.id

        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "transfer-001"}
            path = f"/api/v1/registers/{register_id}/membership-transfer-sales"
            payload = {"member_id": str(member_id), "plan_version_id": str(version_id)}
            assert client.post(path, headers={"Idempotency-Key": "transfer-unauth"}, json=payload).status_code == 401
            denied = client.post(
                path, headers={"Authorization": f"Bearer {other_token}", "Idempotency-Key": "transfer-scope"},
                json=payload,
            )
            assert denied.status_code == 403
            response = client.post(path, headers=headers, json=payload)
            assert response.status_code == 201, response.text
            first = response.json()
            assert first["payment"]["method"] == "transfer"
            assert first["payment"]["status"] == "under_review"
            assert first["payment"]["amount_minor"] == 9000
            assert first["membership"] is not None

            replay = client.post(path, headers=headers, json=payload)
            assert replay.status_code == 200
            assert replay.json() == first
            unsupported_source = client.post(
                path, headers=headers, json={**payload, "source_shift_id": str(uuid4())},
            )
            assert unsupported_source.status_code == 422
            partial_transfer = client.post(
                path,
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "no-transfer-partial"},
                json={**payload, "cash_amount_minor": 5000},
            )
            assert partial_transfer.status_code == 422
            assert client.post(path, headers=headers, json=payload).json() == first
            mismatch = client.post(path, headers=headers, json={**payload, "member_id": str(uuid4())})
            assert mismatch.status_code == 409

            inactive = client.post(
                path, headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "transfer-inactive"},
                json={**payload, "plan_version_id": str(inactive_version_id)},
            )
            assert inactive.status_code == 404
            unpublished = client.post(
                path, headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "transfer-unpublished"},
                json={**payload, "plan_version_id": str(unpublished_version_id)},
            )
            assert unpublished.status_code == 404
            with factory.begin() as session:
                session.scalar(select(Shift).where(Shift.cash_register_id == register_id)).status = "closed"
            closed_shift = client.post(
                path, headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "transfer-closed-shift"},
                json=payload,
            )
            assert closed_shift.status_code == 409

        with factory() as session:
            assert session.scalar(select(func.count()).select_from(Order)) == 1
            assert session.scalar(select(func.count()).select_from(OrderItem)) == 1
            assert session.scalar(select(func.count()).select_from(Payment)) == 1
            assert session.scalar(select(func.count()).select_from(MembershipPeriod)) == 1
            payment = session.scalar(select(Payment))
            assert (payment.method, payment.status, payment.amount_minor) == ("transfer", "under_review", 9000)
            order = session.scalar(select(Order))
            assert order.financial_shift_id is None
            assert order.cash_included_in_opening is False
    finally:
        engine.dispose()


def test_overtime_sale_links_to_next_shift_without_double_counting_opening_cash(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "overtime", "Overtime Branch")
        staff_id, token = _seed_receptionist(factory, branch_id, "overtime@example.invalid")
        with factory.begin() as session:
            member = Member(member_number="SOC-OT", full_name="Overtime Member", phone="5550111")
            plan = Plan(code="overtime-month", name="Overtime Month", kind="membership", status="active")
            session.add_all([member, plan])
            session.flush()
            version = PlanVersion(
                plan_id=plan.id,
                version_number=1,
                name="Overtime Month",
                price_minor=125000,
                currency="MXN",
                duration_value=1,
                duration_unit="month",
                is_active=True,
            )
            session.add(version)
            session.flush()
            from app.shifts.queries import create_cash_register

            register = create_cash_register(session, branch_id, "overtime", "Overtime Register")
            source = open_shift(
                session,
                register_id=register.id,
                opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            )
            register_id, source_id, member_id, version_id = register.id, source.id, member.id, version.id

        with factory.begin() as session:
            closed_source = close_shift(
                session,
                shift_id=source_id,
                closed_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            )
            assert closed_source.shift.expected_cash_at_close_minor == 0
            source_cut_time = closed_source.shift.closed_at

        app = create_app(configured_settings(url))
        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "overtime-pending"}
        path = f"/api/v1/registers/{register_id}/membership-sales"
        body = {
            "member_id": str(member_id),
            "plan_version_id": str(version_id),
            "source_shift_id": str(source_id),
        }
        with TestClient(app) as client:
            missing_source = client.post(
                path,
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "overtime-no-source"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)},
            )
            assert missing_source.status_code == 409
            forged_source = client.post(
                path,
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "overtime-forged-source"},
                json={**body, "source_shift_id": str(uuid4())},
            )
            assert forged_source.status_code == 409
            pending = client.post(path, headers=headers, json=body)
            assert pending.status_code == 201, pending.text
            pending_sale = pending.json()
            assert pending_sale["order"]["source_shift_id"] == str(source_id)
            assert pending_sale["order"]["financial_shift_id"] is None
            assert pending_sale["order"]["is_overtime"] is True
            assert pending_sale["order"]["cash_included_in_opening"] is False
            assert pending_sale["order"]["seller_id"] == str(staff_id)
            assert client.post(path, headers=headers, json=body).status_code == 200
            changed_source_replay = client.post(
                path,
                headers=headers,
                json={**body, "source_shift_id": str(uuid4())},
            )
            assert changed_source_replay.status_code == 409

        opening_counts = [{"denomination_minor": 5000, "quantity": 25}]
        rolled_back = factory()
        try:
            rolled_back_shift = open_shift(
                rolled_back,
                register_id=register_id,
                opened_by=staff_id,
                denomination_counts=opening_counts,
            )
            rolled_back_id = rolled_back_shift.id
            rolled_back.rollback()
        finally:
            rolled_back.close()
        with factory() as session:
            pending_order = session.scalar(select(Order).where(Order.id == UUID(pending_sale["order"]["id"])))
            assert pending_order.financial_shift_id is None
            assert pending_order.cash_included_in_opening is False
            assert session.get(Shift, rolled_back_id) is None

        with factory.begin() as session:
            incoming = open_shift(
                session,
                register_id=register_id,
                opened_by=staff_id,
                denomination_counts=opening_counts,
            )
            incoming_id = incoming.id

        with TestClient(app) as client:
            replay_after_open = client.post(path, headers=headers, json=body)
            assert replay_after_open.status_code == 200
            linked = replay_after_open.json()["order"]
            assert linked["financial_shift_id"] == str(incoming_id)
            assert linked["cash_included_in_opening"] is True
            assert replay_after_open.json()["payment"]["amount_minor"] == 125000

        with factory.begin() as session:
            incoming_cut = close_shift(
                session,
                shift_id=incoming_id,
                closed_by=staff_id,
                denomination_counts=opening_counts,
            )
            assert incoming_cut.shift.expected_cash_at_close_minor == 125000
            assert incoming_cut.shift.counted_cash_minor == 125000
            assert incoming_cut.shift.difference_minor == 0

        with factory.begin() as session:
            outgoing = open_shift(
                session,
                register_id=register_id,
                opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            )
            outgoing_id = outgoing.id

        with TestClient(app) as client:
            current_overtime = client.post(
                path,
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "overtime-open-successor"},
                json={
                    "member_id": str(member_id),
                    "plan_version_id": str(version_id),
                    "source_shift_id": str(incoming_id),
                },
            )
            assert current_overtime.status_code == 201, current_overtime.text
            current_order = current_overtime.json()["order"]
            assert current_order["source_shift_id"] == str(incoming_id)
            assert current_order["financial_shift_id"] == str(outgoing_id)
            assert current_order["is_overtime"] is True
            assert current_order["cash_included_in_opening"] is False
            stale_source = client.post(
                path,
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "overtime-stale-source"},
                json={
                    "member_id": str(member_id),
                    "plan_version_id": str(version_id),
                    "source_shift_id": str(source_id),
                },
            )
            assert stale_source.status_code == 409

        with factory.begin() as session:
            outgoing_cut = close_shift(
                session,
                shift_id=outgoing_id,
                closed_by=staff_id,
                denomination_counts=[{"denomination_minor": 5000, "quantity": 25}],
            )
            assert outgoing_cut.shift.expected_cash_at_close_minor == 125000
            assert outgoing_cut.shift.counted_cash_minor == 125000

        with factory() as session:
            frozen_source = session.get(Shift, source_id)
            assert frozen_source.status == "closed"
            assert frozen_source.closed_at == source_cut_time.replace(tzinfo=None)
            assert frozen_source.expected_cash_at_close_minor == 0
            assert session.scalar(select(func.count()).select_from(Order)) == 2
            assert session.scalar(select(func.count()).select_from(Payment)) == 2
            assert session.scalar(select(func.count()).select_from(MembershipPeriod)) == 2
    finally:
        engine.dispose()


def test_membership_calendar_duration_clamps_month_end_and_leap_year():
    from datetime import date

    assert _add_duration(date(2024, 1, 31), 1, "month") == date(2024, 2, 29)
    assert _add_duration(date(2025, 1, 31), 1, "month") == date(2025, 2, 28)
    assert _add_duration(date(2024, 2, 29), 1, "year") == date(2025, 2, 28)


def test_membership_period_uses_branch_local_date_at_utc_day_boundary(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "tijuana", "Tijuana")
        staff_id, _token = _seed_receptionist(factory, branch_id, "tijuana@example.invalid")
        with factory.begin() as session:
            branch = session.get(Branch, branch_id)
            branch.timezone = "America/Tijuana"
            member = Member(member_number="SOC-TJ", full_name="Tijuana Member", phone="5550104")
            plan = Plan(code="tijuana-month", name="Tijuana Month", kind="membership", status="active")
            session.add_all([member, plan])
            session.flush()
            version = PlanVersion(plan_id=plan.id, version_number=1, name="Tijuana Month", price_minor=8000,
                                  currency="MXN", duration_value=1, duration_unit="month", is_active=True)
            session.add(version)
            session.flush()
            from app.shifts.queries import create_cash_register
            register = create_cash_register(session, branch_id, "tijuana-register", "Tijuana Register")
            open_shift(session, register_id=register.id, opened_by=staff_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            member_id, version_id, register_id = member.id, version.id, register.id

        session = factory()
        try:
            result = post_membership_cash_sale(
                session, register_id=register_id, actor_id=staff_id, member_id=member_id,
                plan_version_id=version_id, idempotency_key="tijuana-boundary",
                authorized_branch_id=branch_id,
                now=datetime(2026, 1, 1, 7, 30, tzinfo=timezone.utc),
            )
            assert result.membership.starts_on.isoformat() == "2025-12-31"
            assert result.membership.ends_on.isoformat() == "2026-01-31"
            session.rollback()
        finally:
            session.close()
    finally:
        engine.dispose()


def test_cash_sale_query_rollback_leaves_no_financial_or_membership_rows(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, _token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            member = Member(member_number="SOC-ROLLBACK", full_name="Rollback Member", phone="5550101")
            plan = Plan(code="rollback-month", name="Rollback Month", kind="membership", status="active")
            session.add_all([member, plan])
            session.flush()
            version = PlanVersion(plan_id=plan.id, version_number=1, name="One Month", price_minor=5000,
                                  currency="MXN", duration_value=1, duration_unit="month", is_active=True)
            session.add(version)
            session.flush()
            from app.shifts.queries import create_cash_register
            register = create_cash_register(session, branch_id, "rollback", "Rollback")
            open_shift(session, register_id=register.id, opened_by=staff_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            register_id, member_id, version_id = register.id, member.id, version.id

        session = factory()
        try:
            post_membership_cash_sale(session, register_id=register_id, actor_id=staff_id,
                                      authorized_branch_id=branch_id,
                                      member_id=member_id, plan_version_id=version_id,
                                      idempotency_key="rollback-sale")
            session.rollback()
        finally:
            session.close()
        with factory() as session:
            assert session.scalar(select(func.count()).select_from(Order)) == 0
            assert session.scalar(select(func.count()).select_from(OrderItem)) == 0
            assert session.scalar(select(func.count()).select_from(Payment)) == 0
            assert session.scalar(select(func.count()).select_from(MembershipPeriod)) == 0
    finally:
        engine.dispose()


def test_cash_sale_flush_order_respects_foreign_keys_when_sqlite_enforces_them(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        engine.dispose()

        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")

        branch_id = _seed_branch(factory)
        staff_id, _token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            member = Member(member_number="SOC-FK", full_name="FK Member", phone="5550102")
            plan = Plan(code="fk-month", name="FK Month", kind="membership", status="active")
            session.add_all([member, plan])
            session.flush()
            version = PlanVersion(
                plan_id=plan.id,
                version_number=1,
                name="FK Month",
                price_minor=6000,
                currency="MXN",
                duration_value=1,
                duration_unit="month",
                is_active=True,
            )
            session.add(version)
            session.flush()
            from app.shifts.queries import create_cash_register

            register = create_cash_register(session, branch_id, "fk-register", "FK Register")
            open_shift(
                session,
                register_id=register.id,
                opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            )
            register_id, member_id, version_id = register.id, member.id, version.id

        with factory.begin() as session:
            result = post_membership_cash_sale(
                session,
                register_id=register_id,
                actor_id=staff_id,
                authorized_branch_id=branch_id,
                member_id=member_id,
                plan_version_id=version_id,
                idempotency_key="sqlite-fk-order",
                now=datetime(2026, 1, 1, tzinfo=timezone.utc),
            )
            assert result.membership.order_item_id == result.item.id
    finally:
        engine.dispose()


def test_cash_membership_sale_requires_live_auth_open_shift_and_matching_branch(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "sale-branch", "Sale Branch")
        other_branch_id = _seed_branch(factory, "other-sale-branch", "Other Sale Branch")
        staff_id, token = _seed_receptionist(factory, branch_id, "sale-reception@example.invalid")
        with factory.begin() as session:
            member = Member(member_number="SOC-AUTH", full_name="Auth Member", phone="5550103")
            plan = Plan(code="auth-month", name="Auth Month", kind="membership", status="active")
            session.add_all([member, plan])
            session.flush()
            version = PlanVersion(plan_id=plan.id, version_number=1, name="Auth Month", price_minor=7000,
                                  currency="MXN", duration_value=1, duration_unit="month", is_active=True)
            session.add(version)
            session.flush()
            from app.shifts.queries import create_cash_register
            own_register = create_cash_register(session, branch_id, "sale-own", "Own Register")
            other_register = create_cash_register(session, other_branch_id, "sale-other", "Other Register")
            open_shift(session, register_id=own_register.id, opened_by=staff_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            open_shift(session, register_id=other_register.id, opened_by=staff_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            member_id, version_id = member.id, version.id
            own_register_id, other_register_id = own_register.id, other_register.id

        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            path = f"/api/v1/registers/{other_register_id}/membership-sales"
            body = {"member_id": str(member_id), "plan_version_id": str(version_id)}
            assert client.post(path, json=body, headers={"Idempotency-Key": "sale-auth"}).status_code == 401
            denied = client.post(path, json=body, headers={
                "Authorization": f"Bearer {token}", "Idempotency-Key": "sale-auth"
            })
            assert denied.status_code == 403
        with factory.begin() as session:
            from app.db.models import Shift
            shift = session.scalar(select(Shift).where(Shift.cash_register_id == own_register_id))
            shift.status = "closed"
        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            response = client.post(
                f"/api/v1/registers/{own_register_id}/membership-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "sale-closed"},
                json=body,
            )
            assert response.status_code == 409
    finally:
        engine.dispose()


def test_membership_period_database_rejects_empty_or_nonpositive_interval(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, _token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            member = Member(member_number="SOC-CHECK", full_name="Check Member", phone="5550102")
            session.add(member)
            session.flush()
            member_id = member.id
            from app.shifts.queries import create_cash_register
            register = create_cash_register(session, branch_id, "check", "Check")
            shift = open_shift(session, register_id=register.id, opened_by=staff_id,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            from app.catalog.queries import create_plan
            plan = create_plan(session, code="check-month", name="Check Month", kind="membership")
            version = PlanVersion(plan_id=plan.id, version_number=1, name="One Month", price_minor=5000,
                                  currency="MXN", duration_value=1, duration_unit="month", is_active=True)
            session.add(version)
            session.flush()
            order = Order(branch_id=branch_id, register_id=register.id, shift_id=shift.id, member_id=member_id,
                          seller_id=staff_id, idempotency_key="invalid-period", request_fingerprint="0" * 64,
                          currency="MXN", total_minor=5000)
            session.add(order)
            session.flush()
            item = OrderItem(order_id=order.id, plan_version_id=version.id, description_snapshot="One Month",
                             duration_value=1, duration_unit="month", quantity=1, unit_amount_minor=5000,
                             line_total_minor=5000)
            session.add(item)
            session.flush()
            invalid = MembershipPeriod(member_id=member_id, order_item_id=item.id, plan_version_id=version.id,
                                       starts_on=datetime(2026, 1, 1).date(), ends_on=datetime(2026, 1, 1).date(),
                                       activated_by=staff_id)
            session.add(invalid)
            with pytest.raises(IntegrityError):
                session.flush()
            session.rollback()
    finally:
        engine.dispose()


def test_invalid_stored_branch_timezone_fails_closed_without_sale(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "bad-zone", "Bad Zone")
        staff_id, token = _seed_receptionist(factory, branch_id, "bad-zone@example.invalid")
        with factory.begin() as session:
            member = Member(member_number="SOC-BADZONE", full_name="Bad Zone Member", phone="5550105")
            plan = Plan(code="bad-zone-month", name="Bad Zone Month", kind="membership", status="active")
            session.add_all([member, plan])
            session.flush()
            version = PlanVersion(plan_id=plan.id, version_number=1, name="Bad Zone Month", price_minor=9000,
                                  currency="MXN", duration_value=1, duration_unit="month", is_active=True)
            session.add(version)
            session.flush()
            from app.shifts.queries import create_cash_register
            register = create_cash_register(session, branch_id, "bad-zone-register", "Bad Zone Register")
            open_shift(session, register_id=register.id, opened_by=staff_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            member_id, version_id, register_id = member.id, version.id, register.id
        with engine.begin() as connection:
            connection.execute(text("update branches set timezone='Not/A_Real_Zone' where id=:id"), {"id": branch_id.hex})

        app = create_app(configured_settings(url))
        with TestClient(app) as client:
            response = client.post(
                f"/api/v1/registers/{register_id}/membership-sales",
                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "invalid-timezone-sale"},
                json={"member_id": str(member_id), "plan_version_id": str(version_id)},
            )
            assert response.status_code == 409
        with factory() as session:
            assert session.scalar(select(func.count()).select_from(Order)) == 0
            assert session.scalar(select(func.count()).select_from(MembershipPeriod)) == 0
    finally:
        engine.dispose()
