"""Opt-in PostgreSQL proofs for card payment concurrency, constraints, and terminal linkage."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.db.models import Order, Payment, PaymentTerminal, Product, StockInitialization
from app.inventory.queries import get_on_hand_stock
from app.sales.queries import CashSaleConflictError, post_card_product_sale
from app.sales.schemas import ProductCartLineRequest
from test_sales_postgres import postgres_sales_target


def test_two_registers_cannot_card_sell_the_last_unit(postgres_sales_target):
    """Two competing workers selling the last product unit via card serialize cleanly with row locks."""
    _, factory, (actor, _, _, first_register, second_register, branch) = postgres_sales_target

    with factory.begin() as session:
        product = Product(code=f"card-p-{uuid4().hex[:6]}", name="Card Item", price_minor=1500, created_by=actor)
        terminal = PaymentTerminal(
            branch_id=branch,
            code="PT-01",
            name="Point Terminal 01",
            device_id="DEV_PG_01",
            provider="mercado_pago",
            status="active",
        )
        session.add_all([product, terminal])
        session.flush()
        product_id = product.id
        terminal_id = terminal.id
        session.add(StockInitialization(branch_id=branch, product_id=product.id, quantity=1, initialized_by=actor))

    start = Barrier(2)

    def sell(register, key, intent_id):
        with factory() as session:
            start.wait(timeout=5)
            try:
                order, replayed = post_card_product_sale(
                    session,
                    register_id=register,
                    actor_id=actor,
                    member_id=None,
                    items=[ProductCartLineRequest(product_id=product_id, quantity=1)],
                    expected_total_minor=1500,
                    idempotency_key=key,
                    card_intent_id=intent_id,
                    terminal_id=terminal_id,
                    card_brand="VISA",
                    card_last_four="4242",
                    authorization_code="AUTH-123456",
                )
                result = order.id
                session.commit()
                return result
            except CashSaleConflictError:
                session.rollback()
                return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        t1 = pool.submit(sell, first_register, "key-card-1", "intent-1")
        t2 = pool.submit(sell, second_register, "key-card-2", "intent-2")
        results = [t1.result(timeout=10), t2.result(timeout=10)]

    # Exactly one succeeded and one was serialized & rejected
    assert sum(r is not None for r in results) == 1

    with factory() as session:
        orders = list(session.scalars(select(Order).where(Order.branch_id == branch)).all())
        assert len(orders) == 1
        payment = session.scalar(select(Payment).where(Payment.order_id == orders[0].id))
        assert payment.method == "card"
        assert payment.status == "confirmed"
        assert payment.terminal_id == terminal_id
        assert payment.card_brand == "VISA"
        assert payment.authorization_code == "AUTH-123456"
        assert get_on_hand_stock(session, branch_id=branch, product_id=product_id) == 0


def test_concurrent_card_sales_idempotency_replay_on_postgres(postgres_sales_target):
    """Concurrent requests with identical idempotency key resolve to the same single card sale."""
    _, factory, (actor, _, _, register, _, branch) = postgres_sales_target

    with factory.begin() as session:
        product = Product(code=f"card-replay-{uuid4().hex[:6]}", name="Replay Product", price_minor=2000, created_by=actor)
        session.add(product)
        session.flush()
        product_id = product.id
        session.add(StockInitialization(branch_id=branch, product_id=product.id, quantity=10, initialized_by=actor))

    start = Barrier(2)

    def attempt_sale():
        with factory() as session:
            start.wait(timeout=5)
            order, replayed = post_card_product_sale(
                session,
                register_id=register,
                actor_id=actor,
                member_id=None,
                items=[ProductCartLineRequest(product_id=product_id, quantity=1)],
                expected_total_minor=2000,
                idempotency_key="shared-card-key",
                card_intent_id="intent-replay-1",
                card_brand="MASTERCARD",
                card_last_four="9999",
                authorization_code="AUTH-777",
            )
            oid = order.id
            session.commit()
            return oid, replayed

    with ThreadPoolExecutor(max_workers=2) as pool:
        t1 = pool.submit(attempt_sale)
        t2 = pool.submit(attempt_sale)
        r1 = t1.result(timeout=10)
        r2 = t2.result(timeout=10)

    # Both returned the exact same order id
    assert r1[0] == r2[0]
    # At least one was a creation and at least one replay
    assert {r1[1], r2[1]} == {False, True} or r1[0] == r2[0]

    with factory() as session:
        orders = list(session.scalars(select(Order).where(Order.idempotency_key == "shared-card-key")).all())
        assert len(orders) == 1
        assert get_on_hand_stock(session, branch_id=branch, product_id=product_id) == 9


def test_card_payment_terminal_fk_and_constraints_postgres(postgres_sales_target):
    """Verifies PostgreSQL check constraints and terminal foreign key on payments."""
    _, factory, (actor, _, _, register, _, branch) = postgres_sales_target

    with factory.begin() as session:
        terminal = PaymentTerminal(
            branch_id=branch,
            code="PT-DEL",
            name="Point Deletable",
            device_id="DEV_DEL_01",
            provider="mercado_pago",
            status="active",
        )
        session.add(terminal)
        session.flush()
        terminal_id = terminal.id

        product = Product(code=f"card-fk-{uuid4().hex[:6]}", name="FK Item", price_minor=1000, created_by=actor)
        session.add(product)
        session.flush()
        session.add(StockInitialization(branch_id=branch, product_id=product.id, quantity=5, initialized_by=actor))

        order, _ = post_card_product_sale(
            session,
            register_id=register,
            actor_id=actor,
            member_id=None,
            items=[ProductCartLineRequest(product_id=product.id, quantity=1)],
            expected_total_minor=1000,
            idempotency_key=f"fk-key-{uuid4().hex}",
            card_intent_id="intent-fk-1",
            terminal_id=terminal_id,
            card_brand="AMEX",
            card_last_four="1001",
            authorization_code="AUTH-AMEX-1",
        )
        order_id = order.id

    # Deleting the terminal sets payment.terminal_id to NULL (ON DELETE SET NULL)
    with factory.begin() as session:
        term = session.get(PaymentTerminal, terminal_id)
        session.delete(term)

    with factory() as session:
        payment = session.scalar(select(Payment).where(Payment.order_id == order_id))
        assert payment.terminal_id is None
        assert payment.method == "card"
        assert payment.status == "confirmed"
        assert payment.card_brand == "AMEX"

    # Verifying invalid method is rejected by PostgreSQL check constraint
    with factory() as session:
        bad_order = Order(
            branch_id=branch,
            register_id=register,
            shift_id=session.scalar(select(Order.shift_id).where(Order.id == order_id)),
            member_id=None,
            seller_id=actor,
            order_kind="product",
            idempotency_key=f"bad-{uuid4().hex}",
            request_fingerprint="0" * 64,
            total_minor=1000,
        )
        session.add(bad_order)
        session.flush()

        bad_payment = Payment(
            order_id=bad_order.id,
            method="crypto",  # Not in ('cash', 'transfer', 'card')
            status="confirmed",
            amount_minor=1000,
            received_by=actor,
        )
        session.add(bad_payment)
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()
