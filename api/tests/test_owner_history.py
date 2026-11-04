from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import create_app
from admin_session_helpers import approved_admin_headers
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift
from app.db.models import Member, MemberCheckIn, Plan, PlanVersion, StockMovement
from app.db.models.member_check_ins import MemberCheckInVisit
from app.inventory.queries import create_product
from app.sales.queries import post_cash_product_sale, post_membership_cash_sale
from app.sales.schemas import ProductCartLineRequest
from app.shifts.queries import create_cash_register


def _seed(factory, branch, actor, extra_visits=0):
    now = datetime.now(timezone.utc)
    with factory.begin() as session:
        member = Member(member_number="HIST-1", full_name="History Member", phone="5550100")
        plan = Plan(code="hist-plan", name="Hist Plan", kind="membership", status="active")
        session.add_all([member, plan])
        session.flush()
        version = PlanVersion(plan_id=plan.id, version_number=1, name="Hist Plan", price_minor=12000, currency="MXN",
                              duration_value=1, duration_unit="month", is_active=True)
        session.add(version)
        product = create_product(session, name="Water", created_by=actor, price_minor=500,
                                 initial_quantity=20, initial_branch_id=branch)
        register = create_cash_register(session, branch, "hist", "Caja Historial")
        session.flush()
        open_shift(session, register_id=register.id, opened_by=actor,
                   denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
                   inventory_observations=[{"product_id": product.id, "physical_quantity": 18, "reason": "Count"}])
        sale = post_membership_cash_sale(session, register_id=register.id, actor_id=actor, authorized_branch_id=branch,
                                         member_id=member.id, plan_version_id=version.id, idempotency_key="hist-m",
                                         cash_amount_minor=12000, cash_amount_provided=True)
        post_cash_product_sale(session, register_id=register.id, actor_id=actor, member_id=None,
                               items=[ProductCartLineRequest(product_id=product.id, quantity=2)],
                               expected_total_minor=1000, idempotency_key="hist-p")
        session.add_all([
            StockMovement(branch_id=branch, product_id=product.id, kind="restock", quantity=5, recorded_by=actor,
                          idempotency_key="hist-r", recorded_at=now),
            StockMovement(branch_id=branch, product_id=product.id, kind="waste", quantity=1, reason="Roto",
                          recorded_by=actor, idempotency_key="hist-w", recorded_at=now),
        ])
        same = now - timedelta(minutes=1)  # identical timestamps exercise the id tie-breaker
        for index in range(1 + extra_visits):
            visit = MemberCheckInVisit(member_id=member.id, started_at=same)
            session.add(visit)
            session.flush()
            session.add(MemberCheckIn(visit_id=visit.id, member_id=member.id, period_id=sale.membership.id,
                                      branch_id=branch, recorded_by=actor, idempotency_key=f"hist-v{index}",
                                      request_fingerprint="d" * 64, access_reason="valid", access_warnings=[],
                                      occurred_at=same))


def _client(tmp_path, extra_visits=0):
    url, engine, factory = _setup_db(tmp_path)
    branch = _seed_branch(factory)
    actor, reception_token = _seed_receptionist(factory, branch)
    seed_admin(factory)
    _seed(factory, branch, actor, extra_visits)
    delivery = FakeRecoveryDelivery()
    client = TestClient(create_app(configured_settings(url), recovery_delivery=delivery))
    return engine, client, delivery, branch, reception_token


def _all(client, headers, query):
    items, cursor = [], None
    while True:
        response = client.get(f"/api/v1/owner/history?{query}" + (f"&cursor={cursor}" if cursor else ""), headers=headers)
        assert response.status_code == 200, response.text
        body = response.json()
        items.extend(body["items"])
        cursor = body["next_cursor"]
        if not cursor:
            return items


def test_history_union_filters_and_shape(tmp_path):
    engine, client, delivery, branch, _ = _client(tmp_path)
    try:
        with client:
            headers = approved_admin_headers(client, delivery)
            items = _all(client, headers, f"branch_id={branch}&limit=200")
            assert {i["category"] for i in items} == {"membership", "product", "visit", "restock", "waste", "count", "shift"}
            times = [(i["occurred_at"], i["id"]) for i in items]
            assert times == sorted(times, reverse=True)
            membership = next(i for i in items if i["category"] == "membership")
            assert membership["amount_minor"] == 12000 and membership["method"] == "cash"
            assert membership["status"] == "confirmed" and membership["member_name"] == "History Member"
            assert membership["actor_name"] == "receptionist@evogym.com" and membership["description"] == "Hist Plan"
            assert next(i for i in items if i["category"] == "product")["amount_minor"] == 1000
            assert next(i for i in items if i["category"] == "waste")["amount_minor"] is None
            assert {k for k in items[0]} >= {"id", "category", "occurred_at", "description", "detail", "status",
                                             "amount_minor", "method", "actor_id", "actor_name", "shift_id", "branch_id"}
            for category, count in (("membership", 1), ("product", 1), ("visit", 1), ("restock", 1), ("waste", 1),
                                    ("count", 1), ("shift", 1)):
                got = _all(client, headers, f"branch_id={branch}&category={category}")
                assert len(got) == count and {i["category"] for i in got} == {category}
            money = _all(client, headers, f"branch_id={branch}&method=cash")
            assert {i["category"] for i in money} == {"membership", "product"}
            assert _all(client, headers, f"branch_id={branch}&method=card") == []
            assert _all(client, headers, f"branch_id={branch}&from=2001-01-01&to=2001-01-02") == []
            assert len(_all(client, headers, "")) == len(items)  # no branch_id: every authorized branch
    finally:
        engine.dispose()


def test_history_pagination_is_stable_with_tied_timestamps(tmp_path):
    engine, client, delivery, branch, _ = _client(tmp_path, extra_visits=6)
    try:
        with client:
            headers = approved_admin_headers(client, delivery)
            full = _all(client, headers, f"branch_id={branch}&limit=200")
            for size in (1, 2, 3, 5):
                paged = _all(client, headers, f"branch_id={branch}&limit={size}")
                assert [i["id"] for i in paged] == [i["id"] for i in full]
            assert len({i["id"] for i in full}) == len(full)
            first = client.get(f"/api/v1/owner/history?branch_id={branch}&limit=2", headers=headers).json()
            assert len(first["items"]) == 2 and first["next_cursor"]
            assert client.get(f"/api/v1/owner/history?branch_id={branch}&limit=200", headers=headers).json()["next_cursor"] is None
    finally:
        engine.dispose()


def test_history_validation_and_authorization(tmp_path):
    engine, client, delivery, branch, reception_token = _client(tmp_path)
    try:
        with client:
            assert client.get("/api/v1/owner/history").status_code == 403
            assert client.get(f"/api/v1/owner/history?branch_id={branch}",
                              headers={"Authorization": f"Bearer {reception_token}"}).status_code == 403
            headers = approved_admin_headers(client, delivery)
            base = f"/api/v1/owner/history?branch_id={branch}"
            assert client.get(base + "&category=bogus", headers=headers).status_code == 422
            assert client.get(base + "&method=bogus", headers=headers).status_code == 422
            assert client.get(base + "&from=2026-10-02&to=2026-10-01", headers=headers).status_code == 422
            assert client.get(base + "&cursor=not-a-cursor", headers=headers).status_code == 422
            assert client.get(base + "&limit=0", headers=headers).status_code == 422
            assert client.get(base + "&limit=201", headers=headers).status_code == 422
            assert client.get("/api/v1/owner/history?branch_id=00000000-0000-0000-0000-000000000001",
                              headers=headers).status_code == 403
    finally:
        engine.dispose()
