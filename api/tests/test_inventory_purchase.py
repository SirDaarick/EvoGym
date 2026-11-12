"""Public-interface checks for grouped inventory purchases."""
from fastapi.testclient import TestClient
from uuid import UUID
from sqlalchemy import select

from app.db.models import Expense, InventoryPurchase, Product, Shift, StockInitialization, StockMovement
from app.main import create_app
from app.shifts.queries import create_cash_register, expected_cash_for_shift
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from admin_session_helpers import approved_admin_headers
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def test_purchase_records_multiple_products_and_one_non_drawer_expense(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        staff, token = _seed_receptionist(factory, branch)
        with factory.begin() as session:
            products = [Product(code=f"purchase-{i}", name=f"Purchase {i}", category="Bebidas",
                                price_minor=500, cost_minor=100, is_active=True, created_by=staff)
                        for i in range(2)]
            session.add_all(products)
            session.flush()
            ids = [str(product.id) for product in products]
        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "purchase-one"}
        body = {"items": [{"product_id": ids[0], "quantity": 2, "cost_minor": 250},
                          {"product_id": ids[1], "quantity": 3, "cost_minor": 450}],
                "pay_from_drawer": False}
        with TestClient(create_app(configured_settings(url))) as client:
            response = client.post(f"/api/v1/inventory/branches/{branch}/purchases", headers=headers, json=body)
            assert response.status_code == 201, response.text
            assert response.json()["total_minor"] == 700
            replay = client.post(f"/api/v1/inventory/branches/{branch}/purchases", headers=headers, json=body)
            assert replay.status_code == 200
            assert replay.json() == response.json()
            changed = {**body, "items": [{**body["items"][0], "quantity": 4}, body["items"][1]]}
            assert client.post(f"/api/v1/inventory/branches/{branch}/purchases", headers=headers, json=changed).status_code == 409
            stock = client.get(f"/api/v1/inventory/branches/{branch}/stock", headers=headers).json()["items"]
            assert {item["product_id"]: item["quantity"] for item in stock} == {ids[0]: 2, ids[1]: 3}
        with factory() as session:
            expenses = session.scalars(select(Expense)).all()
            assert len(expenses) == 1
            assert expenses[0].amount_minor == 700
            assert expenses[0].shift_id is None
            purchase = session.scalar(select(InventoryPurchase))
            assert sum(line["cost_minor"] for line in purchase.lines) == 700
    finally:
        engine.dispose()


def test_drawer_purchase_rejects_insufficient_cash_and_commits_once_when_funded(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        staff, token = _seed_receptionist(factory, branch)
        with factory.begin() as session:
            product = Product(code="drawer-water", name="Water", category="Bebidas", price_minor=500,
                              cost_minor=100, is_active=True, created_by=staff)
            register = create_cash_register(session, branch, "drawer", "Drawer")
            session.add(product)
            session.flush()
            product_id, register_id = str(product.id), str(register.id)
            shift = open_shift(session, register_id=register.id, opened_by=staff,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 10}])
            shift_id = shift.id
        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "drawer-purchase"}
        body = {"items": [{"product_id": product_id, "quantity": 3, "cost_minor": 1001}],
                "pay_from_drawer": True, "register_id": register_id}
        with TestClient(create_app(configured_settings(url))) as client:
            rejected = client.post(f"/api/v1/inventory/branches/{branch}/purchases", headers=headers, json=body)
            assert rejected.status_code == 409
            assert rejected.json()["error"]["code"] == "inventory_purchase_rejected"
            with factory() as session:
                assert session.scalar(select(InventoryPurchase)) is None
                assert session.scalar(select(Expense)) is None
                assert session.scalar(select(StockMovement)) is None
                assert session.scalar(select(StockInitialization)) is None
                assert expected_cash_for_shift(session, session.get(Shift, shift_id)) == 1000
            body["items"][0]["cost_minor"] = 1000
            accepted = client.post(f"/api/v1/inventory/branches/{branch}/purchases", headers=headers, json=body)
            assert accepted.status_code == 201, accepted.text
        with factory() as session:
            assert expected_cash_for_shift(session, session.get(Shift, shift_id)) == 0
            assert session.get(Product, UUID(product_id)).cost_minor == 333
            assert session.scalar(select(Expense)).amount_minor == 1000
    finally:
        engine.dispose()


def test_purchase_key_cannot_be_reused_by_a_different_receptionist(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        staff, token = _seed_receptionist(factory, branch)
        _, other_token = _seed_receptionist(factory, branch, login="other@example.invalid")
        with factory.begin() as session:
            product = Product(code="shared-key-water", name="Water", category="Bebidas", price_minor=500,
                              cost_minor=100, is_active=True, created_by=staff)
            session.add(product)
            session.flush()
            product_id = str(product.id)
        body = {"items": [{"product_id": product_id, "quantity": 1, "cost_minor": 150}], "pay_from_drawer": False}
        with TestClient(create_app(configured_settings(url))) as client:
            first = client.post(f"/api/v1/inventory/branches/{branch}/purchases", headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "shared-key"}, json=body)
            second = client.post(f"/api/v1/inventory/branches/{branch}/purchases", headers={"Authorization": f"Bearer {other_token}", "Idempotency-Key": "shared-key"}, json=body)
            assert first.status_code == 201
            assert second.status_code == 409
        with factory() as session:
            assert len(session.scalars(select(Expense)).all()) == 1
            assert len(session.scalars(select(InventoryPurchase)).all()) == 1
            assert len(session.scalars(select(StockMovement)).all()) == 1
    finally:
        engine.dispose()


