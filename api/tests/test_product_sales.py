from fastapi.testclient import TestClient
from uuid import UUID
import pytest
from sqlalchemy import event, func, null, select
from sqlalchemy.exc import IntegrityError

from app.db.models import Order, OrderItem, Payment, Product, StockInitialization, StockMovement
from app.inventory.queries import get_on_hand_stock
from app.main import create_app
from app.shifts.queries import create_cash_register
from test_admin_auth import configured_settings
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def test_cash_product_cart_is_atomic_and_replayable(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, 'products', 'Products')
            shift = open_shift(session, register_id=register.id, opened_by=staff_id,
                               denomination_counts=[{'denomination_minor': 100, 'quantity': 0}])
            shift_id = shift.id
            products = [Product(code='water', name='Water', price_minor=1200, created_by=staff_id),
                        Product(code='bar', name='Bar', price_minor=800, created_by=staff_id)]
            session.add_all(products)
            session.flush()
            for product in products:
                session.add(StockInitialization(branch_id=branch_id, product_id=product.id,
                                                quantity=5, initialized_by=staff_id))
            register_id = register.id
            ids = [str(product.id) for product in products]
        payload = {'items': [{'product_id': ids[0], 'quantity': 2},
                             {'product_id': ids[1], 'quantity': 1}], 'expected_total_minor': 3200}
        headers = {'Authorization': f'Bearer {token}', 'Idempotency-Key': 'cart-1'}
        with TestClient(create_app(configured_settings(url))) as client:
            path = f'/api/v1/registers/{register_id}/product-sales'
            assert client.post(path, json=payload, headers={'Idempotency-Key': 'anonymous'}).status_code == 401
            assert client.post(f'/api/v1/registers/{register_id}/product-sale-intent', headers=headers, json=payload).status_code == 200
            result = client.post(path, headers=headers, json=payload)
            assert result.status_code == 201, result.text
            replay = client.post(path, headers=headers, json=payload)
            assert replay.status_code == 200 and replay.json() == result.json()
            assert result.json()['order']['total_minor'] == 3200
            reversed_replay = client.post(path, headers=headers, json={**payload, 'items': list(reversed(payload['items']))})
            assert reversed_replay.status_code == 200 and reversed_replay.json() == result.json()
            mismatch = client.post(path, headers=headers, json={**payload, 'expected_total_minor': 1})
            assert mismatch.status_code == 409
            assert mismatch.json()['error']['code'] == 'idempotency_conflict'
            assert client.post(path + '/resolve', headers=headers, json=payload).status_code == 200
            stale_payload = {**payload, 'expected_total_minor': 1}
            stale_headers = {**headers, 'Idempotency-Key': 'stale'}
            assert client.post(f'/api/v1/registers/{register_id}/product-sale-intent', headers=stale_headers, json=stale_payload).status_code == 200
            stale = client.post(path, headers=stale_headers,
                                json={**payload, 'expected_total_minor': 1})
            assert stale.status_code == 409
            assert stale.json()['error']['code'] == 'product_sale_rejected'
            assert client.post(path + '/resolve', headers=stale_headers, json=stale_payload).status_code == 200
            duplicate_payload = {**payload, 'items': [payload['items'][0]] * 2}
            duplicate_headers = {**headers, 'Idempotency-Key': 'duplicate'}
            assert client.post(f'/api/v1/registers/{register_id}/product-sale-intent', headers=duplicate_headers, json=duplicate_payload).status_code == 200
            duplicate_product = client.post(path, headers=duplicate_headers,
                                            json={**payload, 'items': [payload['items'][0]] * 2})
            assert duplicate_product.status_code == 409
            assert client.post(path + '/resolve', headers=duplicate_headers, json=duplicate_payload).status_code == 200
            failed_payload = {**payload, 'items': [payload['items'][0], {'product_id': ids[1], 'quantity': 99}]}
            failed_headers = {**headers, 'Idempotency-Key': 'cart-2'}
            assert client.post(f'/api/v1/registers/{register_id}/product-sale-intent', headers=failed_headers, json=failed_payload).status_code == 200
            failed = client.post(path, headers=failed_headers,
                                 json={**payload, 'items': [payload['items'][0],
                                        {'product_id': ids[1], 'quantity': 99}]})
            assert failed.status_code == 409
            assert client.post(path + '/resolve', headers=failed_headers, json=failed_payload).status_code == 200
            stock = client.get(f'/api/v1/inventory/branches/{branch_id}/stock', headers=headers)
            assert stock.status_code == 200
            quantities = {row['product_id']: row['quantity'] for row in stock.json()['items']}
            assert quantities[ids[0]] == 3 and quantities[ids[1]] == 4
            summary = client.get(f'/api/v1/shifts/{shift_id}/summary', headers=headers)
            assert summary.status_code == 200
            assert summary.json()['confirmed_cash_minor'] == 3200
            assert summary.json()['activities'] == [{'family': 'product', 'count': 1, 'amount_minor': 3200}]
            with factory.begin() as session:
                session.get(Product, UUID(ids[0])).is_active = False
            inactive_headers = {**headers, 'Idempotency-Key': 'inactive'}
            assert client.post(f'/api/v1/registers/{register_id}/product-sale-intent', headers=inactive_headers, json=payload).status_code == 200
            inactive = client.post(path, headers={**headers, 'Idempotency-Key': 'inactive'}, json=payload)
            assert inactive.status_code == 404
        with factory() as session:
            assert session.scalar(select(func.count()).select_from(Order)) == 1
            assert session.scalar(select(func.count()).select_from(OrderItem)) == 2
            assert session.scalar(select(func.count()).select_from(Payment)) == 1
            assert get_on_hand_stock(session, branch_id=branch_id, product_id=UUID(ids[0])) == 3
            assert get_on_hand_stock(session, branch_id=branch_id, product_id=UUID(ids[1])) == 4
    finally:
        engine.dispose()


