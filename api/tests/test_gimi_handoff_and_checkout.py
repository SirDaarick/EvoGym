from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import (
    Branch,
    Member,
    MembershipPeriod,
    NotificationOutbox,
    Plan,
    PlanVersion,
    StaffUser,
)
from app.gimi.dispatcher import DispatchStatus, GimiActor, GimiDispatcher
from app.gimi.jev_router import JevRouteDecision
from app.gimi.tool_definitions import GimiRole
from app.payments.checkout_pro import MercadoPagoCheckoutClient


@pytest.fixture
def db_session():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    with factory() as sess:
        now_utc = datetime.now(timezone.utc)

        branch = Branch(code="central", name="Sucursal Centro", timezone="America/Mexico_City", is_active=True)
        sess.add(branch)
        sess.flush()

        staff = StaffUser(login_identifier="coach_test", is_active=True)
        sess.add(staff)
        sess.flush()

        member = Member(
            member_number="1001",
            full_name="Carlos Martinez",
            phone="+525511223344",
            status="active",
        )
        sess.add(member)
        sess.flush()

        plan = Plan(code="gym_m", name="Gym Mes", kind="membership", status="active")
        sess.add(plan)
        sess.flush()

        pv = PlanVersion(
            plan_id=plan.id,
            version_number=1,
            name="Gym Mes",
            price_minor=65000,
            currency="MXN",
            duration_value=1,
            duration_unit="month",
            entitlement_mode="period",
            is_active=True,
        )
        sess.add(pv)
        sess.flush()

        from app.db.models import CashRegister, Shift, Order, OrderItem

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
            idempotency_key="ord_test_01",
            request_fingerprint="f" * 64,
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
            starts_on=date.today() - timedelta(days=20),
            ends_on=date.today() + timedelta(days=10),
            activated_by=staff.id,
        )
        sess.add(period)
        sess.commit()
        yield sess
    engine.dispose()


def test_member_request_human_support_creates_handoff_outbox_ticket(db_session):
    dispatcher = GimiDispatcher()
    member = db_session.query(Member).filter_by(member_number="1001").one()
    actor = GimiActor(role=GimiRole.MEMBER, member_id=member.id)
    decision = JevRouteDecision(
        tool_name="member_request_human_support",
        confidence=0.95,
        is_ambiguous=False,
        required_threshold=0.85,
    )

    res = dispatcher.dispatch(
        db_session,
        decision,
        actor,
        raw_params={"reason": "Duda sobre cobro indebido en tarjeta"},
    )
    assert res.status == DispatchStatus.SUCCESS
    assert "transferida exitosamente al equipo de recepción" in res.summary_for_llm
    assert res.data["escalated"] is True
    ticket_code = res.data["ticket_code"]
    assert ticket_code

    # Verify notification created in outbox
    outbox_entry = db_session.query(NotificationOutbox).filter_by(idempotency_key=f"handoff_{ticket_code}").first()
    assert outbox_entry is not None
    assert outbox_entry.kind == "staff_human_handoff"
    assert "Carlos Martinez" in outbox_entry.body
    assert "Duda sobre cobro indebido" in outbox_entry.body


def test_member_generate_payment_link_produces_valid_preference(db_session):
    dispatcher = GimiDispatcher()
    member = db_session.query(Member).filter_by(member_number="1001").one()
    actor = GimiActor(role=GimiRole.MEMBER, member_id=member.id)
    decision = JevRouteDecision(
        tool_name="member_generate_payment_link",
        confidence=0.94,
        is_ambiguous=False,
        required_threshold=0.85,
    )

    res = dispatcher.dispatch(
        db_session,
        decision,
        actor,
        raw_params={"purpose": "renewal"},
    )
    assert res.status == DispatchStatus.SUCCESS
    assert "Link de pago seguro de Mercado Pago generado por $650.00 MXN" in res.summary_for_llm
    assert res.data["payment_url"].startswith("https://mpago.la/")
    assert res.data["amount_minor"] == 65000
    assert "renew_" in res.data["external_reference"]


def test_mercadopago_checkout_client_deterministic_preview():
    client = MercadoPagoCheckoutClient(access_token=None)
    pref = client.create_preference(
        title="Renovación Gym Mes - Socio 1001",
        amount_minor=65000,
        external_reference="ref_test_01",
    )
    assert pref.preference_id.startswith("pref_mock_")
    assert pref.init_point.startswith("https://mpago.la/pos_")
    assert pref.amount_minor == 65000
    assert pref.external_reference == "ref_test_01"
