"""Tests for Member Reload Read Contract (P2.3 / FE05).

Verifies the 11 acceptance and failure points specified in
docs/work-packages/contracts/P2.2-member-read-dto.md (T01 through T11).
"""
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.api.member_reads import router as member_reads_router
from app.main import create_app
from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session
from app.db.base import Base
from app.db.models import (
    Branch,
    ClassSampleCheckIn,
    ClassSampleEntitlement,
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
    StaffCredential,
    StaffUser,
)
from app.db.models.member_check_ins import MemberCheckInVisit
from app.db.models.rentals import Rental, RentalAsset, RentalCharge
from app.db.models.shifts import CashRegister, Shift
from app.members.read_queries import (
    register_member_home_branch,
    register_member_org,
    register_period_branch,
)
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings, seed_admin


def _setup_db(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'member-reads-test.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    return engine, factory


def _seed_branch(factory, code="branch-central", name="Central Branch") -> UUID:
    with factory.begin() as session:
        branch = Branch(code=code, name=name)
        session.add(branch)
        session.flush()
        return branch.id


def _seed_receptionist(
    factory, branch_id: UUID, login="receptionist@evogym.com", pin="1234"
) -> tuple[UUID, str]:
    with factory.begin() as session:
        staff = StaffUser(login_identifier=login)
        session.add(staff)
        session.flush()
        session.add_all([
            RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch_id),
            StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin(pin)),
        ])
        staff_id = staff.id

    now = datetime.now(timezone.utc)
    issued = issue_session(factory, login, pin, branch_id, now + timedelta(hours=2))
    return staff_id, issued.token


def _seed_admin_principal(
    factory, login="admin@evogym.com", password="synthetic-admin-password"
) -> tuple[UUID, str]:
    admin_id = seed_admin(factory, login=login, password=password)
    delivery = FakeRecoveryDelivery()
    database_url = str(factory.kw["bind"].url)
    with TestClient(create_app(configured_settings(database_url), recovery_delivery=delivery)) as client:
        access = complete_device_login(client, delivery, login, password)
    return admin_id, access.json()["access_token"]


def _create_test_app(factory) -> FastAPI:
    app = FastAPI()
    app.state.session_factory = factory
    app.state.settings = configured_settings(str(factory.kw["bind"].url))
    app.include_router(member_reads_router)
    return app


def _seed_member(
    factory,
    member_number="SOC-0010",
    full_name="Lucia Mendoza",
    phone="+525512345678",
    email="lucia@example.com",
    preferred_name=None,
    organization_id=None,
    home_branch_id=None,
) -> Member:
    with factory.begin() as session:
        member = Member(
            id=uuid4(),
            member_number=member_number,
            full_name=full_name,
            preferred_name=preferred_name,
            phone=phone,
            email=email,
            status="active",
            joined_on=date.today(),
            credit_balance_minor=0,
            emergency_contact_name="Carlos Mendoza",
            emergency_contact_phone="+525587654321",
        )
        session.add(member)
        session.flush()
        member_id = member.id

    if organization_id is not None:
        register_member_org(member_id, organization_id)
    if home_branch_id is not None:
        register_member_home_branch(member_id, home_branch_id)

    with factory() as session:
        return session.get(Member, member_id)


