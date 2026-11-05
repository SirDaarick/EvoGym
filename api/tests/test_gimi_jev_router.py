from app.gimi.jev_router import JevRouter
from app.gimi.tool_definitions import GimiRole


def test_jev_router_asymmetric_thresholds():
    router = JevRouter(query_threshold=0.68, command_threshold=0.85)

    assert router.get_threshold_for_tool("gym_faq_and_rules") == 0.68
    assert router.get_threshold_for_tool("member_membership_status") == 0.68
    assert router.get_threshold_for_tool("staff_record_expense") == 0.85
    assert router.get_threshold_for_tool("staff_record_shrinkage") == 0.85


def test_jev_router_member_queries():
    router = JevRouter()

    # Member query (resolves at 0.75, which is safely above the 0.68 query threshold)
    decision = router.route_intent("¿Cuándo vence mi membresía?", role=GimiRole.MEMBER)
    assert decision.tool_name == "member_membership_status"
    assert decision.required_threshold == 0.68
    assert decision.confidence >= 0.68
    assert decision.is_ambiguous is False

    # FAQ query (resolves at 0.72, which passes 0.68 query threshold)
    faq_decision = router.route_intent("¿Cuál es el horario del gimnasio y precio?", role=GimiRole.MEMBER)
    assert faq_decision.tool_name == "gym_faq_and_rules"
    assert faq_decision.required_threshold == 0.68
    assert faq_decision.confidence >= 0.68
    assert faq_decision.is_ambiguous is False


def test_jev_router_rbac_enforcement():
    router = JevRouter()

    # A member trying to trigger a staff expense must NOT get routed to staff_record_expense
    decision = router.route_intent("Registra un gasto de 500 pesos de limpieza", role=GimiRole.MEMBER)
    assert decision.tool_name != "staff_record_expense" or decision.confidence == 0.0
    assert decision.is_ambiguous is True

    # But for staff, it routes as a Command with 0.85 required threshold
    staff_decision = router.route_intent("Registra un gasto de 500 pesos de limpieza", role=GimiRole.STAFF)
    assert staff_decision.tool_name == "staff_record_expense"
    assert staff_decision.required_threshold == 0.85
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
    assert owner_decision.confidence >= 0.68
    assert owner_decision.is_ambiguous is False


def test_jev_router_low_confidence_ambiguous_intent():
    router = JevRouter()

    # Gibberish or ambiguous statement
    decision = router.route_intent("Hola qué tal el clima hoy", role=GimiRole.MEMBER)
    assert decision.is_ambiguous is True
    assert decision.confidence < 0.68
