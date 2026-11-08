from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import Order, Product, Shift, ShiftCashContribution, StockInitialization
from app.inventory.queries import capture_register_inventory_snapshot
from app.main import create_app
from app.shifts.queries import close_shift, create_cash_register
from test_admin_auth import configured_settings
from test_product_returns import _seed_products_and_member
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def test_close_freezes_expected_cash_from_sale_expense_contribution_and_refund(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "frozen", "Frozen Register")
            shift = open_shift(session, register_id=register.id, opened_by=staff_id,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 2}])
            member, water, bar = _seed_products_and_member(session, branch_id, staff_id)
            register_id, shift_id, member_id = register.id, shift.id, member.id
            water_id, bar_id = str(water.id), str(bar.id)
        auth = {"Authorization": f"Bearer {token}"}
        with TestClient(create_app(configured_settings(url))) as client:
            sale = {"member_id": str(member_id), "expected_total_minor": 3200,
                    "items": [{"product_id": water_id, "quantity": 2}, {"product_id": bar_id, "quantity": 1}]}
            sale_path = f"/api/v1/registers/{register_id}"
            headers = {**auth, "Idempotency-Key": "sale-1"}
            client.post(f"{sale_path}/product-sale-intent", headers=headers, json=sale)
            sold = client.post(f"{sale_path}/product-sales", headers=headers, json=sale)
            assert sold.status_code == 201, sold.text
            bar_item = next(i["id"] for i in sold.json()["items"] if i["product_id"] == bar_id)
            assert client.post(f"{sale_path}/expenses", headers={**auth, "Idempotency-Key": "e1"}, json={
                "category": "limpieza", "concept": "Soap", "payee_name": "Shop", "amount_minor": 300}).status_code == 201
            assert client.post(f"{sale_path}/cash-contributions", headers={**auth, "Idempotency-Key": "c1"}, json={
                "concept": "Fund", "contributor_name": "Admin", "amount_minor": 500}).status_code == 201
            refund = client.post(f"{sale_path}/product-returns", headers={**auth, "Idempotency-Key": "r1"}, json={
                "order_item_id": bar_item, "reason": "Changed mind", "disposition": "restock", "payout_method": "cash"})
            assert refund.status_code == 201, refund.text

            expected = 200 + 3200 - 300 + 500 - 800
            closed = client.post(f"/api/v1/shifts/{shift_id}/close", headers=auth, json={"counted_cash_minor": expected + 100})
            assert closed.status_code == 201, closed.text
            assert closed.json()["status"] == "closed"
            assert closed.json()["expected_cash_at_close_minor"] == expected
            assert closed.json()["difference_minor"] == 100

            with factory.begin() as session:
                row = session.get(Shift, shift_id)
                assert (row.status, row.expected_cash_at_close_minor, row.difference_minor) == ("closed", expected, 100)
                session.add(ShiftCashContribution(
                    shift_id=shift_id, branch_id=branch_id, concept="Late", contributor_name="X", amount_minor=999,
                    recorded_by_id=staff_id, idempotency_key="late", request_fingerprint="late"))
            summary = client.get(f"/api/v1/shifts/{shift_id}/summary", headers=auth)
            assert summary.json()["expected_cash_minor"] == expected
    finally:
        engine.dispose()


def test_http_open_links_pending_overtime_orders_to_the_new_shift(tmp_path):
    from app.sales.queries import post_cash_product_sale
    from app.sales.schemas import ProductCartLineRequest

    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "ot-http", "Overtime HTTP")
            product = Product(code="ot-water", name="Water", price_minor=100, created_by=staff_id)
            session.add(product)
            session.flush()
            session.add(StockInitialization(branch_id=branch_id, product_id=product.id, quantity=3, initialized_by=staff_id))
            register_id, product_id = register.id, product.id
            first = open_shift(session, register_id=register_id, opened_by=staff_id,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            close_shift(session, shift_id=first.id, closed_by=staff_id, denomination_counts=None, counted_cash_minor=0)
            order = post_cash_product_sale(
                session, register_id=register_id, actor_id=staff_id, member_id=None,
                items=[ProductCartLineRequest(product_id=product_id, quantity=1)], expected_total_minor=100,
                idempotency_key="overtime")[0]
            order_id = order.id
            assert order.is_overtime and order.financial_shift_id is None
            snapshot_id = capture_register_inventory_snapshot(session, register_id=register_id, actor_id=staff_id).id
        with TestClient(create_app(configured_settings(url))) as client:
            opened = client.post("/api/v1/shifts/open", headers={"Authorization": f"Bearer {token}"}, json={
                "cash_register_id": str(register_id), "inventory_snapshot_id": str(snapshot_id),
                "denomination_counts": [{"denomination_minor": 100, "quantity": 2}],
                "inventory_observations": [{"product_id": str(product_id), "physical_quantity": 2}]})
            assert opened.status_code == 201, opened.text
            new_shift_id = opened.json()["id"]
        with factory() as session:
            linked = session.scalar(select(Order).where(Order.id == order_id))
            assert str(linked.financial_shift_id) == new_shift_id and linked.cash_included_in_opening is True
    finally:
        engine.dispose()