def _seed_plan_and_order(
    factory,
    member_id: UUID,
    branch_id: UUID,
    staff_id: UUID,
    total_minor: int = 150000,
    entitlement_mode: str = "period",
    plan_name: str = "Gym Monthly",
) -> tuple[UUID, UUID, UUID, UUID]:
    """Seed Plan, PlanVersion, Order, OrderItem, and Payment."""
    with factory.begin() as session:
        register = CashRegister(branch_id=branch_id, code=f"reg-{uuid4().hex[:6]}", name="Front Register")
        session.add(register)
        session.flush()

        shift = Shift(
            cash_register_id=register.id,
            opened_by=staff_id,
            opened_at=datetime.now(timezone.utc),
            opening_cash_minor=10000,
            status="open",
        )
        session.add(shift)
        session.flush()

        plan = Plan(code=f"plan-{uuid4().hex[:6]}", name=plan_name, kind="membership", status="active")
        session.add(plan)
        session.flush()

        plan_version = PlanVersion(
            plan_id=plan.id,
            version_number=1,
            name=f"{plan_name} v1",
            price_minor=total_minor,
            currency="MXN",
            duration_value=30 if entitlement_mode == "period" else None,
            duration_unit="day" if entitlement_mode == "period" else None,
            entitlement_mode=entitlement_mode,
            is_active=True,
        )
        session.add(plan_version)
        session.flush()

        order = Order(
            branch_id=branch_id,
            register_id=register.id,
            shift_id=shift.id,
            member_id=member_id,
            seller_id=staff_id,
            idempotency_key=f"idem-{uuid4().hex}",
            request_fingerprint="a" * 64,
            currency="MXN",
            total_minor=total_minor,
        )
        session.add(order)
        session.flush()

        order_item = OrderItem(
            order_id=order.id,
            plan_version_id=plan_version.id,
            line_number=1,
            item_kind="membership",
            description_snapshot=plan_name,
            duration_value=30 if entitlement_mode == "period" else None,
            duration_unit="day" if entitlement_mode == "period" else None,
            entitlement_mode=entitlement_mode,
            quantity=1,
            unit_amount_minor=total_minor,
            line_total_minor=total_minor,
        )
        session.add(order_item)
        session.flush()

        payment = Payment(
            order_id=order.id,
            method="cash",
            amount_minor=total_minor,
            status="confirmed",
            received_by=staff_id,
        )
        session.add(payment)
        session.flush()

        return plan_version.id, order.id, order_item.id, shift.id


# =========================================================================
# Acceptance Tests T01 - T11
# =========================================================================


def test_t01_unauthenticated_request_returns_401(tmp_path):
    """T01: Missing or invalid token safely returns HTTP 401 without data leakage."""
    engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        member = _seed_member(factory)
        app = _create_test_app(factory)

        with TestClient(app) as client:
            # 1. No Authorization header
            res1 = client.get(f"/api/v1/members/{member.id}/reload")
            assert res1.status_code == 401
            assert "detail" in res1.json()

            # 2. Invalid bearer scheme
            res2 = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": "Basic dXNlcjpwYXNz"},
            )
            assert res2.status_code == 401

            # 3. Invalid token
            res3 = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": "Bearer non-existent-token"},
            )
            assert res3.status_code == 401
    finally:
        engine.dispose()


def test_t02_receptionist_projection_hides_financial_amounts_and_debts(tmp_path):
    """T02: D-012 Receptionist sees has_pending_balance=True, total_pending_balance_minor=None, debts=[]."""
    engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, rec_token = _seed_receptionist(factory, branch_id)
        member = _seed_member(factory)
        app = _create_test_app(factory)

        # Create debt: initial 10,000 minor, paid 4,000 minor, remaining 6,000 minor
        plan_ver_id, order_id, order_item_id, shift_id = _seed_plan_and_order(
            factory, member.id, branch_id, staff_id, total_minor=10000
        )
        with factory.begin() as session:
            debt = MembershipDebt(
                order_id=order_id,
                member_id=member.id,
                initial_outstanding_minor=10000,
            )
            session.add(debt)
            session.flush()

            # Add partial repayment of 4000
            reg = session.scalar(select(CashRegister).where(CashRegister.branch_id == branch_id))
            payment = MembershipDebtPayment(
                debt_id=debt.id,
                order_id=order_id,
                member_id=member.id,
                branch_id=branch_id,
                register_id=reg.id,
                shift_id=shift_id,
                amount_minor=4000,
                remaining_after_minor=6000,
                received_by=staff_id,
                idempotency_key=f"rep-{uuid4().hex}",
                request_fingerprint="b" * 64,
            )
            session.add(payment)

        with TestClient(app) as client:
            res = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": f"Bearer {rec_token}"},
            )
            assert res.status_code == 200, res.text
            data = res.json()
            financial = data["financial"]

            # Receptionist gets warning flag only
            assert financial["has_pending_balance"] is True
            assert financial["total_pending_balance_minor"] is None
            assert financial["debts"] == []
    finally:
        engine.dispose()


