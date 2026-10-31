"""Opt-in PostgreSQL proofs for product return concurrency and serialization."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.db.models import Order, OrderItem, Payment, Product, ProductRefund, StockInitialization, StockMovement
from app.inventory.queries import get_on_hand_stock
from app.sales.queries import (
    ProductReturnConflictError,
    post_cash_product_sale,
    post_product_return,
)
from app.sales.schemas import ProductCartLineRequest
from test_sales_postgres import postgres_sales_target


def test_concurrent_refunds_on_same_item_serialize(postgres_sales_target):
    """Two competing workers attempting to refund the same line item cannot double-refund."""
    _, factory, (actor, member_id, _, register_id, _, branch_id) = postgres_sales_target

    with factory.begin() as session:
        product = Product(code=f"ret-{uuid4().hex[:6]}", name="Return Item", price_minor=1500, created_by=actor)
        session.add(product)
        session.flush()
        product_id = product.id
        session.add(StockInitialization(branch_id=branch_id, product_id=product_id, quantity=5, initialized_by=actor))

    # Make a product sale
    with factory() as session:
        order, _ = post_cash_product_sale(
            session,
            register_id=register_id,
            actor_id=actor,
            member_id=member_id,
            items=[ProductCartLineRequest(product_id=product_id, quantity=2)],
            expected_total_minor=3000,
            idempotency_key="sale-pg-1",
        )
        session.commit()
        order_item_id = order.items[0].id

    start = Barrier(2)

    def attempt_refund(key: str):
        with factory() as session:
            start.wait(timeout=5)
            try:
                refund, _ = post_product_return(
                    session,
                    register_id=register_id,
                    actor_id=actor,
                    order_item_id=order_item_id,
                    reason=f"Return from worker {key}",
                    disposition="restock",
                    payout_method="cash",
                    idempotency_key=key,
                )
                session.commit()
                return refund.id
            except ProductReturnConflictError:
                session.rollback()
                return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(attempt_refund, "worker-1")
        f2 = pool.submit(attempt_refund, "worker-2")
        results = [f1.result(timeout=10), f2.result(timeout=10)]

    # Exactly one succeeded
    assert sum(r is not None for r in results) == 1

    with factory() as session:
        # Exactly one refund record
        refund_count = session.scalar(select(func.count()).select_from(ProductRefund))
        assert refund_count == 1
        # Stock restored only once (5 - 2 + 2 = 5)
        assert get_on_hand_stock(session, branch_id=branch_id, product_id=product_id) == 5