def test_cost_increase_is_visible_to_admin_without_changing_sale_price(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        staff, token = _seed_receptionist(factory, branch)
        seed_admin(factory)
        with factory.begin() as session:
            product = Product(code="alert-water", name="Water", category="Bebidas", price_minor=500,
                              cost_minor=100, is_active=True, created_by=staff)
            session.add(product)
            session.flush()
            product_id = str(product.id)
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "cost-increase"}
            response = client.post(f"/api/v1/inventory/branches/{branch}/purchases", headers=headers,
                                   json={"items": [{"product_id": product_id, "quantity": 2, "cost_minor": 250}],
                                         "pay_from_drawer": False})
            assert response.status_code == 201
            assert client.get(f"/api/v1/inventory/branches/{branch}/purchase-cost-alerts", headers=headers).status_code == 403
            admin = approved_admin_headers(client, delivery)
            alerts = client.get(f"/api/v1/inventory/branches/{branch}/purchase-cost-alerts", headers=admin)
            assert alerts.status_code == 200
            assert [(a["product_id"], a["previous_cost_minor"], a["unit_cost_minor"]) for a in alerts.json()["items"]] == [(product_id, 100, 125)]
            void = client.post(f"/api/v1/expenses/{response.json()['expense_id']}/void", headers=admin, json={"reason": "Incorrect purchase"})
            assert void.status_code == 200
            assert void.json()["void_reason"] == "Incorrect purchase"
            replay = client.post(f"/api/v1/expenses/{response.json()['expense_id']}/void", headers=admin, json={"reason": "Incorrect purchase"})
            assert replay.status_code == 200
            alerts_after_void = client.get(f"/api/v1/inventory/branches/{branch}/purchase-cost-alerts", headers=admin).json()["items"]
            assert alerts_after_void == []
            stock = client.get(f"/api/v1/inventory/branches/{branch}/stock", headers=headers).json()["items"]
            assert next(item for item in stock if item["product_id"] == product_id)["quantity"] == 0
        with factory() as session:
            product = session.get(Product, UUID(product_id))
            assert product.price_minor == 500
            assert product.cost_minor == 100
            expense = session.scalar(select(Expense))
            assert expense.voided_at is not None
            assert expense.void_reason == "Incorrect purchase"
            movements = session.scalars(select(StockMovement).where(StockMovement.product_id == UUID(product_id))).all()
            assert len(movements) == 2
            assert {m.kind for m in movements} == {"restock", "waste"}
            purchase = session.scalar(select(InventoryPurchase))
            assert purchase is not None
            assert len(purchase.lines) == 1
            assert purchase.lines[0]["product_id"] == product_id
    finally:
        engine.dispose()


def test_void_purchase_blocked_when_products_already_sold(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        staff, token = _seed_receptionist(factory, branch)
        seed_admin(factory)
        with factory.begin() as session:
            product = Product(code="sold-water", name="Water", category="Bebidas", price_minor=500,
                              cost_minor=100, is_active=True, created_by=staff)
            session.add(product)
            session.flush()
            product_id = str(product.id)
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "purchase-sold"}
            response = client.post(f"/api/v1/inventory/branches/{branch}/purchases", headers=headers,
                                   json={"items": [{"product_id": product_id, "quantity": 3, "cost_minor": 450}],
                                         "pay_from_drawer": False})
            assert response.status_code == 201
            expense_id = response.json()["expense_id"]

            # Consume/waste 1 unit so stock was sold or consumed
            waste_resp = client.post(f"/api/v1/inventory/branches/{branch}/movements", headers=headers,
                                     json={"product_id": product_id, "kind": "waste", "quantity": 1,
                                           "reason": "Damaged bottle", "idempotency_key": "waste-consumed-1"})
            assert waste_resp.status_code == 201

            admin = approved_admin_headers(client, delivery)
            # Reversal is blocked requiring administrator review
            void = client.post(f"/api/v1/expenses/{expense_id}/void", headers=admin, json={"reason": "Mistaken purchase"})
            assert void.status_code == 409
            assert void.json()["error"]["code"] == "purchase_cancellation_requires_review"

            # Cost alert remains active
            alerts = client.get(f"/api/v1/inventory/branches/{branch}/purchase-cost-alerts", headers=admin).json()["items"]
            assert len(alerts) == 1
            assert alerts[0]["product_id"] == product_id

            # Stock endpoint reflects current stock of 2
            stock = client.get(f"/api/v1/inventory/branches/{branch}/stock", headers=headers).json()["items"]
            assert next(item for item in stock if item["product_id"] == product_id)["quantity"] == 2
        with factory() as session:
            product = session.get(Product, UUID(product_id))
            assert product.cost_minor == 150
            expense = session.get(Expense, UUID(expense_id))
            assert expense.voided_at is None
            assert expense.void_reason is None
            purchase = session.scalar(select(InventoryPurchase).where(InventoryPurchase.expense_id == UUID(expense_id)))
            assert purchase is not None
            assert purchase.lines[0]["quantity"] == 3
    finally:
        engine.dispose()
