from unittest.mock import patch
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db.models import Order, Product, StockInitialization
from app.inventory.queries import get_on_hand_stock, open_container
from app.main import create_app
from app.shifts.queries import create_cash_register
from test_admin_auth import configured_settings
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def test_scoop_sale_rejected_at_zero_stock_until_container_is_opened(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "scoop-reg", "Scoop")
            open_shift(session, register_id=register.id, opened_by=staff_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
            container = Product(code="whey", name="Whey 2kg", price_minor=90000, created_by=staff_id)
            session.add(container)
            session.flush()
            scoop = Product(code="whey-s", name="Whey serving", price_minor=2500, unit="scoop",
                            servings_per_container=30, container_product_id=container.id, created_by=staff_id)
            session.add(scoop)
            session.flush()
            session.add(StockInitialization(branch_id=branch_id, product_id=container.id, quantity=2, initialized_by=staff_id))
            session.add(StockInitialization(branch_id=branch_id, product_id=scoop.id, quantity=0, initialized_by=staff_id))
            register_id, scoop_id = register.id, scoop.id

        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "scoop-sale-1"}
        payload = {"member_id": None, "items": [{"product_id": str(scoop_id), "quantity": 1}], "expected_total_minor": 2500}
        with TestClient(create_app(configured_settings(url))) as client:
            sales = f"/api/v1/registers/{register_id}/product-sales"
            client.post(f"{sales.replace('product-sales', 'product-sale-intent')}", headers=headers, json=payload)
            assert client.post(sales, headers=headers, json=payload).status_code == 409
            with factory.begin() as session:
                assert session.scalar(select(func.count()).select_from(Order)) == 0
                assert open_container(session, branch_id=branch_id, product_id=scoop_id, actor_id=staff_id, idempotency_key="open-1")
            ok = client.post(sales, headers=headers, json=payload)
            assert ok.status_code == 201, ok.text
            with factory.begin() as session:
                assert get_on_hand_stock(session, branch_id=branch_id, product_id=scoop_id) == 29
    finally:
        engine.dispose()
