"""Session-level policies reused by offline reconciliation (Phase 5): check-ins and cash sales."""
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db.models import (
    Member, MembershipPeriod, MemberCheckIn, Product, StockInitialization, StaffUser,
)
from app.db.models.member_check_ins import MemberCheckInVisit
from app.main import create_app
from app.memberships.service import apply_member_check_in
from app.sales.queries import (
    ProductSaleRejected, SalePolicy, post_cash_product_sale, post_contingency_cash_sale,
)
from app.sales.schemas import ProductCartLineRequest
from app.inventory.queries import get_on_hand_stock
from app.shifts.queries import create_cash_register
from test_admin_auth import configured_settings
from test_member_check_ins import _seed_membership
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


_BASE = datetime.now(timezone.utc).replace(microsecond=0)


def _fingerprint(branch_id, period_id, actor_id):
    return sha256(f"{branch_id}\n{period_id}\n{actor_id}".encode()).hexdigest()


def _sell_membership(client, token, register_id, member_id, version_id, key):
    sale = client.post(f"/api/v1/registers/{register_id}/membership-sales",
                       headers={"Authorization": f"Bearer {token}", "Idempotency-Key": key},
                       json={"member_id": str(member_id), "plan_version_id": str(version_id)})
    assert sale.status_code == 201, sale.text
    return UUID(sale.json()["membership"]["id"])


@pytest.fixture
def checkin_env(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "cont-checkin", "Contingency Checkin")
        actor_id, token = _seed_receptionist(factory, branch_id)
        member_id, version_id, register_id = _seed_membership(factory, branch_id, actor_id, "CONT")
        with TestClient(create_app(configured_settings(url))) as client:
            period_id = _sell_membership(client, token, register_id, member_id, version_id, "cont-sale")
            yield client, factory, token, branch_id, actor_id, member_id, period_id
    finally:
        engine.dispose()


def _apply(factory, env, key, occurred_at, **kw):
    _, _, _, branch_id, actor_id, _, period_id = env
    with factory.begin() as session:
        result = apply_member_check_in(
            session, branch_id=branch_id, period_id=period_id, actor_id=actor_id, occurred_at=occurred_at,
            idempotency_key=key, request_fingerprint=_fingerprint(branch_id, period_id, actor_id), **kw)
        return (result.check_in.id, result.visit.id, result.replayed, result.access_decision,
                result.linked_to_existing_visit)


def test_online_check_in_unchanged_over_http(checkin_env):
    client, factory, token, branch_id, _, member_id, period_id = checkin_env
    path = f"/api/v1/member-check-ins/branches/{branch_id}/periods/{period_id}"
    headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "online-1"}
    first = client.post(path, headers=headers)
    assert first.status_code == 201, first.text
    replay = client.post(path, headers=headers)
    assert replay.status_code == 200 and replay.json()["replayed"] is True
    assert replay.json()["id"] == first.json()["id"]


def test_window_boundary_299_links_and_300_starts_new_visit(checkin_env):
    factory = checkin_env[1]
    base = _BASE
    _, visit_a, _, decision, linked = _apply(factory, checkin_env, "w-0", base)
    assert decision.allowed and linked is False
    _, visit_b, _, _, linked_b = _apply(factory, checkin_env, "w-299", base + timedelta(seconds=299))
    assert visit_b == visit_a and linked_b is True
    _, visit_c, _, _, linked_c = _apply(factory, checkin_env, "w-300", base + timedelta(seconds=300))
    assert visit_c != visit_a and linked_c is False


def test_out_of_order_older_event_links_to_covering_visit(checkin_env):
    factory = checkin_env[1]
    base = _BASE
    _, early, *_ = _apply(factory, checkin_env, "o-early", base)
    _, late, *_ = _apply(factory, checkin_env, "o-late", base + timedelta(minutes=30))
    assert early != late
    _, linked_visit, _, _, linked = _apply(factory, checkin_env, "o-late-arrival", base + timedelta(seconds=120))
    assert linked is True and linked_visit == early
    _, orphan_visit, _, _, linked = _apply(factory, checkin_env, "o-gap", base + timedelta(minutes=10))
    assert linked is False and orphan_visit not in (early, late)
    with factory() as session:
        started = session.scalar(select(MemberCheckInVisit.started_at).where(MemberCheckInVisit.id == orphan_visit))
        assert started.replace(tzinfo=timezone.utc) == base + timedelta(minutes=10)


def test_idempotent_replay_adds_no_rows(checkin_env):
    factory = checkin_env[1]
    at = _BASE
    first, visit, replayed, _, _ = _apply(factory, checkin_env, "r-1", at)
    again, visit_again, replayed_again, decision, _ = _apply(factory, checkin_env, "r-1", at)
    assert (replayed, replayed_again) == (False, True)
    assert again == first and visit_again == visit and decision is None
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(MemberCheckIn)) == 1