def test_product_sale_rejects_read_only_staff(tmp_path):
    from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
    from app.db.models import RoleGrant

    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, _ = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            grant = session.scalar(select(RoleGrant).where(RoleGrant.staff_id == staff_id))
            grant.is_active = False
            register = create_cash_register(session, branch_id, 'denied', 'Denied')
            register_id = register.id
        app = create_app(configured_settings(url))
        app.dependency_overrides[get_shift_actor_principal] = lambda: ShiftActorPrincipal(staff_id, False, branch_id)
        with TestClient(app) as client:
            response = client.post(f'/api/v1/registers/{register_id}/product-sales',
                                   headers={'Idempotency-Key': 'denied'},
                                   json={'items': [{'product_id': str(UUID(int=1)), 'quantity': 1}],
                                         'expected_total_minor': 0})
            assert response.status_code == 403
        with factory() as session:
            assert session.scalar(select(func.count()).select_from(Order)) == 0
    finally:
        engine.dispose()


def test_product_sale_requires_open_shift_and_initialized_stock(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, 'preconditions', 'Preconditions')
            product = Product(code='uninitialized', name='Uninitialized', price_minor=100, created_by=staff_id)
            session.add(product)
            session.flush()
            register_id, product_id = register.id, product.id
        headers = {'Authorization': f'Bearer {token}', 'Idempotency-Key': 'preconditions'}
        payload = {'items': [{'product_id': str(product_id), 'quantity': 1}], 'expected_total_minor': 100}
        with TestClient(create_app(configured_settings(url))) as client:
            path = f'/api/v1/registers/{register_id}/product-sales'
            assert client.post(path, headers=headers, json=payload).status_code == 409
            with factory.begin() as session:
                open_shift(session, register_id=register_id, opened_by=staff_id,
                           denomination_counts=[{'denomination_minor': 100, 'quantity': 0}])
            assert client.post(path, headers=headers, json=payload).status_code == 409
            assert client.post(path, headers=headers,
                               json={'items': [{'product_id': str(product_id), 'quantity': True}],
                                     'expected_total_minor': 100}).status_code == 422
        with factory() as session:
            assert session.scalar(select(func.count()).select_from(Order)) == 0
    finally:
        engine.dispose()