def test_t03_admin_projection_reveals_exact_centavos_and_itemized_debts(tmp_path):
    """T03: D-012 Admin sees exact total_pending_balance_minor and itemized debts with order_id."""
    engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        admin_id, admin_token = _seed_admin_principal(factory)
        member = _seed_member(factory)
        app = _create_test_app(factory)

        plan_ver_id, order_id, order_item_id, shift_id = _seed_plan_and_order(
            factory, member.id, branch_id, admin_id, total_minor=10000
        )
        with factory.begin() as session:
            debt = MembershipDebt(
                order_id=order_id,
                member_id=member.id,
                initial_outstanding_minor=10000,
            )
            session.add(debt)
            session.flush()

            reg = session.scalar(select(CashRegister).where(CashRegister.branch_id == branch_id))
            payment = MembershipDebtPayment(
                debt_id=debt.id,
                order_id=order_id,
                member_id=member.id,
                branch_id=branch_id,
                register_id=reg.id,
                shift_id=shift_id,
                amount_minor=3500,
                remaining_after_minor=6500,
                received_by=admin_id,
                idempotency_key=f"rep-{uuid4().hex}",
                request_fingerprint="c" * 64,
            )
            session.add(payment)

        with TestClient(app) as client:
            res = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            assert res.status_code == 200, res.text
            financial = res.json()["financial"]

            assert financial["has_pending_balance"] is True
            assert financial["total_pending_balance_minor"] == 6500
            assert len(financial["debts"]) == 1
            debt_item = financial["debts"][0]
            assert debt_item["order_id"] == str(order_id)
            assert debt_item["initial_outstanding_minor"] == 10000
            assert debt_item["remaining_balance_minor"] == 6500
            assert debt_item["currency"] == "MXN"
            assert debt_item["branch_id"] == str(branch_id)
    finally:
        engine.dispose()


def test_t04_cross_branch_profile_read_permitted_and_cross_org_concealed(tmp_path):
    """T04: D-001 Cross-branch lookup allowed; cross-organization lookup returns 404."""
    engine, factory = _setup_db(tmp_path)
    try:
        branch_a = _seed_branch(factory, code="branch-a", name="Branch Alpha")
        branch_b = _seed_branch(factory, code="branch-b", name="Branch Beta")
        _, token_b = _seed_receptionist(factory, branch_b, login="rec_b@evogym.com")

        # Member registered at Branch A with Org 1
        org_1 = uuid4()
        member = _seed_member(
            factory,
            member_number="SOC-CROSS-01",
            full_name="Cross Branch Member",
            organization_id=org_1,
            home_branch_id=branch_a,
        )
        app = _create_test_app(factory)

        with TestClient(app) as client:
            # 1. Receptionist at Branch B reads member from Branch A (Same Org) -> Permitted HTTP 200
            res = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": f"Bearer {token_b}"},
            )
            assert res.status_code == 200, res.text
            assert res.json()["profile"]["full_name"] == "Cross Branch Member"
            assert res.json()["profile"]["home_branch_id"] == str(branch_a)

            # 2. Lookup with non-matching Organization ID -> HTTP 404 (Concealed tenant existence)
            foreign_org = uuid4()
            res_org = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={
                    "Authorization": f"Bearer {token_b}",
                    "X-Organization-ID": str(foreign_org),
                },
            )
            assert res_org.status_code == 404
            assert res_org.json()["detail"] == "The requested resource was not found."

            history = client.get(
                f"/api/v1/members/{member.id}/check-ins?month=1&year=2026",
                headers={"Authorization": f"Bearer {token_b}", "X-Organization-ID": str(foreign_org)},
            )
            assert history.status_code == 404
            assert history.json()["detail"] == "The requested resource was not found."
    finally:
        engine.dispose()


