from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import (
    Branch,
    CashRegister,
    Member,
    MembershipPeriod,
    Order,
    OrderItem,
    Payment,
    Plan,
    PlanVersion,
    Product,
    Rental,
    RentalAsset,
    Shift,
    StaffUser,
)
from app.gimi.dispatcher import DispatchStatus, GimiActor, GimiDispatcher
from app.gimi.jev_router import JevRouteDecision
from app.gimi.tool_definitions import GimiRole


@pytest.fixture
def db_session():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    with factory() as sess:
        # Seed basic branch & staff
        branch = Branch(code="central", name="Sucursal Centro", timezone="America/Mexico_City", is_active=True)
        sess.add(branch)
        sess.flush()

        staff = StaffUser(login_identifier="coach_test", is_active=True)
        sess.add(staff)
        sess.flush()

        # Seed member
        member = Member(
            member_number="1001",
            full_name="Carlos Martinez",
            phone="+525511223344",
            status="active",
        )
        sess.add(member)
        sess.flush()

        # Seed plan & period
        plan = Plan(code="gym_m", name="Gym Mes", kind="membership", status="active")
        sess.add(plan)
        sess.flush()
        pv = PlanVersion(
            plan_id=plan.id,
            version_number=1,
            name="Gym Mes v1",
            price_minor=65000,
            currency="MXN",
            duration_value=1,
            duration_unit="month",
            entitlement_mode="period",
            is_active=True,
        )
        sess.add(pv)
        sess.flush()

        now_utc = datetime.now(timezone.utc)
        register = CashRegister(
            branch_id=branch.id,
            code="caja-test",
            name="Caja 1",
            status="active",
        )
        sess.add(register)
        sess.flush()

        shift = Shift(
            cash_register_id=register.id,
            opened_by=staff.id,
            opened_at=now_utc - timedelta(hours=2),
            status="open",
            opening_cash_minor=50000,
            expected_cash_at_close_minor=50000,
        )
        sess.add(shift)
        sess.flush()

        order = Order(
            id=uuid4(),
            branch_id=branch.id,
            register_id=register.id,
            shift_id=shift.id,
            member_id=member.id,
            order_kind="membership",
            seller_id=staff.id,
            currency="MXN",
            total_minor=65000,
            origin="online",
            idempotency_key="ord_01",
            request_fingerprint="a" * 64,
            created_at=now_utc,
        )
        sess.add(order)
        sess.flush()

        order_item = OrderItem(
            order_id=order.id,
            line_number=1,
            item_kind="membership",
            description_snapshot="Gym Mes",
            quantity=1,
            unit_amount_minor=65000,
            line_total_minor=65000,
            plan_version_id=pv.id,
            duration_value=1,
            duration_unit="month",
            entitlement_mode="period",
        )
        sess.add(order_item)
        sess.flush()

        period = MembershipPeriod(
            member_id=member.id,
            order_item_id=order_item.id,
            plan_version_id=pv.id,
            starts_on=date.today() - timedelta(days=5),
            ends_on=date.today() + timedelta(days=25),
            activated_by=staff.id,
            created_at=now_utc,
        )
        sess.add(period)

        # Seed locker
        locker = RentalAsset(
            branch_id=branch.id,
            kind="locker",
            code="l-05",
            locker_number=5,
            price_minor=10000,
            status="available",
            created_by=staff.id,
        )
        sess.add(locker)
        sess.flush()

        rental = Rental(
            branch_id=branch.id,
            asset_id=locker.id,
            member_id=member.id,
            kind="locker",
            status="active",
            starts_on=date.today() - timedelta(days=5),
            ends_on=date.today() + timedelta(days=25),
            actor_id=staff.id,
            idempotency_key="rent_01",
            request_fingerprint="b" * 64,
        )
        sess.add(rental)

        # Seed Product
        prod = Product(
            code="agua-15",
            name="Agua 1.5L",
            category="Bebidas",
            price_minor=1500,
            cost_minor=700,
            unit="piece",
            is_active=True,
            created_by=staff.id,
        )
        sess.add(prod)

        sess.commit()
        yield sess
    engine.dispose()


def test_dispatcher_handles_ambiguous_decision(db_session):
    dispatcher = GimiDispatcher()
    decision = JevRouteDecision(tool_name="unrecognized_intent", confidence=0.40, is_ambiguous=True, required_threshold=0.68)
    actor = GimiActor(role=GimiRole.MEMBER)

    res = dispatcher.dispatch(db_session, decision, actor)
    assert res.status == DispatchStatus.AMBIGUOUS
    assert "no tiene suficiente certeza" in res.summary_for_llm


def test_dispatcher_rbac_blocking(db_session):
    dispatcher = GimiDispatcher()
    decision = JevRouteDecision(tool_name="staff_record_expense", confidence=0.95, is_ambiguous=False, required_threshold=0.85)
    # A Member cannot record expenses
    actor = GimiActor(role=GimiRole.MEMBER)

    res = dispatcher.dispatch(db_session, decision, actor)
    assert res.status == DispatchStatus.PERMISSION_DENIED
    assert "no tiene autorización" in res.summary_for_llm