def test_product_sale_rolls_back_after_later_line_failure(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, 'rollback', 'Rollback')
            open_shift(session, register_id=register.id, opened_by=staff_id,
                       denomination_counts=[{'denomination_minor': 100, 'quantity': 0}])
            products = [Product(code='first', name='First', price_minor=100, created_by=staff_id),
                        Product(code='second', name='Second', price_minor=100, created_by=staff_id)]
            session.add_all(products)
            session.flush()
            for product in products:
                session.add(StockInitialization(branch_id=branch_id, product_id=product.id,
                                                quantity=2, initialized_by=staff_id))
            register_id = register.id
            ids = [product.id for product in products]

        def fail_second_line(mapper, connection, target):
            if target.item_kind == 'product' and target.line_number == 2:
                raise RuntimeError('injected second line failure')

        event.listen(OrderItem, 'before_insert', fail_second_line)
        try:
            with TestClient(create_app(configured_settings(url)), raise_server_exceptions=False) as client:
                payload = {'items': [{'product_id': str(i), 'quantity': 1} for i in ids], 'expected_total_minor': 200}
                headers = {'Authorization': f'Bearer {token}', 'Idempotency-Key': 'rollback'}
                assert client.post(f'/api/v1/registers/{register_id}/product-sale-intent', headers=headers, json=payload).status_code == 200
                response = client.post(f'/api/v1/registers/{register_id}/product-sales', headers=headers, json=payload)
                assert response.status_code == 500
        finally:
            event.remove(OrderItem, 'before_insert', fail_second_line)
        with factory() as session:
            for model in (Order, OrderItem, Payment, StockMovement):
                assert session.scalar(select(func.count()).select_from(model)) == 0
            assert all(get_on_hand_stock(session, branch_id=branch_id, product_id=i) == 2 for i in ids)
    finally:
        engine.dispose()


def test_metadata_preserves_legacy_membership_amounts_but_rejects_wrong_product_totals(tmp_path):
    _, engine, factory = _setup_db(tmp_path)
    try:
        with factory.begin() as session:
            session.add(OrderItem(order_id=UUID(int=1), plan_version_id=UUID(int=2),
                                  description_snapshot='Legacy', item_kind='membership',
                                  entitlement_mode='period', duration_value=1, duration_unit='month',
                                  quantity=1, unit_amount_minor=100, line_total_minor=90))
        with factory() as session, pytest.raises(IntegrityError):
            session.add(OrderItem(order_id=UUID(int=3), product_id=UUID(int=4),
                                  description_snapshot='Product', item_kind='product', entitlement_mode=null(),
                                  quantity=2, unit_amount_minor=100, line_total_minor=90))
            session.flush()
    finally:
        engine.dispose()


def test_direct_cash_sale_rejection_has_distinct_safe_error_code(tmp_path):
    from types import SimpleNamespace
    from fastapi import Response
    from app.api.sales import post_cash_product_sale_endpoint
    from app.errors import AppError
    from app.api.shifts import ShiftActorPrincipal
    from app.sales.schemas import CashProductSaleRequest

    _, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        with factory.begin() as session:
            register = create_cash_register(session, branch, 'direct', 'Direct')
            open_shift(session, register_id=register.id, opened_by=actor,
                       denomination_counts=[{'denomination_minor': 100, 'quantity': 0}])
            product = Product(code='direct', name='Direct', price_minor=100, created_by=actor)
            session.add(product)
            session.flush()
            session.add(StockInitialization(branch_id=branch, product_id=product.id, quantity=2, initialized_by=actor))
            register_id, product_id = register.id, product.id
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(session_factory=factory)))
        principal = ShiftActorPrincipal(actor, False, branch)
        payload = CashProductSaleRequest(items=[{'product_id': product_id, 'quantity': 1}], expected_total_minor=1)
        with pytest.raises(AppError) as rejected:
            post_cash_product_sale_endpoint(register_id, payload, Response(), 'stale', principal, factory=factory)
        assert (rejected.value.status, rejected.value.code) == (409, 'product_sale_rejected')
        with factory() as session:
            assert session.scalar(select(func.count()).select_from(Order)) == 0
    finally:
        engine.dispose()


