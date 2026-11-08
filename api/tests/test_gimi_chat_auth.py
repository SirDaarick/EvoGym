from app.db.models import Member, Payment, Plan, PlanVersion
from app.gimi.dispatcher import DispatchStatus, GimiActor, GimiDispatcher
from app.gimi.jev_router import JevRouteDecision
from app.gimi.tool_definitions import GimiRole
from app.sales.queries import post_membership_cash_sale
from app.shifts.queries import create_cash_register
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def test_gimi_financial_overview_is_branch_scoped_and_includes_confirmed_transfer(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        other = _seed_branch(factory, code="other", name="Other Branch")
        actor, _ = _seed_receptionist(factory, branch)
        with factory.begin() as session:
            member = Member(member_number="GIMI-TRF", full_name="Gimi Member", phone="5550100")
            plan = Plan(code="gimi-plan", name="Gimi Plan", kind="membership", status="active")
            session.add_all([member, plan])
            session.flush()
            version = PlanVersion(plan_id=plan.id, version_number=1, name="Gimi Plan", price_minor=12000,
                                  currency="MXN", duration_value=1, duration_unit="month", is_active=True)
            session.add(version)
            register = create_cash_register(session, branch, "gimi-trf", "Gimi")
            session.flush()
            open_shift(session, register_id=register.id, opened_by=actor,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            sale = post_membership_cash_sale(session, register_id=register.id, actor_id=actor,
                authorized_branch_id=branch, member_id=member.id, plan_version_id=version.id,
                idempotency_key="gimi-trf", payment_method="transfer")
            for payment in session.query(Payment).filter(Payment.order_id == sale.order.id):
                payment.status = "confirmed"
        decision = JevRouteDecision(tool_name="owner_financial_overview", confidence=0.94, is_ambiguous=False, required_threshold=0.68)
        with factory() as session:
            mine = GimiDispatcher().dispatch(session, decision, GimiActor(role=GimiRole.OWNER, branch_id=branch))
            theirs = GimiDispatcher().dispatch(session, decision, GimiActor(role=GimiRole.OWNER, branch_id=other))
        assert mine.status == DispatchStatus.SUCCESS
        assert mine.data["transfer_minor"] == 12000 and mine.data["total_sales_minor"] == 12000
        assert theirs.data["total_sales_minor"] == 0
    finally:
        engine.dispose()