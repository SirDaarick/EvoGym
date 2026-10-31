"""Opt-in row-lock proof on the existing disposable PostgreSQL test fixture."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
import time

from sqlalchemy import func, select

from app.db.models import Order, Product, StockInitialization
from app.inventory.queries import (InsufficientStockError, capture_register_inventory_snapshot,
                                   get_on_hand_stock, record_stock_movement, validate_opening_inventory_snapshot)
from app.sales.queries import CashSaleConflictError, post_cash_product_sale
from app.sales.schemas import ProductCartLineRequest
from test_sales_postgres import postgres_sales_target


def test_two_registers_cannot_sell_the_last_unit(postgres_sales_target):
    _, factory, (actor, _, _, first_register, second_register, branch) = postgres_sales_target
    with factory.begin() as session:
        product = Product(code='last-unit', name='Last Unit', price_minor=100, created_by=actor)
        session.add(product)
        session.flush()
        product_id = product.id
        session.add(StockInitialization(branch_id=branch, product_id=product.id, quantity=1, initialized_by=actor))
    start = Barrier(2)

    def sell(register, key):
        with factory() as session:
            start.wait(timeout=5)
            try:
                order, _ = post_cash_product_sale(
                    session, register_id=register, actor_id=actor, member_id=None,
                    items=[ProductCartLineRequest(product_id=product_id, quantity=1)],
                    expected_total_minor=100, idempotency_key=key,
                )
                result = order.id
                session.commit()
                return result
            except CashSaleConflictError:
                session.rollback()
                return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(sell, first_register, 'first')
        second = pool.submit(sell, second_register, 'second')
        results = [first.result(timeout=10), second.result(timeout=10)]
    assert sum(result is not None for result in results) == 1
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(Order)) == 1
        assert get_on_hand_stock(session, branch_id=branch, product_id=product_id) == 0


def test_sale_and_waste_cannot_consume_the_same_unit(postgres_sales_target):
    _, factory, (actor, _, _, register, _, branch) = postgres_sales_target
    with factory.begin() as session:
        product = Product(code='sale-waste', name='Sale Waste', price_minor=100, created_by=actor)
        session.add(product)
        session.flush()
        product_id = product.id
        session.add(StockInitialization(branch_id=branch, product_id=product.id, quantity=1, initialized_by=actor))
    start = Barrier(2)

    def compete(kind):
        with factory() as session:
            start.wait(timeout=5)
            try:
                if kind == 'sale':
                    post_cash_product_sale(session, register_id=register, actor_id=actor, member_id=None,
                                           items=[ProductCartLineRequest(product_id=product_id, quantity=1)],
                                           expected_total_minor=100, idempotency_key='sale')
                else:
                    record_stock_movement(session, branch_id=branch, product_id=product_id, kind='waste',
                                          quantity=1, actor_id=actor, idempotency_key='waste', reason='Damaged')
                session.commit()
                return True
            except (CashSaleConflictError, InsufficientStockError):
                session.rollback()
                return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        sale = pool.submit(compete, 'sale')
        waste = pool.submit(compete, 'waste')
        assert sum((sale.result(timeout=10), waste.result(timeout=10))) == 1
    with factory() as session:
        assert get_on_hand_stock(session, branch_id=branch, product_id=product_id) == 0


def test_snapshot_validation_serializes_stock_movement(postgres_sales_target):
    _, factory, (actor, _, _, register, _, branch) = postgres_sales_target
    with factory.begin() as session:
        product = Product(code='snapshot-race', name='Snapshot Race', price_minor=100, created_by=actor)
        session.add(product)
        session.flush()
        product_id = product.id
        session.add(StockInitialization(branch_id=branch, product_id=product_id, quantity=2, initialized_by=actor))
        session.flush()
        snapshot = capture_register_inventory_snapshot(session, register_id=register, actor_id=actor)
        snapshot_id = snapshot.id
    validation = factory()
    executor = ThreadPoolExecutor(max_workers=1)
    try:
        _, items = validate_opening_inventory_snapshot(validation, register_id=register,
                                                      branch_id=branch, snapshot_id=snapshot_id)
        assert items[product_id].expected_quantity == 2
        started = Event()

        def waste():
            with factory() as session:
                started.set()
                record_stock_movement(session, branch_id=branch, product_id=product_id, kind='waste',
                                      quantity=1, actor_id=actor, idempotency_key='after-snapshot', reason='Damaged')
                session.commit()

        future = executor.submit(waste)
        assert started.wait(2)
        time.sleep(0.2)
        assert not future.done()
        validation.commit()
        future.result(timeout=5)
        with factory() as session:
            assert get_on_hand_stock(session, branch_id=branch, product_id=product_id) == 1
    finally:
        validation.rollback()
        validation.close()
        executor.shutdown(wait=True)


def test_product_sale_and_shift_close_serialize(postgres_sales_target):
    from app.db.models import Shift
    from app.shifts.queries import close_shift

    _, factory, (actor, _, _, register, _, branch) = postgres_sales_target
    with factory.begin() as session:
        product = Product(code='shift-race', name='Shift race', price_minor=100, created_by=actor)
        session.add(product)
        session.flush()
        product_id = product.id
        session.add(StockInitialization(branch_id=branch, product_id=product_id, quantity=1, initialized_by=actor))
        shift_id = session.scalar(select(Shift.id).where(Shift.cash_register_id == register, Shift.status == 'open'))
    start = Barrier(2)
    def sell():
        with factory.begin() as session:
            start.wait(timeout=5)
            order, _ = post_cash_product_sale(session, register_id=register, actor_id=actor, member_id=None,
                items=[ProductCartLineRequest(product_id=product_id, quantity=1)], expected_total_minor=100,
                idempotency_key='shift-race')
            return order.id
    def close():
        with factory.begin() as session:
            start.wait(timeout=5)
            close_shift(session, shift_id=shift_id, closed_by=actor, denomination_counts=None, counted_cash_minor=0)
    with ThreadPoolExecutor(max_workers=2) as pool:
        sale, cut = pool.submit(sell), pool.submit(close)
        order_id = sale.result(timeout=10)
        cut.result(timeout=10)
    with factory() as session:
        order, shift = session.get(Order, order_id), session.get(Shift, shift_id)
        assert order.shift_id == shift.id
        if order.is_overtime:
            assert order.financial_shift_id is None and shift.expected_cash_at_close_minor == shift.opening_cash_minor
        else:
            assert order.financial_shift_id == shift.id and shift.expected_cash_at_close_minor == shift.opening_cash_minor + 100


def test_shift_close_can_commit_while_sale_waits_for_register(postgres_sales_target):
    from sqlalchemy import event
    from app.db.models import CashRegister, Shift
    from app.shifts.queries import close_shift

    _, factory, (actor, _, _, register, _, branch) = postgres_sales_target
    with factory.begin() as session:
        product = Product(code='lock-order', name='Lock order', price_minor=100, created_by=actor)
        session.add(product)
        session.flush()
        product_id = product.id
        session.add(StockInitialization(branch_id=branch, product_id=product_id, quantity=1, initialized_by=actor))
        shift_id = session.scalar(select(Shift.id).where(Shift.cash_register_id == register, Shift.status == 'open'))

    seller_locked, continue_sale = Event(), Event()
    def sell():
        with factory.begin() as session:
            connection = session.connection()
            def pause_after_seller(*_args):
                seller_locked.set()
                assert continue_sale.wait(timeout=5)
            event.listen(connection, 'after_cursor_execute', pause_after_seller, once=True)
            return post_cash_product_sale(session, register_id=register, actor_id=actor, member_id=None,
                items=[ProductCartLineRequest(product_id=product_id, quantity=1)], expected_total_minor=100,
                idempotency_key='lock-order')[0].id

    with ThreadPoolExecutor(max_workers=1) as pool:
        with factory.begin() as closing:
            closing.scalar(select(CashRegister).where(CashRegister.id == register).with_for_update())
            sale = pool.submit(sell)
            assert seller_locked.wait(timeout=5)
            continue_sale.set()
            close_shift(closing, shift_id=shift_id, closed_by=actor, denomination_counts=None, counted_cash_minor=0)
        order_id = sale.result(timeout=10)
    with factory() as session:
        order = session.get(Order, order_id)
        assert order.shift_id == shift_id and order.is_overtime and order.financial_shift_id is None


def test_resolution_and_late_product_sale_are_serialized(postgres_sales_target):
    from app.sales.queries import resolve_product_sale
    _, factory, (actor, _, _, register, _, branch) = postgres_sales_target
    with factory.begin() as session:
        product = Product(code='resolve-race', name='Resolve Race', price_minor=100, created_by=actor)
        session.add(product)
        session.flush()
        product_id = product.id
        session.add(StockInitialization(branch_id=branch, product_id=product_id, quantity=1, initialized_by=actor))
    args = dict(register_id=register, actor_id=actor, member_id=None,
                items=[ProductCartLineRequest(product_id=product_id, quantity=1)],
                expected_total_minor=100, idempotency_key='resolve-race')
    first = factory()
    executor = ThreadPoolExecutor(max_workers=1)
    try:
        assert resolve_product_sale(first, **args) is None
        started = Event()
        def late_sale():
            with factory.begin() as session:
                started.set()
                try:
                    post_cash_product_sale(session, **args)
                except CashSaleConflictError:
                    return 'cancelled'
                return 'sold'
        future = executor.submit(late_sale)
        assert started.wait(timeout=5)
        time.sleep(0.2)
        assert not future.done()
        first.commit()
        assert future.result(timeout=5) == 'cancelled'
        with factory() as session:
            assert session.scalar(select(func.count()).select_from(Order)) == 0
            assert get_on_hand_stock(session, branch_id=branch, product_id=product_id) == 1
    finally:
        first.close()
        executor.shutdown(wait=True)


def test_competing_product_intent_preparations_serialize(postgres_sales_target):
    from app.sales.queries import prepare_product_sale
    _, factory, (actor, _, _, register, _, branch) = postgres_sales_target
    args = dict(actor_id=actor, register_id=register, member_id=None,
                items=[ProductCartLineRequest(product_id=register, quantity=1)], expected_total_minor=100)
    first = factory()
    executor = ThreadPoolExecutor(max_workers=1)
    try:
        prepare_product_sale(first, idempotency_key='first', **args)
        started = Event()
        def competing():
            with factory() as session:
                started.set()
                try:
                    prepare_product_sale(session, idempotency_key='second', **args)
                    session.commit()
                    return 'prepared'
                except CashSaleConflictError:
                    session.rollback()
                    return 'blocked'
        future = executor.submit(competing)
        assert started.wait(timeout=5)
        time.sleep(0.2)
        assert not future.done()
        first.commit()
        assert future.result(timeout=5) == 'blocked'
    finally:
        first.close()
        executor.shutdown(wait=True)


def test_preparation_cannot_start_after_staff_deactivation(postgres_sales_target):
    from app.db.models import StaffUser, ProductSaleIntent
    from app.sales.queries import prepare_product_sale
    from uuid import uuid4
    _, factory, (actor, _, _, register, _, _) = postgres_sales_target
    lock_session = factory()
    executor = ThreadPoolExecutor(max_workers=1)
    try:
        seller = lock_session.scalar(select(StaffUser).where(StaffUser.id == actor).with_for_update())
        assert lock_session.get(ProductSaleIntent, actor) is None
        seller.is_active = False
        started = Event()
        def prepare():
            with factory() as session:
                started.set()
                try:
                    prepare_product_sale(session, register_id=register, actor_id=actor, member_id=None,
                        items=[ProductCartLineRequest(product_id=uuid4(), quantity=1)],
                        expected_total_minor=100, idempotency_key='deactivation-race')
                    session.commit()
                    return 'prepared'
                except CashSaleConflictError:
                    session.rollback()
                    return 'rejected'
        future = executor.submit(prepare)
        assert started.wait(5)
        lock_session.commit()
        assert future.result(timeout=10) == 'rejected'
        with factory() as session:
            assert session.get(ProductSaleIntent, actor) is None
    finally:
        lock_session.close()
        executor.shutdown(wait=True)