def test_product_sale_between_shifts_is_overtime_and_next_opening_does_not_double_count(tmp_path):
    from app.sales.queries import post_cash_product_sale, CashSaleConflictError
    from app.sales.schemas import ProductCartLineRequest
    from app.shifts.queries import close_shift, expected_cash_for_shift

    _, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        with factory.begin() as session:
            register = create_cash_register(session, branch, 'overtime', 'Overtime')
            product = Product(code='overtime-water', name='Water', price_minor=100, created_by=actor)
            session.add(product)
            session.flush()
            session.add(StockInitialization(branch_id=branch, product_id=product.id, quantity=3, initialized_by=actor))
            register_id, product_id = register.id, product.id
        def sale(session, key):
            return post_cash_product_sale(session, register_id=register_id, actor_id=actor, member_id=None,
                items=[ProductCartLineRequest(product_id=product_id, quantity=1)], expected_total_minor=100, idempotency_key=key)[0]
        with factory.begin() as session:
            with pytest.raises(CashSaleConflictError, match='first shift'):
                sale(session, 'before-first')
            first = open_shift(session, register_id=register_id, opened_by=actor,
                denomination_counts=[{'denomination_minor': 100, 'quantity': 0}])
            first_id = first.id
            normal = sale(session, 'normal')
            assert normal.shift_id == first_id and normal.financial_shift_id == first_id and not normal.is_overtime
            close_shift(session, shift_id=first_id, closed_by=actor, denomination_counts=None, counted_cash_minor=100)
            overtime = sale(session, 'overtime')
            overtime_id = overtime.id
            assert overtime.shift_id == first_id and overtime.financial_shift_id is None and overtime.is_overtime
        with factory.begin() as session:
            next_shift = open_shift(session, register_id=register_id, opened_by=actor,
                denomination_counts=[{'denomination_minor': 100, 'quantity': 2}])
            overtime = session.get(Order, overtime_id)
            session.refresh(overtime)
            assert overtime.financial_shift_id == next_shift.id and overtime.cash_included_in_opening
            assert expected_cash_for_shift(session, next_shift) == 200
            assert sale(session, 'overtime').id == overtime_id
    finally:
        engine.dispose()


def test_reconcile_product_sale_cancels_uncommitted_intent_and_preserves_committed(tmp_path):
    from app.sales.queries import CashSaleConflictError, post_cash_product_sale, resolve_product_sale
    from app.sales.schemas import ProductCartLineRequest
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        with factory.begin() as session:
            register = create_cash_register(session, branch, 'resolution', 'Resolution')
            open_shift(session, register_id=register.id, opened_by=actor,
                       denomination_counts=[{'denomination_minor': 100, 'quantity': 0}])
            product = Product(code='resolve-water', name='Water', price_minor=100, created_by=actor)
            session.add(product)
            session.flush()
            session.add(StockInitialization(branch_id=branch, product_id=product.id, quantity=2, initialized_by=actor))
            register_id, product_id = register.id, product.id
        args = dict(register_id=register_id, actor_id=actor, member_id=None,
                    items=[ProductCartLineRequest(product_id=product_id, quantity=1)], expected_total_minor=100)
        with factory.begin() as session:
            assert resolve_product_sale(session, idempotency_key='cancelled', **args) is None
        with factory.begin() as session:
            assert resolve_product_sale(session, idempotency_key='cancelled', **args) is None
        with factory.begin() as session:
            with pytest.raises(CashSaleConflictError):
                post_cash_product_sale(session, idempotency_key='cancelled', **args)
        with factory.begin() as session:
            order, _ = post_cash_product_sale(session, idempotency_key='committed', **args)
            order_id = order.id
        with factory.begin() as session:
            assert resolve_product_sale(session, idempotency_key='committed', **args).id == order_id
            assert session.scalar(select(func.count()).select_from(Order)) == 1
    finally:
        engine.dispose()