def test_f14_summary_and_paginated_purchases(tmp_path):
    engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory, code="f14", name="F14")
        staff, token = _seed_receptionist(factory, branch)
        member = _seed_member(factory, member_number="SOC-F14")
        _plan, order, _item, _shift = _seed_plan_and_order(factory, member.id, branch, staff, total_minor=10000)
        with factory.begin() as session:
            session.add(MembershipDebt(order_id=order, member_id=member.id, initial_outstanding_minor=10000))
        headers = {"Authorization": f"Bearer {token}"}
        with TestClient(_create_test_app(factory)) as client:
            summary = client.get(f"/api/v1/members/{member.id}/summary", headers=headers)
            assert summary.status_code == 200
            assert summary.json()["member_id"] == str(member.id)
            assert summary.json()["financial"]["pending_balance_minor"] == 10000
            assert summary.json()["financial"]["unpaid_order_id"] == str(order)
            assert summary.json()["habits"]["weekly_visits"] == 0
            purchases = client.get(f"/api/v1/members/{member.id}/purchases?page=1&page_size=1", headers=headers)
            assert purchases.status_code == 200
            assert purchases.json()["total"] == 1
            assert purchases.json()["items"][0]["id"] == str(order)
            assert purchases.json()["items"][0]["status"] == "pending"
            assert client.get(f"/api/v1/members/{member.id}/purchases?page=2&page_size=1", headers=headers).json()["items"] == []
    finally:
        engine.dispose()


def test_f14_financial_history_is_branch_scoped_and_paginated(tmp_path):
    engine, factory = _setup_db(tmp_path)
    try:
        branch_a = _seed_branch(factory, code="f14-a", name="F14 A")
        branch_b = _seed_branch(factory, code="f14-b", name="F14 B")
        staff_a, token_a = _seed_receptionist(factory, branch_a, login="f14-a@evogym.com")
        staff_b, token_b = _seed_receptionist(factory, branch_b, login="f14-b@evogym.com")
        member = _seed_member(factory, member_number="SOC-F14-BRANCH")
        _, order_a, _, shift_a = _seed_plan_and_order(factory, member.id, branch_a, staff_a, total_minor=10000)
        _, order_b, _, _ = _seed_plan_and_order(factory, member.id, branch_b, staff_b, total_minor=20000)
        with factory.begin() as session:
            debt = MembershipDebt(order_id=order_a, member_id=member.id, initial_outstanding_minor=6000)
            session.add(debt)
            session.flush()
            register = session.get(Shift, shift_a).cash_register_id
            session.add(MembershipDebtPayment(debt_id=debt.id, order_id=order_a, member_id=member.id,
                branch_id=branch_a, register_id=register, shift_id=shift_a, amount_minor=2000,
                remaining_after_minor=4000, received_by=staff_a, idempotency_key="f14-debt", request_fingerprint="a" * 64))
            asset = RentalAsset(branch_id=branch_a, kind="locker", code="14", locker_number=14,
                                price_minor=3000, status="available", created_by=staff_a)
            session.add(asset)
            session.flush()
            rental = Rental(branch_id=branch_a, asset_id=asset.id, member_id=member.id, kind="locker", status="active",
                            starts_on=date.today(), ends_on=date.today() + timedelta(days=30), actor_id=staff_a,
                            idempotency_key="f14-rental", request_fingerprint="b" * 64)
            session.add(rental)
            session.flush()
            charge = RentalCharge(rental_id=rental.id, branch_id=branch_a, charge_kind="initial", amount_minor=3000,
                                  starts_on=date.today(), ends_on=date.today() + timedelta(days=30),
                                  idempotency_key="f14-charge", request_fingerprint="c" * 64, created_by=staff_a)
            session.add(charge)
            session.flush()
            charge_id = charge.id

        app = _create_test_app(factory)
        with TestClient(app) as client:
            headers = {"Authorization": f"Bearer {token_a}"}
            url = f"/api/v1/members/{member.id}"
            assert client.get(f"{url}/summary").status_code == 401
            assert client.get(f"{url}/purchases").status_code == 401
            assert client.get(f"{url}/summary?branch_id={branch_b}", headers=headers).status_code == 403
            assert client.get(f"{url}/purchases?branch_id={branch_b}", headers=headers).status_code == 403
            summary = client.get(f"{url}/summary", headers=headers)
            assert summary.status_code == 200, summary.text
            assert summary.json()["financial"] == {"has_pending_balance": True, "pending_balance_minor": 7000,
                                                    "unpaid_order_id": str(order_a)}
            assert summary.json()["rentals"]["active_locker"]["code"] == "14"
            first = client.get(f"{url}/purchases?page=1&page_size=1", headers=headers).json()
            second = client.get(f"{url}/purchases?page=2&page_size=1", headers=headers).json()
            third = client.get(f"{url}/purchases?page=3&page_size=1", headers=headers).json()
            assert first["total"] == second["total"] == third["total"] == 3
            rows = first["items"] + second["items"] + third["items"]
            assert {item["kind"] for item in rows} == {"order", "rental", "debt_payment"}
            assert {item["id"] for item in rows} >= {str(order_a), str(charge_id)}
            assert str(order_b) not in {item["id"] for item in rows}
            assert next(item for item in rows if item["kind"] == "rental")["status"] == "pending"
            assert client.get(f"{url}/purchases?from_date=1900-01-01&to_date=1900-01-02", headers=headers).json()["total"] == 0
            assert client.get(f"{url}/purchases?from_date=2026-02-01&to_date=2026-01-01", headers=headers).status_code == 422
            branch_b_rows = client.get(f"{url}/purchases", headers={"Authorization": f"Bearer {token_b}"}).json()
            assert branch_b_rows["total"] == 1
            assert branch_b_rows["items"][0]["id"] == str(order_b)
    finally:
        engine.dispose()


