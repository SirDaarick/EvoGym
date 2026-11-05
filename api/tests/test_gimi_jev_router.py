from app.gimi.jev_router import JevRouter
from app.gimi.tool_definitions import GimiRole


def test_jev_router_member_queries():
    router = JevRouter()

    # Member query
    decision = router.route_intent("¿Cuándo vence mi membresía?", role=GimiRole.MEMBER)
    assert decision.tool_name == "member_membership_status"
    assert decision.confidence >= 0.85
    assert decision.is_ambiguous is False

    # Balance query
    decision = router.route_intent("¿Cuánto debo de este mes?", role=GimiRole.MEMBER)
    assert decision.tool_name == "member_pending_balance"
    assert decision.confidence >= 0.85


def test_jev_router_rbac_enforcement():
    router = JevRouter()

    # A member trying to trigger a staff expense must NOT get routed to staff_record_expense
    decision = router.route_intent("Registra un gasto de 500 pesos de limpieza", role=GimiRole.MEMBER)
    # The member role does NOT have staff_record_expense in its choices!
    assert decision.tool_name != "staff_record_expense" or decision.confidence == 0.0
    assert decision.is_ambiguous is True

    # But for staff, it routes with high confidence
    staff_decision = router.route_intent("Registra un gasto de 500 pesos de limpieza", role=GimiRole.STAFF)
    assert staff_decision.tool_name == "staff_record_expense"
    assert staff_decision.confidence >= 0.85
    assert staff_decision.is_ambiguous is False


def test_jev_router_owner_exclusive_tools():
    router = JevRouter()

    # Staff trying to see owner financial overview
    staff_decision = router.route_intent("Dame el resumen de ingresos y corte del mes", role=GimiRole.STAFF)
    assert staff_decision.tool_name != "owner_financial_overview" or staff_decision.confidence == 0.0

    # Owner gets routed directly
    owner_decision = router.route_intent("Dame el resumen de ingresos y corte del mes", role=GimiRole.OWNER)
    assert owner_decision.tool_name == "owner_financial_overview"
    assert owner_decision.confidence >= 0.85


def test_jev_router_low_confidence_ambiguous_intent():
    router = JevRouter()

    # Gibberish or ambiguous statement
    decision = router.route_intent("Hola qué tal el clima hoy", role=GimiRole.MEMBER)
    assert decision.is_ambiguous is True
    assert decision.confidence < 0.85