def test_resolution_endpoint_rejects_mismatch_and_commits_cancellation(tmp_path):
    from types import SimpleNamespace
    from app.api.sales import resolve_product_sale_endpoint
    from app.sales.schemas import CashProductSaleRequest
    from app.errors import AppError
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        with factory.begin() as session:
            register = create_cash_register(session, branch, 'resolve-http', 'Resolve HTTP')
            register_id = register.id
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(session_factory=factory)))
        principal = SimpleNamespace(is_admin=True, staff_id=actor, branch_id=branch)
        payload = CashProductSaleRequest.model_validate({'items': [{'product_id': str(register_id), 'quantity': 1}], 'expected_total_minor': 100})
        assert resolve_product_sale_endpoint(register_id, payload, 'endpoint', principal, factory=factory) == {'status': 'cancelled'}
        assert resolve_product_sale_endpoint(register_id, payload, 'endpoint', principal, factory=factory) == {'status': 'cancelled'}
        with pytest.raises(AppError) as exc:
            resolve_product_sale_endpoint(register_id, payload.model_copy(update={'expected_total_minor': 200}), 'endpoint', principal, factory=factory)
        assert (exc.value.status, exc.value.code) == (409, 'http_error')
    finally:
        engine.dispose()


def test_active_product_intent_serializes_and_recovers(tmp_path):
    from app.sales.queries import prepare_product_sale, get_product_sale_intent, CashSaleConflictError
    from app.sales.schemas import ProductCartLineRequest
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        with factory.begin() as session:
            register = create_cash_register(session, branch, 'intent', 'Intent')
            register_id = register.id
        payload = dict(member_id=None, items=[ProductCartLineRequest(product_id=register_id, quantity=1)], expected_total_minor=100)
        with factory.begin() as session:
            prepare_product_sale(session, actor_id=actor, register_id=register_id, idempotency_key='one', **payload)
        with factory.begin() as session:
            saved = get_product_sale_intent(session, actor_id=actor)
            assert saved.idempotency_key == 'one' and saved.register_id == register_id
            with pytest.raises(CashSaleConflictError):
                prepare_product_sale(session, actor_id=actor, register_id=register_id, idempotency_key='two', **payload)
    finally:
        engine.dispose()


def test_product_sale_intent_endpoint_recovery_and_delayed_request(tmp_path):
    from types import SimpleNamespace
    from fastapi import Response
    from app.api.sales import prepare_product_sale_endpoint, get_product_sale_intent_endpoint, resolve_product_sale_endpoint, post_cash_product_sale_endpoint
    from app.errors import AppError
    from app.sales.schemas import CashProductSaleRequest
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch = _seed_branch(factory)
        actor, _ = _seed_receptionist(factory, branch)
        with factory.begin() as session:
            register = create_cash_register(session, branch, 'durable', 'Durable')
            register_id = register.id
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(session_factory=factory)))
        principal = SimpleNamespace(is_admin=True, staff_id=actor, branch_id=branch)
        payload = CashProductSaleRequest.model_validate({'items': [{'product_id': str(register_id), 'quantity': 1}], 'expected_total_minor': 100})
        assert prepare_product_sale_endpoint(register_id, payload, 'saved', principal, factory=factory)['key'] == 'saved'
        assert get_product_sale_intent_endpoint(principal, factory=factory)['key'] == 'saved'
        assert resolve_product_sale_endpoint(register_id, payload, 'saved', principal, factory=factory)['status'] == 'cancelled'
        assert get_product_sale_intent_endpoint(principal, factory=factory) is None
        with pytest.raises(AppError) as rejected:
            post_cash_product_sale_endpoint(register_id, payload, Response(), 'saved', principal, factory=factory)
        assert rejected.value.status == 409
    finally:
        engine.dispose()