def test_f14_habits_count_distinct_recent_visits_in_callers_branch(tmp_path):
    engine, factory = _setup_db(tmp_path)
    try:
        branch_a = _seed_branch(factory, code="habit-a", name="Habit A")
        branch_b = _seed_branch(factory, code="habit-b", name="Habit B")
        staff_a, token_a = _seed_receptionist(factory, branch_a, login="habit-a@evogym.com")
        staff_b, _ = _seed_receptionist(factory, branch_b, login="habit-b@evogym.com")
        member = _seed_member(factory, member_number="SOC-F14-HABITS")
        plan, _, item, _ = _seed_plan_and_order(factory, member.id, branch_a, staff_a)
        now = datetime.now(timezone.utc)
        with factory.begin() as session:
            period = MembershipPeriod(member_id=member.id, order_item_id=item, plan_version_id=plan,
                                      starts_on=date.today() - timedelta(days=60), ends_on=date.today() + timedelta(days=30), activated_by=staff_a)
            session.add(period)
            session.flush()
            for index in range(6):
                timestamp = now - timedelta(days=2 if index < 4 else 40 if index == 4 else 1)
                visit = MemberCheckInVisit(member_id=member.id, started_at=timestamp)
                session.add(visit)
                session.flush()
                session.add(MemberCheckIn(visit_id=visit.id, member_id=member.id, period_id=period.id,
                    branch_id=branch_b if index == 5 else branch_a, recorded_by=staff_b if index == 5 else staff_a,
                    idempotency_key=f"f14-habit-{index}", request_fingerprint="d" * 64,
                    access_reason="valid_membership", access_warnings=[], occurred_at=timestamp))
        with TestClient(_create_test_app(factory)) as client:
            result = client.get(f"/api/v1/members/{member.id}/summary", headers={"Authorization": f"Bearer {token_a}"})
            assert result.status_code == 200, result.text
            assert result.json()["habits"]["weekly_visits"] == 1
            assert result.json()["habits"]["attendance_tier"] == "normal"
            assert result.json()["habits"]["favorite_product"] is None
    finally:
        engine.dispose()


def test_t05_branch_scoped_entitlement_returns_branch_restricted(tmp_path):
    """T05: D-001 Entitlement bound to Branch A returns branch_restricted when viewed from Branch B."""
    engine, factory = _setup_db(tmp_path)
    try:
        branch_a = _seed_branch(factory, code="branch-alpha", name="Alpha")
        branch_b = _seed_branch(factory, code="branch-beta", name="Beta")
        staff_a, _ = _seed_receptionist(factory, branch_a, login="rec_a@evogym.com")
        _, token_b = _seed_receptionist(factory, branch_b, login="rec_b@evogym.com")

        member = _seed_member(factory, member_number="SOC-BRANCH-SCOPE")
        plan_ver_id, order_id, order_item_id, _ = _seed_plan_and_order(
            factory, member.id, branch_a, staff_a, plan_name="Alpha Gym Pass"
        )

        with factory.begin() as session:
            period = MembershipPeriod(
                member_id=member.id,
                order_item_id=order_item_id,
                plan_version_id=plan_ver_id,
                starts_on=date.today(),
                ends_on=date.today() + timedelta(days=30),
                activated_by=staff_a,
            )
            session.add(period)
            session.flush()
            period_id = period.id

        register_period_branch(period_id, branch_a)

        app = _create_test_app(factory)
        with TestClient(app) as client:
            res = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": f"Bearer {token_b}"},
            )
            assert res.status_code == 200, res.text
            periods = res.json()["active_periods"]
            assert len(periods) == 1
            assert periods[0]["branch_id"] == str(branch_a)
            assert periods[0]["access_status"] == "branch_restricted"
            assert periods[0]["is_current"] is True
    finally:
        engine.dispose()


