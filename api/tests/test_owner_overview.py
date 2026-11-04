from datetime import date, datetime, time, timezone
from importlib import import_module

from fastapi.testclient import TestClient

from app.main import create_app
from admin_session_helpers import approved_admin_headers
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from test_shifts import _seed_branch, _seed_receptionist, _setup_db
from app.db.models import (PaymentTerminal, ProductSaleCancellation, Member, MemberCheckIn, Payment, Plan, PlanVersion, Rental, RentalAsset,
                           RentalCancellation, StaffRosterProfile, StaffScheduleException, StaffScheduleSeries)
from app.db.models.member_check_ins import MemberCheckInVisit
from app.inventory.queries import create_product
from app.sales.queries import (post_card_product_sale, post_cash_product_sale, post_membership_cash_sale,
                               post_membership_debt_payment, post_product_return)
from app.sales.schemas import ProductCartLineRequest
from app.shifts.queries import create_cash_register
from test_shifts import open_shift
from test_staff_roster import _setup as _setup_staff


def test_owner_overview_empty_branch_and_authorization(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        _, reception_token = _seed_receptionist(factory, branch)
        seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            assert client.get('/api/v1/owner/overview').status_code == 403
            headers = approved_admin_headers(client, delivery)
            path = f"/api/v1/owner/overview?branch_id={branch}&from=2026-10-01&to=2026-10-01"
            response = client.get(path, headers=headers)
            assert response.status_code == 200
            assert response.json()["finances"]["cash_minor"] == 0
            assert response.json()["attendance"]["total_check_ins"] == 0
            assert client.get(path, headers={"Authorization": f"Bearer {reception_token}"}).status_code == 403
            assert client.get(f"/api/v1/owner/overview?branch_id={branch}&from=2026-10-02&to=2026-10-01", headers=headers).status_code == 422
    finally:
        engine.dispose()


def test_owner_overview_includes_stock_and_payroll_for_selected_branch(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        other = _seed_branch(factory, "other-overview", "Other")
        actor, _ = _seed_receptionist(factory, branch)
        seed_admin(factory)
        with factory.begin() as session:
            session.add_all([
                StaffRosterProfile(branch_id=branch, full_name="Employee", position="Staff", monthly_salary_minor=100000),
                StaffRosterProfile(branch_id=other, full_name="Other employee", position="Staff", monthly_salary_minor=200000),
            ])
            create_product(session, name="Low stock item", created_by=actor, initial_quantity=3, initial_branch_id=branch)
            create_product(session, name="Uninitialized item", created_by=actor)
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            headers = approved_admin_headers(client, delivery)
            response = client.get(f"/api/v1/owner/overview?branch_id={branch}", headers=headers)
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["inventory"]["low_stock_count"] == 1
            assert data["staff"]["estimated_payroll_minor"] == 25000
            assert data["alerts"]["total_count"] == 1
    finally:
        engine.dispose()


def test_owner_overview_reconciles_cash_sale_and_stock(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        seed_admin(factory)
        with factory.begin() as session:
            product = create_product(session, name="Water", created_by=actor, price_minor=500,
                                     initial_quantity=6, initial_branch_id=branch)
            register = create_cash_register(session, branch, "overview", "Overview")
            open_shift(session, register_id=register.id, opened_by=actor,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            post_cash_product_sale(session, register_id=register.id, actor_id=actor, member_id=None,
                items=[ProductCartLineRequest(product_id=product.id, quantity=2)],
                expected_total_minor=1000, idempotency_key="overview-sale")
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            response = client.get(f"/api/v1/owner/overview?branch_id={branch}", headers=approved_admin_headers(client, delivery))
            assert response.status_code == 200, response.text
            result = response.json()
            assert result["finances"]["cash_minor"] == 1000
            assert result["finances"]["confirmed_count"] == 1
            assert result["inventory"]["retail_units_sold"] == 2
            assert result["inventory"]["retail_revenue_minor"] == 1000
            assert result["inventory"]["low_stock_count"] == 1
    finally:
        engine.dispose()


def test_owner_overview_counts_overtime_sale_before_next_shift(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        seed_admin(factory)
        with factory.begin() as session:
            product = create_product(session, name="Overtime water", created_by=actor, price_minor=500,
                                     initial_quantity=6, initial_branch_id=branch)
            register = create_cash_register(session, branch, "overtime", "Overtime")
            shift = open_shift(session, register_id=register.id, opened_by=actor,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            shift.status = "closed"
            shift.closed_at = datetime.now(timezone.utc)
            session.flush()
            post_cash_product_sale(session, register_id=register.id, actor_id=actor, member_id=None,
                items=[ProductCartLineRequest(product_id=product.id, quantity=1)],
                expected_total_minor=500, idempotency_key="overtime-sale")
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            response = client.get(f"/api/v1/owner/overview?branch_id={branch}", headers=approved_admin_headers(client, delivery))
            assert response.status_code == 200, response.text
            assert response.json()["finances"]["cash_minor"] == 500
    finally:
        engine.dispose()


def test_owner_overview_filters_finance_at_branch_midnight(tmp_path, monkeypatch):
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 2, 5, 59, tzinfo=timezone.utc).astimezone(tz)

    monkeypatch.setattr(import_module("app.finance.overview"), "datetime", FixedDateTime)
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        seed_admin(factory)
        with factory.begin() as session:
            product = create_product(session, name="Boundary water", created_by=actor, price_minor=500,
                                     initial_quantity=10, initial_branch_id=branch)
            register = create_cash_register(session, branch, "boundary", "Boundary")
            open_shift(session, register_id=register.id, opened_by=actor,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            for index, timestamp in enumerate((datetime(2026, 10, 2, 5, 59, tzinfo=timezone.utc),
                                               datetime(2026, 10, 2, 6, 0, tzinfo=timezone.utc))):
                order, _ = post_cash_product_sale(session, register_id=register.id, actor_id=actor, member_id=None,
                    items=[ProductCartLineRequest(product_id=product.id, quantity=1)],
                    expected_total_minor=500, idempotency_key=f"boundary-{index}")
                session.get(Payment, order.payment.id).received_at = timestamp
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            headers = approved_admin_headers(client, delivery)
            response = client.get(f"/api/v1/owner/overview?branch_id={branch}", headers=headers)
            assert response.status_code == 200, response.text
            assert response.json()["period"]["from"] == "2026-10-01"
            assert response.json()["finances"]["cash_minor"] == 500
            response = client.get(f"/api/v1/owner/overview?branch_id={branch}&from=2026-10-02&to=2026-10-02", headers=headers)
            assert response.status_code == 200, response.text
            assert response.json()["finances"]["cash_minor"] == 500
    finally:
        engine.dispose()


def test_owner_overview_subtracts_rental_cancellation_refund(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        seed_admin(factory)
        with factory.begin() as session:
            member = Member(member_number="RENTAL-OVERVIEW", full_name="Member", phone="5550100")
            asset = RentalAsset(branch_id=branch, kind="locker", code="locker-overview", locker_number=1,
                                price_minor=500, created_by=actor)
            register = create_cash_register(session, branch, "rental-overview", "Rental")
            session.add_all([member, asset])
            session.flush()
            shift = open_shift(session, register_id=register.id, opened_by=actor,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            rental = Rental(branch_id=branch, asset_id=asset.id, member_id=member.id, kind="locker",
                status="cancelled", starts_on=date(2026, 1, 1), ends_on=date(2026, 2, 1), actor_id=actor,
                idempotency_key="rental-overview", request_fingerprint="a" * 64)
            session.add(rental)
            session.flush()
            session.add(RentalCancellation(rental_id=rental.id, branch_id=branch, member_id=member.id,
                asset_id=asset.id, actor_id=actor, register_id=register.id, shift_id=shift.id,
                reason="Refund", refund_method="cash", refund_amount_minor=250, suggested_refund_minor=250,
                settled_minor=500, cancelled_debt_minor=0, preview_token="b" * 64,
                idempotency_key="refund-overview", request_fingerprint="c" * 64))
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            response = client.get(f"/api/v1/owner/overview?branch_id={branch}", headers=approved_admin_headers(client, delivery))
            assert response.status_code == 200, response.text
            assert response.json()["finances"]["cash_minor"] == -250
            assert response.json()["alerts"]["total_count"] == 1
    finally:
        engine.dispose()


def test_owner_overview_reconciles_card_sale_and_product_refund(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        seed_admin(factory)
        with factory.begin() as session:
            member = Member(member_number="CARD-OVERVIEW", full_name="Card Member", phone="5550100")
            session.add(member)
            session.flush()
            product = create_product(session, name="Card water", created_by=actor, price_minor=500,
                                     initial_quantity=10, initial_branch_id=branch)
            register = create_cash_register(session, branch, "card-overview", "Card")
            open_shift(session, register_id=register.id, opened_by=actor,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            order, _ = post_card_product_sale(session, register_id=register.id, actor_id=actor,
                member_id=member.id, items=[ProductCartLineRequest(product_id=product.id, quantity=2)],
                expected_total_minor=1000, idempotency_key="card-sale", card_intent_id="overview-card")
            post_product_return(session, register_id=register.id, actor_id=actor, order_item_id=order.items[0].id,
                reason="Refund", disposition="restock", payout_method="card", idempotency_key="card-refund")
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            response = client.get(f"/api/v1/owner/overview?branch_id={branch}", headers=approved_admin_headers(client, delivery))
            assert response.status_code == 200, response.text
            assert response.json()["finances"]["card_minor"] == 0
            assert response.json()["finances"]["confirmed_count"] == 1
            assert response.json()["inventory"]["retail_units_sold"] == 2
    finally:
        engine.dispose()


def test_owner_overview_members_attendance_and_pending_transfer(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        seed_admin(factory)
        with factory.begin() as session:
            member = Member(member_number="MEM-OVERVIEW", full_name="Overview Member", phone="5550100")
            plan = Plan(code="overview-plan", name="Overview Plan", kind="membership", status="active")
            session.add_all([member, plan])
            session.flush()
            version = PlanVersion(plan_id=plan.id, version_number=1, name="Overview Plan", price_minor=12000,
                                  currency="MXN", duration_value=1, duration_unit="month", is_active=True)
            session.add(version)
            register = create_cash_register(session, branch, "member-overview", "Members")
            session.flush()
            open_shift(session, register_id=register.id, opened_by=actor,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            first = post_membership_cash_sale(session, register_id=register.id, actor_id=actor,
                authorized_branch_id=branch, member_id=member.id, plan_version_id=version.id, idempotency_key="member-cash",
                cash_amount_minor=5000, cash_amount_provided=True)
            post_membership_debt_payment(session, register_id=register.id, actor_id=actor,
                authorized_branch_id=branch, order_id=first.order.id, amount_minor=3000, idempotency_key="member-debt")
            post_membership_cash_sale(session, register_id=register.id, actor_id=actor,
                authorized_branch_id=branch, member_id=member.id, plan_version_id=version.id,
                idempotency_key="member-transfer", payment_method="transfer")
            now = datetime.now(timezone.utc)
            visit = MemberCheckInVisit(member_id=member.id, started_at=now)
            session.add(visit)
            session.flush()
            session.add(MemberCheckIn(visit_id=visit.id, member_id=member.id, period_id=first.membership.id,
                branch_id=branch, recorded_by=actor, idempotency_key="overview-visit", request_fingerprint="d" * 64,
                access_reason="valid", access_warnings=[], occurred_at=now))
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            response = client.get(f"/api/v1/owner/overview?branch_id={branch}", headers=approved_admin_headers(client, delivery))
            assert response.status_code == 200, response.text
            result = response.json()
            assert result["finances"]["cash_minor"] == 8000
            assert result["finances"]["pending_transfer_minor"] == 12000
            assert result["members"]["total_members"] == 1
            assert result["members"]["active_members"] == 1
            assert result["attendance"]["total_check_ins"] == 1
            assert result["attendance"]["live_occupancy_count"] == 1
            assert result["attendance"]["memberships_sold_count"] == 1
            assert result["attendance"]["memberships_renewed_count"] == 1
    finally:
        engine.dispose()


def test_owner_overview_reports_shift_count_and_overdue_locker_alerts(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        seed_admin(factory)
        with factory.begin() as session:
            product = create_product(session, name="Count item", created_by=actor,
                                     initial_quantity=10, initial_branch_id=branch)
            member = Member(member_number="OVERDUE-OVERVIEW", full_name="Locker Member", phone="5550100")
            asset = RentalAsset(branch_id=branch, kind="locker", code="locker-overdue", locker_number=9,
                                price_minor=500, created_by=actor)
            session.add_all([member, asset])
            session.flush()
            register = create_cash_register(session, branch, "alert-overview", "Alerts")
            shift = open_shift(session, register_id=register.id, opened_by=actor,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
                inventory_observations=[{"product_id": product.id, "physical_quantity": 8, "reason": "Count"}])
            shift.status = "closed"
            shift.closed_at = datetime.now(timezone.utc)
            shift.difference_minor = -300
            session.add(Rental(branch_id=branch, asset_id=asset.id, member_id=member.id, kind="locker", status="active",
                starts_on=date(2020, 1, 1), ends_on=date(2020, 2, 1), actor_id=actor,
                idempotency_key="overdue-overview", request_fingerprint="e" * 64))
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            response = client.get(f"/api/v1/owner/overview?branch_id={branch}", headers=approved_admin_headers(client, delivery))
            assert response.status_code == 200, response.text
            result = response.json()
            assert result["finances"]["shift_discrepancies"][0]["difference_minor"] == -300
            assert result["finances"]["count_discrepancies"][0]["physical_quantity"] == 8
            assert result["alerts"]["total_count"] == 3
            assert {row["category"] for row in result["alerts"]["category_counts"]} == {
                "Diferencias de caja", "Diferencias de inventario", "Casilleros vencidos"}
    finally:
        engine.dispose()


def test_owner_overview_absences_respect_start_and_schedule_exceptions(tmp_path, monkeypatch):
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 1, 18, tzinfo=timezone.utc).astimezone(tz)

    monkeypatch.setattr(import_module("app.finance.overview"), "datetime", FixedDateTime)
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        seed_admin(factory)
        with factory.begin() as session:
            series = []
            for name in ("Absent", "Skipped", "Overridden"):
                profile = StaffRosterProfile(branch_id=branch, full_name=name, position="Staff")
                session.add(profile)
                session.flush()
                row = StaffScheduleSeries(profile_id=profile.id, branch_id=branch,
                    start_date=date(2026, 10, 1), weekdays=[3], start_time=time(9), end_time=time(17), created_by=actor)
                session.add(row)
                series.append(row)
            session.flush()
            session.add_all([
                StaffScheduleException(series_id=series[1].id, local_date=date(2026, 10, 1), action="skip",
                    original_start_time=time(9), original_end_time=time(17), recorded_by=actor),
                StaffScheduleException(series_id=series[2].id, local_date=date(2026, 10, 1), action="override",
                    original_start_time=time(9), original_end_time=time(17), override_start_time=time(13),
                    override_end_time=time(18), recorded_by=actor),
            ])
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            response = client.get(f"/api/v1/owner/overview?branch_id={branch}", headers=approved_admin_headers(client, delivery))
            assert response.status_code == 200, response.text
            assert response.json()["staff"]["staff_absent_count"] == 1
    finally:
        engine.dispose()


def test_owner_overview_rejects_other_branch_for_scoped_admin(tmp_path):
    url, engine, factory, branch, other, _, token = _setup_staff(tmp_path)
    try:
        with factory.begin() as session:
            session.add(StaffRosterProfile(branch_id=branch, full_name="Employee", position="Staff"))
        with TestClient(create_app(configured_settings(url))) as client:
            headers = {"Authorization": f"Bearer {token}"}
            assert client.get(f"/api/v1/owner/overview?branch_id={branch}", headers=headers).status_code == 200
            assert client.get(f"/api/v1/owner/overview?branch_id={other}", headers=headers).status_code == 403
        with factory() as session:
            assert session.query(StaffRosterProfile).count() == 1
    finally:
        engine.dispose()


def test_owner_overview_by_method_terminals_cancellations_and_shift_context(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        seed_admin(factory)
        with factory.begin() as session:
            member = Member(member_number="BYM-OVERVIEW", full_name="Member", phone="5550100")
            session.add(member)
            terminal = PaymentTerminal(branch_id=branch, code="p1", name="Point Recepcion", device_id="dev-1")
            session.add(terminal)
            session.flush()
            terminal_id = terminal.id
            product = create_product(session, name="Water", created_by=actor, price_minor=500,
                                     initial_quantity=20, initial_branch_id=branch)
            register = create_cash_register(session, branch, "bym", "Caja Principal")
            open_shift(session, register_id=register.id, opened_by=actor,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            post_cash_product_sale(session, register_id=register.id, actor_id=actor, member_id=member.id,
                items=[ProductCartLineRequest(product_id=product.id, quantity=1)], expected_total_minor=500,
                idempotency_key="bym-cash")
            order, _ = post_card_product_sale(session, register_id=register.id, actor_id=actor, member_id=member.id,
                items=[ProductCartLineRequest(product_id=product.id, quantity=2)], expected_total_minor=1000,
                idempotency_key="bym-card", card_intent_id="bym-card-1", terminal_id=terminal_id)
            post_card_product_sale(session, register_id=register.id, actor_id=actor, member_id=member.id,
                items=[ProductCartLineRequest(product_id=product.id, quantity=1)], expected_total_minor=500,
                idempotency_key="bym-card2", card_intent_id="bym-card-2")
            post_product_return(session, register_id=register.id, actor_id=actor, order_item_id=order.items[0].id,
                reason="Refund", disposition="restock", payout_method="card", idempotency_key="bym-refund")
            session.add(ProductSaleCancellation(seller_id=actor, branch_id=branch, idempotency_key="bym-cancel",
                                                request_fingerprint="d" * 64))
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            response = client.get(f"/api/v1/owner/overview?branch_id={branch}", headers=approved_admin_headers(client, delivery))
            assert response.status_code == 200, response.text
            data = response.json()
            fin = data["finances"]
            methods = {m["method"]: m for m in fin["by_method"]}
            assert list(methods) == ["cash", "transfer", "card"]
            assert methods["cash"]["amount_minor"] == fin["cash_minor"] == 500
            assert methods["card"]["amount_minor"] == fin["card_minor"] == 500
            assert methods["card"]["gross_minor"] == 1500 and methods["card"]["refunds_minor"] == 1000
            assert methods["card"]["count"] == 2
            assert methods["transfer"]["amount_minor"] == 0 and methods["transfer"]["count"] == 0
            terminals = {t["terminal_id"]: t for t in methods["card"]["terminals"]}
            assert terminals[str(terminal_id)] == {"terminal_id": str(terminal_id), "terminal_name": "Point Recepcion",
                                                   "count": 1, "amount_minor": 1000}
            assert terminals[None]["terminal_name"] is None and terminals[None]["amount_minor"] == 500
            canc = data["cancellations"]
            assert canc["product_sales"] == {"count": 1}
            assert canc["product_refunds"] == {"count": 1, "amount_minor": 1000}
            assert canc["rental_cancellations"]["count"] == 0
            assert canc["total_count"] == 2
    finally:
        engine.dispose()


def test_owner_overview_rental_cancellation_summary_and_shift_discrepancy_context(tmp_path):
    from sqlalchemy import update
    from app.db.models import Shift
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        seed_admin(factory)
        with factory.begin() as session:
            member = Member(member_number="RC-SUMMARY", full_name="Member", phone="5550100")
            asset = RentalAsset(branch_id=branch, kind="locker", code="locker-sum", locker_number=1,
                                price_minor=500, created_by=actor)
            register = create_cash_register(session, branch, "rc-sum", "Caja Lockers")
            session.add_all([member, asset])
            session.flush()
            shift = open_shift(session, register_id=register.id, opened_by=actor,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            rental = Rental(branch_id=branch, asset_id=asset.id, member_id=member.id, kind="locker",
                status="cancelled", starts_on=date(2026, 1, 1), ends_on=date(2026, 2, 1), actor_id=actor,
                idempotency_key="rc-sum", request_fingerprint="a" * 64)
            session.add(rental)
            session.flush()
            session.add(RentalCancellation(rental_id=rental.id, branch_id=branch, member_id=member.id,
                asset_id=asset.id, actor_id=actor, register_id=register.id, shift_id=shift.id,
                reason="Refund", refund_method="cash", refund_amount_minor=250, suggested_refund_minor=250,
                settled_minor=500, cancelled_debt_minor=100, preview_token="b" * 64,
                idempotency_key="rc-sum-1", request_fingerprint="c" * 64))
            from datetime import datetime, timezone
            session.execute(update(Shift).where(Shift.id == shift.id).values(
                status="closed", closed_at=datetime.now(timezone.utc), difference_minor=-300))
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            data = client.get(f"/api/v1/owner/overview?branch_id={branch}", headers=approved_admin_headers(client, delivery)).json()
            assert data["cancellations"]["rental_cancellations"] == {
                "count": 1, "refund_amount_minor": 250, "cancelled_debt_minor": 100, "unreviewed_count": 1}
            assert data["cancellations"]["total_count"] == 1
            assert data["finances"]["by_method"][0]["refunds_minor"] == 250
            (row,) = data["finances"]["shift_discrepancies"]
            assert row["difference_minor"] == -300 and row["register_name"] == "Caja Lockers"
            assert row["opened_at"] and row["closed_at"] and row["register_id"]
    finally:
        engine.dispose()