def test_partial_cash_product_sale_creates_debt_repayment_and_shift_summary(tmp_path):
    from uuid import uuid4
    from app.db.models import Member, MembershipDebt
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, 'partial', 'Partial')
            shift = open_shift(session, register_id=register.id, opened_by=staff_id,
                               denomination_counts=[{'denomination_minor': 100, 'quantity': 0}])
            shift_id = shift.id
            member = Member(member_number=f'SOC-{uuid4().hex[:6]}', full_name='Partial Buyer', phone='5550001',
                            credit_balance_minor=500)
            products = [Product(code='water-p', name='Water', price_minor=1200, created_by=staff_id),
                        Product(code='bar-p', name='Bar', price_minor=800, created_by=staff_id)]
            session.add(member)
            session.add_all(products)
            session.flush()
            for product in products:
                session.add(StockInitialization(branch_id=branch_id, product_id=product.id,
                                                quantity=5, initialized_by=staff_id))
            register_id, member_id = register.id, member.id
            ids = [str(product.id) for product in products]

        headers = {'Authorization': f'Bearer {token}', 'Idempotency-Key': 'partial-1'}
        payload = {
            'member_id': str(member_id),
            'items': [{'product_id': ids[0], 'quantity': 2}, {'product_id': ids[1], 'quantity': 1}],
            'expected_total_minor': 3200,
            'cash_amount_minor': 1000,
        }
        with TestClient(create_app(configured_settings(url))) as client:
            assert client.post(f'/api/v1/registers/{register_id}/product-sale-intent', headers=headers, json=payload).status_code == 200
            sale_res = client.post(f'/api/v1/registers/{register_id}/product-sales', headers=headers, json=payload)
            assert sale_res.status_code == 201, sale_res.text
            order_id = sale_res.json()['order']['id']
            assert sale_res.json()['order']['total_minor'] == 3200
            assert sale_res.json()['payment']['amount_minor'] == 1000
            assert client.post(f'/api/v1/registers/{register_id}/product-sales/resolve', headers=headers, json=payload).status_code == 200

            debts = client.get(f'/api/v1/registers/{register_id}/members/{member_id}/debts',
                               headers={'Authorization': f'Bearer {token}'})
            assert debts.status_code == 200
            assert len(debts.json()) == 1
            assert debts.json()[0]['description_snapshot'] == 'Water x2, Bar'
            assert debts.json()[0]['initial_outstanding_minor'] == 2200
            assert debts.json()[0]['remaining_balance_minor'] == 2200

            purchases_before = client.get(f'/api/v1/members/{member_id}/purchases',
                                          headers={'Authorization': f'Bearer {token}'})
            assert purchases_before.status_code == 200
            assert purchases_before.json()['items'][0]['status'] == 'pending'

            summary_before = client.get(f'/api/v1/shifts/{shift_id}/summary', headers={'Authorization': f'Bearer {token}'})
            assert summary_before.status_code == 200
            assert summary_before.json()['confirmed_cash_minor'] == 1000
            assert summary_before.json()['activities'] == [{'family': 'product', 'count': 1, 'amount_minor': 1000}]

            repay1 = client.post(
                f'/api/v1/registers/{register_id}/membership-debt-payments',
                headers={'Authorization': f'Bearer {token}', 'Idempotency-Key': 'repay-p1'},
                json={'order_id': order_id, 'amount_minor': 1000, 'credit_minor': 500},
            )
            assert repay1.status_code == 201, repay1.text
            assert repay1.json()['remaining_balance_minor'] == 1200

            repay2 = client.post(
                f'/api/v1/registers/{register_id}/membership-debt-payments',
                headers={'Authorization': f'Bearer {token}', 'Idempotency-Key': 'repay-p2'},
                json={'order_id': order_id, 'amount_minor': 1200, 'credit_minor': 0},
            )
            assert repay2.status_code == 201, repay2.text
            assert repay2.json()['remaining_balance_minor'] == 0

            debts_after = client.get(f'/api/v1/registers/{register_id}/members/{member_id}/debts',
                                     headers={'Authorization': f'Bearer {token}'})
            assert debts_after.status_code == 200 and debts_after.json() == []

            summary_after = client.get(f'/api/v1/shifts/{shift_id}/summary', headers={'Authorization': f'Bearer {token}'})
            assert summary_after.status_code == 200
            body = summary_after.json()
            assert body['confirmed_cash_minor'] == 2700
            assert body['activities'] == [{'family': 'product', 'count': 4, 'amount_minor': 3200}]
            descriptions = [row['description'] for row in body['payments']]
            assert 'Abono de producto' in descriptions
            assert 'Abono de producto (saldo a favor)' in descriptions

            purchases_after = client.get(f'/api/v1/members/{member_id}/purchases',
                                         headers={'Authorization': f'Bearer {token}'})
            assert purchases_after.status_code == 200
            purchase_descriptions = [row['description'] for row in purchases_after.json()['items']]
            assert 'Product debt payment' in purchase_descriptions
            assert purchases_after.json()['items'][-1]['status'] == 'paid'

        with factory() as session:
            debt = session.scalar(select(MembershipDebt).where(MembershipDebt.order_id == UUID(order_id)))
            assert debt is not None and debt.initial_outstanding_minor == 2200
    finally:
        engine.dispose()