def test_t06_multi_branch_entitlement_returns_eligible(tmp_path):
    """T06: D-001 Multi-branch entitlement (branch_id=None) returns access_status=eligible at Branch B."""
    engine, factory = _setup_db(tmp_path)
    try:
        branch_a = _seed_branch(factory, code="branch-m-a", name="Branch MA")
        branch_b = _seed_branch(factory, code="branch-m-b", name="Branch MB")
        staff_a, _ = _seed_receptionist(factory, branch_a, login="staff_ma@evogym.com")
        _, token_b = _seed_receptionist(factory, branch_b, login="staff_mb@evogym.com")

        member = _seed_member(factory, member_number="SOC-MULTI-01")
        plan_ver_id, order_id, order_item_id, _ = _seed_plan_and_order(
            factory, member.id, branch_a, staff_a, plan_name="All Access Passport"
        )

        with factory.begin() as session:
            period = MembershipPeriod(
                member_id=member.id,
                order_item_id=order_item_id,
                plan_version_id=plan_ver_id,
                starts_on=date.today(),
                ends_on=date.today() + timedelta(days=30),
                activated_by=staff_a,
            )
            session.add(period)
            session.flush()
            period_id = period.id

        register_period_branch(period_id, None)

        app = _create_test_app(factory)
        with TestClient(app) as client:
            res = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": f"Bearer {token_b}"},
            )
            assert res.status_code == 200, res.text
            periods = res.json()["active_periods"]
            assert len(periods) == 1
            assert periods[0]["branch_id"] is None
            assert periods[0]["access_status"] == "eligible"
            assert periods[0]["is_current"] is True
    finally:
        engine.dispose()


def test_t07_reload_durability_returns_stable_identifiers_without_sale_dto(tmp_path):
    """T07: Reload endpoint returns durable period_id and plan_name directly from database (FE05)."""
    engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        member = _seed_member(factory, member_number="SOC-DURABLE-01")

        plan_ver_id, order_id, order_item_id, _ = _seed_plan_and_order(
            factory, member.id, branch_id, staff_id, plan_name="Durable Elite Plan"
        )

        expected_period_id = uuid4()
        with factory.begin() as session:
            period = MembershipPeriod(
                id=expected_period_id,
                member_id=member.id,
                order_item_id=order_item_id,
                plan_version_id=plan_ver_id,
                starts_on=date.today(),
                ends_on=date.today() + timedelta(days=15),
                activated_by=staff_id,
            )
            session.add(period)

        app = _create_test_app(factory)
        with TestClient(app) as client:
            res = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 200, res.text
            periods = res.json()["active_periods"]
            assert len(periods) == 1
            assert periods[0]["id"] == str(expected_period_id)
            assert periods[0]["order_item_id"] == str(order_item_id)
            assert periods[0]["plan_name"] == "Durable Elite Plan"
            assert periods[0]["starts_on"] == str(date.today())
            assert periods[0]["ends_on"] == str(date.today() + timedelta(days=15))
    finally:
        engine.dispose()


