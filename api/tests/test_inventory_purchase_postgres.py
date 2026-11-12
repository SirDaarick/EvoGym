"""Disposable PostgreSQL proof for purchase and drawer concurrency."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select

from app.api.inventory import InventoryActorPrincipal, _actor
from app.db.models import Expense, InventoryPurchase, Product, RoleGrant, Shift, StaffUser, StockMovement
from app.inventory.queries import get_on_hand_stock
from app.main import create_app
from app.shifts.queries import expected_cash_for_shift
from admin_session_helpers import approved_admin_headers
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from test_expenses_postgres import postgres_expense_target


def test_concurrent_drawer_purchases_cannot_overspend(postgres_expense_target):
    factory, (branch_id, staff_id, register_id), url = postgres_expense_target
    with factory.begin() as session:
        session.add(RoleGrant(staff_id=staff_id, role="receptionist", scope_kind="branch", branch_id=branch_id))
        other = StaffUser(login_identifier=f"{uuid4()}@example.invalid")
        session.add(other)
        session.flush()
        other_id = other.id
        session.add(RoleGrant(staff_id=other_id, role="receptionist", scope_kind="branch", branch_id=branch_id))
        product = Product(code=f"purchase-{uuid4().hex}", name="Purchase water", category="Bebidas",
                          price_minor=200, cost_minor=100, is_active=True, created_by=staff_id)
        session.add(product)
        session.flush()
        product_id = product.id
        shift_id = session.scalar(select(Shift.id).where(Shift.cash_register_id == register_id, Shift.status == "open"))
    app = create_app(configured_settings(url))
    def actor(request: Request):
        return InventoryActorPrincipal(other_id if request.headers.get("X-Test-Actor") == "other" else staff_id, False, branch_id)
    app.dependency_overrides[_actor] = actor
    body = {"items": [{"product_id": str(product_id), "quantity": 1, "cost_minor": 150}],
            "pay_from_drawer": True, "register_id": str(register_id)}
    barrier = Barrier(2)
    with TestClient(app) as client:
        def submit(key, actor_name):
            barrier.wait()
            return client.post(f"/api/v1/inventory/branches/{branch_id}/purchases", headers={"Idempotency-Key": key, "X-Test-Actor": actor_name}, json=body)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = pool.submit(submit, "purchase-a", "first"), pool.submit(submit, "purchase-b", "other")
            responses = [first.result(), second.result()]
        assert sorted(response.status_code for response in responses) == [201, 409]
    with factory() as session:
        assert len(session.scalars(select(Expense)).all()) == 1
        assert len(session.scalars(select(InventoryPurchase)).all()) == 1
        assert get_on_hand_stock(session, branch_id=branch_id, product_id=product_id) == 1


        assert expected_cash_for_shift(session, session.get(Shift, shift_id)) == 50


def test_purchase_migration_refuses_to_discard_recorded_purchases(postgres_expense_target):
    factory, (branch_id, staff_id, _), _ = postgres_expense_target
    with factory.begin() as session:
        product = Product(code=f"purchase-{uuid4().hex}", name="Purchase water", category="Bebidas",
                          price_minor=200, cost_minor=100, is_active=True, created_by=staff_id)
        expense = Expense(branch_id=branch_id, category="consumibles", concept="Inventory purchase",
                          payee_name="Not provided", amount_minor=100, payment_method="cash",
                          recorded_by_id=staff_id, idempotency_key="expense-proof", request_fingerprint="a" * 64)
        session.add_all([product, expense])
        session.flush()
        session.add(InventoryPurchase(branch_id=branch_id, recorded_by=staff_id, expense_id=expense.id,
                                      idempotency_key="purchase-proof", request_fingerprint="a" * 64,
                                      total_minor=100, lines=[{"product_id": str(product.id), "quantity": 1, "cost_minor": 100}]))
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    with pytest.raises(RuntimeError, match="Cannot remove recorded inventory purchases"):
        command.downgrade(config, "0065_shared_member_phones")
    with factory() as session:
        assert len(session.scalars(select(InventoryPurchase)).all()) == 1
        assert len(session.scalars(select(Expense)).all()) == 1


def test_concurrent_same_key_from_different_actors_commits_once(postgres_expense_target):
    factory, (branch_id, staff_id, _), url = postgres_expense_target
    with factory.begin() as session:
        other = StaffUser(login_identifier=f"{uuid4()}@example.invalid")
        session.add(other)
        session.flush()
        other_id = other.id
        session.add_all([RoleGrant(staff_id=actor, role="receptionist", scope_kind="branch", branch_id=branch_id)
                         for actor in (staff_id, other_id)])
        product = Product(code=f"purchase-{uuid4().hex}", name="Water", category="Bebidas",
                          price_minor=200, cost_minor=100, is_active=True, created_by=staff_id)
        session.add(product)
        session.flush()
        product_id = product.id
    app = create_app(configured_settings(url))
    def actor(request: Request):
        return InventoryActorPrincipal(other_id if request.headers.get("X-Test-Actor") == "other" else staff_id, False, branch_id)
    app.dependency_overrides[_actor] = actor
    body = {"items": [{"product_id": str(product_id), "quantity": 1, "cost_minor": 150}], "pay_from_drawer": False}
    barrier = Barrier(2)
    with TestClient(app) as client:
        def submit(actor_name):
            barrier.wait()
            return client.post(f"/api/v1/inventory/branches/{branch_id}/purchases", headers={"Idempotency-Key": "shared-key", "X-Test-Actor": actor_name}, json=body)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = pool.submit(submit, "first"), pool.submit(submit, "other")
            responses = [first.result(), second.result()]
        assert sorted(response.status_code for response in responses) == [201, 409]
    with factory() as session:
        assert len(session.scalars(select(Expense)).all()) == 1
        assert len(session.scalars(select(InventoryPurchase)).all()) == 1
        assert get_on_hand_stock(session, branch_id=branch_id, product_id=product_id) == 1


def test_purchase_migration_upgrade_downgrade_cycle_postgres(postgres_expense_target):
    factory, _, url = postgres_expense_target
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    engine = factory.kw["bind"]
    # Starting at head (0066_inventory_purchases)
    assert "inventory_purchases" in inspect(engine).get_table_names()
    # Clean downgrade 0066 -> 0065
    command.downgrade(config, "0065_shared_member_phones")
    assert "inventory_purchases" not in inspect(engine).get_table_names()
    # Upgrade 0065 -> 0066
    command.upgrade(config, "0066_inventory_purchases")
    assert "inventory_purchases" in inspect(engine).get_table_names()
    # Downgrade again 0066 -> 0065
    command.downgrade(config, "0065_shared_member_phones")
    assert "inventory_purchases" not in inspect(engine).get_table_names()
    # Re-upgrade to head
    command.upgrade(config, "head")
    assert "inventory_purchases" in inspect(engine).get_table_names()


def test_purchase_void_intact_and_blocked_when_sold_postgres(postgres_expense_target):
    factory, (branch_id, staff_id, register_id), url = postgres_expense_target
    admin_id = seed_admin(factory)
    delivery = FakeRecoveryDelivery()
    with factory.begin() as session:
        session.add(RoleGrant(staff_id=staff_id, role="receptionist", scope_kind="branch", branch_id=branch_id))
        product = Product(code=f"purchase-{uuid4().hex}", name="Water", category="Bebidas",
                          price_minor=200, cost_minor=50, is_active=True, created_by=staff_id)
        session.add(product)
        session.flush()
        product_id = product.id
        shift_id = session.scalar(select(Shift.id).where(Shift.cash_register_id == register_id, Shift.status == "open"))

    app = create_app(configured_settings(url), recovery_delivery=delivery)
    admin_headers = {}

    def actor(request: Request):
        if request.headers.get("Authorization") == admin_headers.get("Authorization") and admin_headers:
            return InventoryActorPrincipal(admin_id, True, None)
        return InventoryActorPrincipal(staff_id, False, branch_id)

    app.dependency_overrides[_actor] = actor

    with TestClient(app) as client:
        admin_headers.update(approved_admin_headers(client, delivery))
        # 1. Drawer-funded purchase when intact
        body = {"items": [{"product_id": str(product_id), "quantity": 1, "cost_minor": 100}],
                "pay_from_drawer": True, "register_id": str(register_id)}
        purchase_resp = client.post(f"/api/v1/inventory/branches/{branch_id}/purchases",
                                    headers={"Idempotency-Key": "pg-purchase-intact"}, json=body)
        assert purchase_resp.status_code == 201
        expense_id = purchase_resp.json()["expense_id"]

        with factory() as session:
            assert expected_cash_for_shift(session, session.get(Shift, shift_id)) == 100
            assert get_on_hand_stock(session, branch_id=branch_id, product_id=product_id) == 1
            assert session.get(Product, product_id).cost_minor == 100
            purchase_row = session.scalar(select(InventoryPurchase).where(InventoryPurchase.expense_id == UUID(expense_id)))
            assert purchase_row is not None
            assert len(purchase_row.lines) == 1
            assert purchase_row.lines[0]["quantity"] == 1
            assert purchase_row.lines[0]["cost_minor"] == 100

        # Void intact purchase
        void_resp = client.post(f"/api/v1/expenses/{expense_id}/void", headers=admin_headers,
                                json={"reason": "Entered in error"})
        assert void_resp.status_code == 200
        assert void_resp.json()["void_reason"] == "Entered in error"

        with factory() as session:
            assert expected_cash_for_shift(session, session.get(Shift, shift_id)) == 200
            assert get_on_hand_stock(session, branch_id=branch_id, product_id=product_id) == 0
            assert session.get(Product, product_id).cost_minor == 50
            assert session.get(Expense, UUID(expense_id)).voided_at is not None

        # 2. Purchase when products already sold -> voiding is blocked requiring admin review
        body_sold = {"items": [{"product_id": str(product_id), "quantity": 2, "cost_minor": 160}],
                     "pay_from_drawer": False}
        purchase_sold_resp = client.post(f"/api/v1/inventory/branches/{branch_id}/purchases",
                                         headers={"Idempotency-Key": "pg-purchase-sold"}, json=body_sold)
        assert purchase_sold_resp.status_code == 201
        expense_sold_id = purchase_sold_resp.json()["expense_id"]

        # Record a waste / sale movement
        waste_resp = client.post(f"/api/v1/inventory/branches/{branch_id}/movements",
                                 headers={"Idempotency-Key": "pg-waste-1"},
                                 json={"product_id": str(product_id), "kind": "waste", "quantity": 1,
                                       "reason": "Damaged can", "idempotency_key": "pg-waste-1"})
        assert waste_resp.status_code == 201

        # Attempt to void -> blocked with domain error
        blocked_void = client.post(f"/api/v1/expenses/{expense_sold_id}/void", headers=admin_headers,
                                   json={"reason": "Cancel mistaken purchase"})
        assert blocked_void.status_code == 409
        assert blocked_void.json()["error"]["code"] == "purchase_cancellation_requires_review"

        # Inspect DB rows directly
        with factory() as session:
            expense_row = session.get(Expense, UUID(expense_sold_id))
            assert expense_row.voided_at is None
            assert session.get(Product, product_id).cost_minor == 80
            assert get_on_hand_stock(session, branch_id=branch_id, product_id=product_id) == 1
            purchase_db = session.scalar(select(InventoryPurchase).where(InventoryPurchase.expense_id == UUID(expense_sold_id)))
            assert purchase_db.total_minor == 160
            movements = session.scalars(select(StockMovement).where(StockMovement.branch_id == branch_id,
                                                                    StockMovement.product_id == product_id)).all()
            assert len(movements) == 4

        # Read endpoints match DB
        stock_items = client.get(f"/api/v1/inventory/branches/{branch_id}/stock").json()["items"]
        assert next(item for item in stock_items if item["product_id"] == str(product_id))["quantity"] == 1
