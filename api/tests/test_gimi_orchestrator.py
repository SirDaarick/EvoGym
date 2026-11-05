from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
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
    Plan,
    PlanVersion,
    Shift,
    StaffUser,
)
from app.gimi.dispatcher import DispatchStatus, GimiActor
from app.gimi.orchestrator import GimiOrchestrator
from app.gimi.tool_definitions import GimiRole
from app.settings import Settings


@pytest.fixture
def db_session():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    with factory() as sess:
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
        sess.commit()
        yield sess
    engine.dispose()


def test_orchestrator_member_query_deterministic_fallback(db_session):
    orchestrator = GimiOrchestrator(settings=Settings(environment="test"))
    member = db_session.query(Member).filter_by(member_number="1001").one()
    actor = GimiActor(role=GimiRole.MEMBER, member_id=member.id)

    res = orchestrator.interact(db_session, actor, "¿Cuándo vence mi membresía?")
    assert res.status == DispatchStatus.SUCCESS
    assert res.tool_called == "member_membership_status"
    assert "vigente hasta el" in res.reply_text


def test_orchestrator_ambiguity_handles_clarification(db_session):
    orchestrator = GimiOrchestrator(settings=Settings(environment="test"))
    actor = GimiActor(role=GimiRole.MEMBER)

    res = orchestrator.interact(db_session, actor, "hola como estas el clima de hoy")
    assert res.status == DispatchStatus.AMBIGUOUS
    assert "No logré identificar con claridad tu solicitud" in res.reply_text


def test_orchestrator_draft_and_confirm_flow(db_session):
    orchestrator = GimiOrchestrator(settings=Settings(environment="test"))
    actor = GimiActor(role=GimiRole.STAFF)

    # 1. First prompt triggers draft
    res1 = orchestrator.interact(db_session, actor, "Registra un gasto de 300 pesos de articulos de limpieza")
    assert res1.status == DispatchStatus.NEEDS_CONFIRMATION
    assert res1.needs_confirmation is True
    assert "Deseas proceder? (Responde Sí para confirmar)" in res1.reply_text

    # 2. User confirms with "Sí"
    draft = res1.draft_action
    res2 = orchestrator.interact(
        db_session,
        actor,
        "Sí, confirmo",
        cached_draft=draft,
        cached_tool=res1.tool_called,
    )
    assert res2.status == DispatchStatus.SUCCESS
    assert res2.needs_confirmation is False
    assert "Gasto registrado: $300.00 MXN" in res2.reply_text


def test_orchestrator_with_openrouter_mock(db_session):
    mock_settings = Settings(
        environment="test",
        openrouter_api_key="sk-or-v1-fake-test-key",
    )
    orchestrator = GimiOrchestrator(settings=mock_settings)
    member = db_session.query(Member).filter_by(member_number="1001").one()
    actor = GimiActor(role=GimiRole.MEMBER, member_id=member.id)

    mock_llm_response = {
        "choices": [
            {
                "message": {
                    "content": "¡Hola Carlos! Tu membresía de Gym Mes está activa y vence el próximo 30 de noviembre. ¡Te esperamos en tu entrenamiento!",
                }
            }
        ]
    }

    with patch("httpx.Client.post") as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = mock_llm_response
        mock_post.return_value = mock_response

        res = orchestrator.interact(db_session, actor, "¿Cuándo vence mi membresía?")
        assert res.status == DispatchStatus.SUCCESS
        assert "¡Hola Carlos!" in res.reply_text
        assert mock_post.called

        # Verify call headers and payload
        args, kwargs = mock_post.call_args
        assert kwargs["headers"]["Authorization"] == "Bearer sk-or-v1-fake-test-key"
        assert kwargs["json"]["model"] == "google/gemini-2.0-flash-001"