def test_t08_class_sample_entitlement_consumption_lifecycle(tmp_path):
    """T08: Class sample entitlement reflects unconsumed state, then transitions to consumed (FE08)."""
    engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        member = _seed_member(factory, member_number="SOC-SAMPLE-01")

        plan_ver_id, order_id, order_item_id, _ = _seed_plan_and_order(
            factory, member.id, branch_id, staff_id, entitlement_mode="single_entry", plan_name="Boxing Sample"
        )

        sample_id = uuid4()
        with factory.begin() as session:
            sample = ClassSampleEntitlement(
                id=sample_id,
                member_id=member.id,
                order_item_id=order_item_id,
                plan_version_id=plan_ver_id,
            )
            session.add(sample)

        app = _create_test_app(factory)
        with TestClient(app) as client:
            # 1. Prior to consumption
            res1 = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res1.status_code == 200
            samples1 = res1.json()["class_samples"]
            assert len(samples1) == 1
            assert samples1[0]["id"] == str(sample_id)
            assert samples1[0]["is_consumed"] is False
            assert samples1[0]["consumed_at"] is None
            assert samples1[0]["consumed_visit_id"] is None

            # 2. Record consumption event
            check_in_id = uuid4()
            with factory.begin() as session:
                check_in = ClassSampleCheckIn(
                    id=check_in_id,
                    entitlement_id=sample_id,
                    member_id=member.id,
                    branch_id=branch_id,
                    recorded_by=staff_id,
                    idempotency_key=f"sample-ci-{uuid4().hex}",
                    request_fingerprint="d" * 64,
                    access_reason="paid_sample",
                    access_warnings=[],
                )
                session.add(check_in)

            # 3. Post consumption query
            res2 = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res2.status_code == 200
            samples2 = res2.json()["class_samples"]
            assert len(samples2) == 1
            assert samples2[0]["is_consumed"] is True
            assert samples2[0]["consumed_visit_id"] == str(check_in_id)
            assert samples2[0]["consumed_at"] is not None
    finally:
        engine.dispose()


def test_t09_empty_collections_default_to_empty_lists_and_null_demographics(tmp_path):
    """T09: New member with no purchase history returns empty lists and null optional fields."""
    engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _, token = _seed_receptionist(factory, branch_id)
        member = _seed_member(
            factory,
            member_number="SOC-EMPTY-01",
            full_name="New Member",
            preferred_name=None,
            email=None,
        )
        app = _create_test_app(factory)

        with TestClient(app) as client:
            res = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 200, res.text
            data = res.json()

            assert data["profile"]["preferred_name"] is None
            assert data["profile"]["email"] is None
            assert data["active_periods"] == []
            assert data["class_samples"] == []
            assert data["recent_visits"] == []
            assert data["financial"]["has_pending_balance"] is False
            assert data["financial"]["debts"] == []
            assert data["server_time"] is not None
    finally:
        engine.dispose()