def test_enforce_access_false_records_denied_check_in(checkin_env):
    _, factory, _, branch_id, actor_id, member_id, period_id = checkin_env
    with factory.begin() as session:
        period = session.get(MembershipPeriod, period_id)
        period.starts_on = date.today() - timedelta(days=60)
        period.ends_on = date.today() - timedelta(days=30)
    at = _BASE
    with pytest.raises(Exception) as denied:
        _apply(factory, checkin_env, "d-enforced", at)
    assert "membership_access_denied" in repr(denied.value) or getattr(denied.value, "code", "") == "membership_access_denied"
    check_in_id, _, _, decision, _ = _apply(factory, checkin_env, "d-offline", at, enforce_access=False)
    assert decision.allowed is False and decision.status.value == "expired"
    with factory() as session:
        event = session.get(MemberCheckIn, check_in_id)
        assert event.access_reason == decision.reason
        assert "access_denied:expired" in event.access_warnings


# --- cash sales -------------------------------------------------------------------------------------

def _sale_env(factory, stock):
    branch_id = _seed_branch(factory, "cont-sale", "Contingency Sale")
    actor_id, _ = _seed_receptionist(factory, branch_id)
    with factory.begin() as session:
        register = create_cash_register(session, branch_id, "pos", "POS")
        product = Product(code="towel", name="Towel", price_minor=2000, created_by=actor_id)
        session.add(product)
        session.flush()
        if stock is not None:
            session.add(StockInitialization(branch_id=branch_id, product_id=product.id, quantity=stock,
                                            initialized_by=actor_id))
            session.flush()
        open_shift(session, register_id=register.id, opened_by=actor_id,
                   denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
                   inventory_observations=[{"product_id": product.id, "physical_quantity": stock, "reason": "count"}]
                   if stock is not None else None)
        return branch_id, actor_id, register.id, product.id


def test_online_cash_sale_still_rejects_insufficient_stock(tmp_path):
    _, engine, factory = _setup_db(tmp_path)
    try:
        branch_id, actor_id, register_id, product_id = _sale_env(factory, 1)
        with pytest.raises(ProductSaleRejected):
            with factory.begin() as session:
                post_cash_product_sale(session, register_id=register_id, actor_id=actor_id, member_id=None,
                                       items=[ProductCartLineRequest(product_id=product_id, quantity=3)],
                                       expected_total_minor=6000, idempotency_key="online-short")
        assert SalePolicy.ONLINE.value == "online" and SalePolicy.CONTINGENCY.value == "contingency"
    finally:
        engine.dispose()


def test_contingency_sale_allows_negative_stock_and_reports_variance(tmp_path):
    _, engine, factory = _setup_db(tmp_path)
    try:
        branch_id, actor_id, register_id, product_id = _sale_env(factory, 1)
        at = _BASE
        with factory.begin() as session:
            result = post_contingency_cash_sale(
                session, register_id=register_id, actor_id=actor_id, member_id=None,
                items=[ProductCartLineRequest(product_id=product_id, quantity=3)],
                expected_total_minor=6000, idempotency_key="cont-short", occurred_at=at,
                offline_receipt_number="evt-1")
            order_id = result.order.id
            assert result.replayed is False and result.price_drifts == []
            assert result.variances == [{"product_id": product_id, "on_hand_before": 1, "quantity": 3,
                                         "on_hand_after": -2}]
            assert get_on_hand_stock(session, branch_id=branch_id, product_id=product_id) == -2
            assert result.order.total_minor == 6000
            if hasattr(result.order, "offline_receipt_number"):
                assert result.order.offline_receipt_number == "evt-1"
        with factory.begin() as session:
            replay = post_contingency_cash_sale(
                session, register_id=register_id, actor_id=actor_id, member_id=None,
                items=[ProductCartLineRequest(product_id=product_id, quantity=3)],
                expected_total_minor=6000, idempotency_key="cont-short")
            assert replay.replayed is True and replay.order.id == order_id
    finally:
        engine.dispose()


def test_contingency_sale_reports_price_drift_and_uses_device_price(tmp_path):
    _, engine, factory = _setup_db(tmp_path)
    try:
        _, actor_id, register_id, product_id = _sale_env(factory, 5)
        with factory.begin() as session:
            result = post_contingency_cash_sale(
                session, register_id=register_id, actor_id=actor_id, member_id=None,
                items=[ProductCartLineRequest(product_id=product_id, quantity=2)],
                expected_total_minor=3000, idempotency_key="cont-drift", unit_prices={product_id: 1500})
            assert result.variances == []
            assert result.price_drifts == [{"product_id": product_id, "device_unit_price_minor": 1500,
                                            "server_unit_price_minor": 2000}]
            assert result.order.total_minor == 3000
            assert result.order.items[0].unit_amount_minor == 1500
    finally:
        engine.dispose()