def test_dispatcher_draft_and_confirm_lifecycle(db_session):
    dispatcher = GimiDispatcher()
    decision = JevRouteDecision(tool_name="staff_record_expense", confidence=0.95, is_ambiguous=False, required_threshold=0.85)
    actor = GimiActor(role=GimiRole.STAFF)
    params = {
        "amount_minor": 25000,
        "concept": "Compra de desinfectante",
        "category": "limpieza",
    }

    # Step 1: Without confirmation -> creates draft
    draft_res = dispatcher.dispatch(db_session, decision, actor, raw_params=params, confirmed=False)
    assert draft_res.status == DispatchStatus.NEEDS_CONFIRMATION
    assert draft_res.draft_action["amount_minor"] == 25000
    assert "Acción crítica pendiente de confirmación" in draft_res.summary_for_llm

    # Step 2: With confirmation -> commits transaction
    exec_res = dispatcher.dispatch(db_session, decision, actor, raw_params=params, confirmed=True)
    assert exec_res.status == DispatchStatus.SUCCESS
    assert "Gasto registrado: $250.00 MXN" in exec_res.summary_for_llm


def test_dispatcher_member_locker_status(db_session):
    dispatcher = GimiDispatcher()
    decision = JevRouteDecision(tool_name="member_locker_status", confidence=0.92, is_ambiguous=False, required_threshold=0.68)
    member = db_session.query(Member).filter_by(member_number="1001").one()
    actor = GimiActor(role=GimiRole.MEMBER, member_id=member.id)

    res = dispatcher.dispatch(db_session, decision, actor)
    assert res.status == DispatchStatus.SUCCESS
    assert "Casillero #5" in res.summary_for_llm
    assert res.data["has_locker"] is True


def test_dispatcher_staff_record_checkin(db_session):
    dispatcher = GimiDispatcher()
    decision = JevRouteDecision(tool_name="staff_record_checkin", confidence=0.96, is_ambiguous=False, required_threshold=0.85)
    actor = GimiActor(role=GimiRole.STAFF)

    res = dispatcher.dispatch(db_session, decision, actor, raw_params={"member_identifier": "1001"})
    assert res.status == DispatchStatus.SUCCESS
    assert "Acceso registrado exitosamente para Carlos Martinez" in res.summary_for_llm


def test_dispatcher_staff_record_shrinkage(db_session):
    dispatcher = GimiDispatcher()
    decision = JevRouteDecision(tool_name="staff_record_shrinkage", confidence=0.93, is_ambiguous=False, required_threshold=0.85)
    actor = GimiActor(role=GimiRole.STAFF)
    params = {"product_name_or_code": "Agua 1.5L", "quantity": 2, "reason": "Botella perforada"}

    # Must need confirmation
    draft_res = dispatcher.dispatch(db_session, decision, actor, raw_params=params, confirmed=False)
    assert draft_res.status == DispatchStatus.NEEDS_CONFIRMATION

    # Executed when confirmed
    exec_res = dispatcher.dispatch(db_session, decision, actor, raw_params=params, confirmed=True)
    assert exec_res.status == DispatchStatus.SUCCESS
    assert "Merma registrada: 2 unidad(es)" in exec_res.summary_for_llm


def test_dispatcher_owner_financial_overview(db_session):
    dispatcher = GimiDispatcher()
    decision = JevRouteDecision(tool_name="owner_financial_overview", confidence=0.94, is_ambiguous=False, required_threshold=0.68)
    actor = GimiActor(role=GimiRole.OWNER)

    res = dispatcher.dispatch(db_session, decision, actor)
    assert res.status == DispatchStatus.SUCCESS
    assert "Resumen financiero" in res.summary_for_llm


def test_dispatcher_owner_financial_overview_date_filtering(db_session):
    dispatcher = GimiDispatcher()
    decision = JevRouteDecision(tool_name="owner_financial_overview", confidence=0.94, is_ambiguous=False, required_threshold=0.68)
    actor = GimiActor(role=GimiRole.OWNER)

    order = db_session.query(Order).first()
    staff = db_session.query(StaffUser).first()
    now_utc = datetime.now(timezone.utc)

    # Seed confirmed payment today
    payment = Payment(
        order_id=order.id,
        register_id=order.register_id,
        shift_id=order.shift_id,
        method="cash",
        status="confirmed",
        amount_minor=65000,
        received_by=staff.id,
        received_at=now_utc,
    )
    db_session.add(payment)
    db_session.commit()

    # All-time
    res_all = dispatcher.dispatch(db_session, decision, actor, raw_params={})
    assert res_all.status == DispatchStatus.SUCCESS
    assert res_all.data["total_sales_minor"] == 65000

    # Today filter includes it
    res_today = dispatcher.dispatch(
        db_session,
        decision,
        actor,
        raw_params={"from_date": now_utc.date().isoformat(), "to_date": now_utc.date().isoformat()},
    )
    assert res_today.status == DispatchStatus.SUCCESS
    assert res_today.data["total_sales_minor"] == 65000

    # Past date range where no payments exist
    res_past = dispatcher.dispatch(
        db_session,
        decision,
        actor,
        raw_params={"from_date": "2020-01-01", "to_date": "2020-01-31"},
    )
    assert res_past.status == DispatchStatus.SUCCESS
    assert res_past.data["total_sales_minor"] == 0
    assert "del 2020-01-01 al 2020-01-31" in res_past.summary_for_llm


def test_dispatcher_slot_filling_needs_parameters(db_session):
    dispatcher = GimiDispatcher()
    decision = JevRouteDecision(tool_name="staff_record_expense", confidence=0.95, is_ambiguous=False, required_threshold=0.85)
    actor = GimiActor(role=GimiRole.STAFF)

    # Missing amount_minor and concept
    res = dispatcher.dispatch(db_session, decision, actor, raw_params={})
    assert res.status == DispatchStatus.NEEDS_PARAMETERS
    assert "monto" in res.summary_for_llm.lower()
    assert "amount_minor" in res.data["missing_fields"]