def test_t10_visit_history_bounding_and_branch_partitioning(tmp_path):
    """T10: D-001 Visit history is ordered desc, bounded by limit, and partitioned strictly by branch."""
    engine, factory = _setup_db(tmp_path)
    try:
        branch_a = _seed_branch(factory, code="branch-hist-a", name="History Branch A")
        branch_b = _seed_branch(factory, code="branch-hist-b", name="History Branch B")
        staff_a, token_a = _seed_receptionist(factory, branch_a, login="rec_hist_a@evogym.com")
        staff_b, token_b = _seed_receptionist(factory, branch_b, login="rec_hist_b@evogym.com")
        member = _seed_member(factory, member_number="SOC-HIST-01")

        plan_ver_id, order_id, order_item_id, _ = _seed_plan_and_order(
            factory, member.id, branch_a, staff_a
        )
        with factory.begin() as session:
            period = MembershipPeriod(
                member_id=member.id,
                order_item_id=order_item_id,
                plan_version_id=plan_ver_id,
                starts_on=date.today() - timedelta(days=60),
                ends_on=date.today() + timedelta(days=60),
                activated_by=staff_a,
            )
            session.add(period)
            session.flush()

            base_time = datetime.now(timezone.utc) - timedelta(days=30)
            # Create 25 visits at Branch A
            for i in range(25):
                visit_root = MemberCheckInVisit(
                    member_id=member.id,
                    started_at=base_time + timedelta(hours=i * 2),
                )
                session.add(visit_root)
                session.flush()

                ci = MemberCheckIn(
                    visit_id=visit_root.id,
                    member_id=member.id,
                    period_id=period.id,
                    branch_id=branch_a,
                    recorded_by=staff_a,
                    idempotency_key=f"ci-a-{i}-{uuid4().hex[:6]}",
                    request_fingerprint="e" * 64,
                    access_reason="valid_membership",
                    access_warnings=[],
                    occurred_at=base_time + timedelta(hours=i * 2),
                )
                session.add(ci)

            # Create 5 visits at Branch B
            for j in range(5):
                visit_root_b = MemberCheckInVisit(
                    member_id=member.id,
                    started_at=base_time + timedelta(days=20, hours=j),
                )
                session.add(visit_root_b)
                session.flush()

                ci_b = MemberCheckIn(
                    visit_id=visit_root_b.id,
                    member_id=member.id,
                    period_id=period.id,
                    branch_id=branch_b,
                    recorded_by=staff_b,
                    idempotency_key=f"ci-b-{j}-{uuid4().hex[:6]}",
                    request_fingerprint="f" * 64,
                    access_reason="valid_membership",
                    access_warnings=[],
                    occurred_at=base_time + timedelta(days=20, hours=j),
                )
                session.add(ci_b)

        app = _create_test_app(factory)
        with TestClient(app) as client:
            # Query from Branch A: default limit 20
            res_a = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": f"Bearer {token_a}"},
            )
            assert res_a.status_code == 200
            visits_a = res_a.json()["recent_visits"]
            # Enforces default bounding of 20
            assert len(visits_a) == 20
            # Strict branch isolation: All returned visits belong to Branch A
            for v in visits_a:
                assert v["branch_id"] == str(branch_a)
            # Strictly ordered descending by occurred_at
            timestamps = [datetime.fromisoformat(v["occurred_at"].replace("Z", "+00:00")) for v in visits_a]
            assert timestamps == sorted(timestamps, reverse=True)

            # Custom limit clamp: visit_limit=5
            res_clamp = client.get(
                f"/api/v1/members/{member.id}/reload?visit_limit=5",
                headers={"Authorization": f"Bearer {token_a}"},
            )
            assert res_clamp.status_code == 200
            assert len(res_clamp.json()["recent_visits"]) == 5

            # Query from Branch B: returns only Branch B visits (5 total)
            res_b = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": f"Bearer {token_b}"},
            )
            assert res_b.status_code == 200
            visits_b = res_b.json()["recent_visits"]
            assert len(visits_b) == 5
            for vb in visits_b:
                assert vb["branch_id"] == str(branch_b)

            month = base_time.month
            year = base_time.year
            history = client.get(
                f"/api/v1/members/{member.id}/check-ins?month={month}&year={year}",
                headers={"Authorization": f"Bearer {token_a}"},
            )
            assert history.status_code == 200
            check_ins = history.json()
            assert len(check_ins) == sum(
                (base_time + timedelta(hours=i * 2)).month == month
                for i in range(25)
            )
            assert all(item["access_reason"] == "valid_membership" for item in check_ins)
            assert all(item["branch_id"] == str(branch_a) for item in check_ins)
    finally:
        engine.dispose()


def test_t11_read_mutation_independence(tmp_path):
    """T11: Reload read endpoint executes with zero side effects; does not grant mutation permissions."""
    engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        member = _seed_member(factory, member_number="SOC-IND-01")

        app = _create_test_app(factory)
        with TestClient(app) as client:
            res = client.get(
                f"/api/v1/members/{member.id}/reload",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert res.status_code == 200

        # Assert no visits, check-ins, or audit mutations occurred
        with factory() as session:
            check_ins_count = session.scalar(
                select(MemberCheckIn).where(MemberCheckIn.member_id == member.id)
            )
            assert check_ins_count is None
            debts_count = session.scalar(
                select(MembershipDebt).where(MembershipDebt.member_id == member.id)
            )
            assert debts_count is None
    finally:
        engine.dispose()


def test_create_app_includes_member_reads_router():
    """Verify create_app registers member reads router exposing reload endpoint."""
    app = create_app()
    route_paths = {
        r.path
        for r in app.routes
        if getattr(r, "path", None)
    } | {
        sr.path
        for r in app.routes
        if hasattr(r, "original_router")
        for sr in r.original_router.routes
        if getattr(sr, "path", None)
    }
    assert "/api/v1/members/{member_id}/reload" in route_paths
    assert "/api/v1/members/{member_id}/reload" in app.openapi()["paths"]


