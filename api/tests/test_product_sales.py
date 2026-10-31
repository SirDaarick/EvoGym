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
    import json
    from types import SimpleNamespace
    from fastapi import Response
    from app.api.sales import post_cash_product_sale_endpoint
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
        response = post_cash_product_sale_endpoint(register_id, payload, request, Response(), 'stale', principal)
        assert response.status_code == 409
        assert json.loads(response.body)['error']['code'] == 'product_sale_rejected'
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
    from fastapi import HTTPException
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
        assert resolve_product_sale_endpoint(register_id, payload, request, 'endpoint', principal) == {'status': 'cancelled'}
        assert resolve_product_sale_endpoint(register_id, payload, request, 'endpoint', principal) == {'status': 'cancelled'}
        with pytest.raises(HTTPException) as exc:
            resolve_product_sale_endpoint(register_id, payload.model_copy(update={'expected_total_minor': 200}), request, 'endpoint', principal)
        assert exc.value.status_code == 409
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
        assert prepare_product_sale_endpoint(register_id, payload, request, 'saved', principal)['key'] == 'saved'
        assert get_product_sale_intent_endpoint(request, principal)['key'] == 'saved'
        assert resolve_product_sale_endpoint(register_id, payload, request, 'saved', principal)['status'] == 'cancelled'
        assert get_product_sale_intent_endpoint(request, principal) is None
        result = post_cash_product_sale_endpoint(register_id, payload, request, Response(), 'saved', principal)
        assert result.status_code == 409
    finally:
        engine.dispose()