def test_zero_cash_credit_combo_overtime_and_cash_amount_validations(tmp_path):
    from uuid import uuid4
    from app.db.models import Member, MembershipDebt
    from app.sales.queries import SalePolicy, _post_cash_sale, ProductSaleRejected
    from app.sales.schemas import ProductCartLineRequest
    from app.shifts.queries import close_shift
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, 'combo', 'Combo')
            shift = open_shift(session, register_id=register.id, opened_by=staff_id,
                               denomination_counts=[{'denomination_minor': 100, 'quantity': 0}])
            shift_id = shift.id
            member = Member(member_number=f'SOC-{uuid4().hex[:6]}', full_name='Combo Buyer', phone='5550002',
                            credit_balance_minor=1000)
            product = Product(code='combo-water', name='Combo Water', price_minor=1200, created_by=staff_id)
            session.add_all([member, product])
            session.flush()
            session.add(StockInitialization(branch_id=branch_id, product_id=product.id,
                                            quantity=10, initialized_by=staff_id))
            register_id, member_id, product_id = register.id, member.id, str(product.id)

        headers = {'Authorization': f'Bearer {token}'}
        with TestClient(create_app(configured_settings(url))) as client:
            path = f'/api/v1/registers/{register_id}/product-sales'
            # 1. Explicit null cash_amount_minor -> 422
            null_res = client.post(
                f'/api/v1/registers/{register_id}/product-sale-intent',
                headers={**headers, 'Idempotency-Key': 'null-cash'},
                json={'items': [{'product_id': product_id, 'quantity': 1}], 'expected_total_minor': 1200,
                      'cash_amount_minor': None},
            )
            assert null_res.status_code == 422

            # 2. Partial cash without assigned member -> 409
            anon_headers = {**headers, 'Idempotency-Key': 'anon-partial'}
            anon_payload = {'member_id': None, 'items': [{'product_id': product_id, 'quantity': 1}],
                            'expected_total_minor': 1200, 'cash_amount_minor': 500}
            assert client.post(f'/api/v1/registers/{register_id}/product-sale-intent', headers=anon_headers, json=anon_payload).status_code == 200
            assert client.post(path, headers=anon_headers, json=anon_payload).status_code == 409
            assert client.post(path + '/resolve', headers=anon_headers, json=anon_payload).status_code == 200

            # 3. $0 cash upfront with assigned member + fingerprint mismatch vs omitted cash_amount_minor
            zero_headers = {**headers, 'Idempotency-Key': 'zero-cash'}
            zero_payload = {'member_id': str(member_id), 'items': [{'product_id': product_id, 'quantity': 1}],
                            'expected_total_minor': 1200, 'cash_amount_minor': 0}
            assert client.post(f'/api/v1/registers/{register_id}/product-sale-intent', headers=zero_headers, json=zero_payload).status_code == 200
            mismatch_res = client.post(path, headers=zero_headers, json={
                'member_id': str(member_id), 'items': [{'product_id': product_id, 'quantity': 1}],
                'expected_total_minor': 1200,
            })
            assert mismatch_res.status_code == 409
            assert mismatch_res.json()['error']['code'] == 'idempotency_conflict'

            zero_res = client.post(path, headers=zero_headers, json=zero_payload)
            assert zero_res.status_code == 201, zero_res.text
            assert zero_res.json()['payment']['amount_minor'] == 0
            assert client.post(path + '/resolve', headers=zero_headers, json=zero_payload).status_code == 200

            # 4. credit_minor + partial cash_amount_minor on the same sale (total 1200, credit 400, cash 300 -> debt 500)
            combo_headers = {**headers, 'Idempotency-Key': 'combo-partial'}
            combo_payload = {
                'member_id': str(member_id),
                'items': [{'product_id': product_id, 'quantity': 1}],
                'expected_total_minor': 1200,
                'credit_minor': 400,
                'cash_amount_minor': 300,
            }
            assert client.post(f'/api/v1/registers/{register_id}/product-sale-intent', headers=combo_headers, json=combo_payload).status_code == 200
            combo_res = client.post(path, headers=combo_headers, json=combo_payload)
            assert combo_res.status_code == 201, combo_res.text
            combo_order_id = UUID(combo_res.json()['order']['id'])
            assert combo_res.json()['payment']['amount_minor'] == 300
            assert combo_res.json()['credit_applied_minor'] == 400
            assert client.post(path + '/resolve', headers=combo_headers, json=combo_payload).status_code == 200

            # 5. cash_amount_minor > payable total (1200 - 400 = 800) rejected
            over_headers = {**headers, 'Idempotency-Key': 'over-pay'}
            over_payload = {**combo_payload, 'cash_amount_minor': 900}
            assert client.post(f'/api/v1/registers/{register_id}/product-sale-intent', headers=over_headers, json=over_payload).status_code == 200
            assert client.post(path, headers=over_headers, json=over_payload).status_code == 409
            assert client.post(path + '/resolve', headers=over_headers, json=over_payload).status_code == 200

            # 6. Overtime partial cash product sale after closing shift
            with factory.begin() as session:
                close_shift(session, shift_id=shift_id, closed_by=staff_id,
                            denomination_counts=None, counted_cash_minor=300)

            ot_headers = {**headers, 'Idempotency-Key': 'ot-partial'}
            ot_payload = {'member_id': str(member_id), 'items': [{'product_id': product_id, 'quantity': 1}],
                          'expected_total_minor': 1200, 'cash_amount_minor': 200}
            assert client.post(f'/api/v1/registers/{register_id}/product-sale-intent', headers=ot_headers, json=ot_payload).status_code == 200
            ot_res = client.post(path, headers=ot_headers, json=ot_payload)
            assert ot_res.status_code == 201, ot_res.text
            ot_order_id = UUID(ot_res.json()['order']['id'])
            assert client.post(path + '/resolve', headers=ot_headers, json=ot_payload).status_code == 200

        with factory() as session:
            combo_debt = session.scalar(select(MembershipDebt).where(MembershipDebt.order_id == combo_order_id))
            assert combo_debt is not None and combo_debt.initial_outstanding_minor == 500
            assert session.get(Member, member_id).credit_balance_minor == 600
            ot_order = session.get(Order, ot_order_id)
            ot_debt = session.scalar(select(MembershipDebt).where(MembershipDebt.order_id == ot_order_id))
            assert ot_order.is_overtime is True and ot_order.financial_shift_id is None
            assert ot_debt is not None and ot_debt.initial_outstanding_minor == 1000
            with pytest.raises(ProductSaleRejected, match='offline sales'):
                _post_cash_sale(
                    session, register_id=register_id, actor_id=staff_id, member_id=member_id,
                    items=[ProductCartLineRequest(product_id=UUID(product_id), quantity=1)],
                    expected_total_minor=1200, idempotency_key='offline-partial',
                    policy=SalePolicy.CONTINGENCY, cash_amount_minor=500, cash_amount_provided=True,
                )
    finally:
        engine.dispose()
