from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.main import create_app
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from admin_session_helpers import approved_admin_headers
from app.db.models import Branch, CashRegister, Product, RegisterInventorySnapshot, RegisterInventorySnapshotItem, StockInitialization, StaffSession, StaffUser
from app.db.models import RoleGrant, StaffCredential
from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import pytest
from app.inventory.queries import capture_register_inventory_snapshot, create_product, list_branch_stock, list_products


def test_receptionist_can_read_other_branch_stock_and_registers(tmp_path):
    from test_shifts import _seed_branch, _seed_receptionist, _setup_db
    from app.shifts.queries import create_cash_register

    url, engine, factory = _setup_db(tmp_path)
    try:
        home = _seed_branch(factory, 'home', 'Home')
        other = _seed_branch(factory, 'other', 'Other')
        _, token = _seed_receptionist(factory, home)
        with factory.begin() as session:
            register = create_cash_register(session, other, 'other-register', 'Other register')
            register_id = str(register.id)
        headers = {'Authorization': f'Bearer {token}'}
        with TestClient(create_app(configured_settings(url))) as client:
            stock = client.get(f'/api/v1/inventory/branches/{other}/stock', headers=headers)
            assert stock.status_code == 200
            registers = client.get('/api/v1/registers', headers=headers)
            assert registers.status_code == 200
            assert register_id in [item['id'] for item in registers.json()]
    finally:
        engine.dispose()


def test_non_receptionist_reads_remain_branch_scoped(tmp_path):
    from app.api.inventory import InventoryActorPrincipal, _actor
    from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
    from test_shifts import _seed_branch, _seed_receptionist, _setup_db

    url, engine, factory = _setup_db(tmp_path)
    try:
        home = _seed_branch(factory, 'home', 'Home')
        other = _seed_branch(factory, 'other', 'Other')
        actor, _ = _seed_receptionist(factory, home)
        with factory.begin() as session:
            session.query(RoleGrant).filter_by(staff_id=actor).update({'is_active': False})
        app = create_app(configured_settings(url))
        app.dependency_overrides[_actor] = lambda: InventoryActorPrincipal(actor, False, home)
        app.dependency_overrides[get_shift_actor_principal] = lambda: ShiftActorPrincipal(actor, False, home)
        with TestClient(app) as client:
            assert client.get(f'/api/v1/inventory/branches/{other}/stock').status_code == 403
            assert client.get(f'/api/v1/registers?branch_id={other}').status_code == 403
    finally:
        engine.dispose()


def test_direct_cross_branch_reads_authorize_only_active_receptionists(tmp_path):
    from types import SimpleNamespace
    from fastapi import HTTPException
    from app.api.inventory import InventoryActorPrincipal, list_stock_endpoint
    from app.api.shifts import ShiftActorPrincipal, list_registers_endpoint
    from test_shifts import _seed_branch, _seed_receptionist, _setup_db
    from app.shifts.queries import create_cash_register

    _, engine, factory = _setup_db(tmp_path)
    try:
        home, other = _seed_branch(factory, 'home', 'Home'), _seed_branch(factory, 'other', 'Other')
        actor, _ = _seed_receptionist(factory, home)
        with factory.begin() as session:
            register_id = create_cash_register(session, other, 'front', 'Front').id
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(session_factory=factory)))
        stock_actor = InventoryActorPrincipal(actor, False, home)
        shift_actor = ShiftActorPrincipal(actor, False, home)
        assert list_stock_endpoint(other, request, 0, 50, stock_actor).total == 0
        assert str(register_id) in [row.id for row in list_registers_endpoint(request, None, shift_actor)]
        with factory.begin() as session:
            session.query(RoleGrant).filter_by(staff_id=actor).update({'is_active': False})
        with pytest.raises(HTTPException) as stock_denied:
            list_stock_endpoint(other, request, 0, 50, stock_actor)
        assert stock_denied.value.status_code == 403
        with pytest.raises(HTTPException) as register_denied:
            list_registers_endpoint(request, other, shift_actor)
        assert register_denied.value.status_code == 403
    finally:
        engine.dispose()


def test_admin_can_create_piece_product_without_creating_stock(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'inventory.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    actor_id = seed_admin(factory)
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            headers = approved_admin_headers(client, delivery)
            response = client.post("/api/v1/inventory/products", headers=headers, json={"code": "  gloves  ", "name": "  Training gloves  ", "unit": "piece"})
        assert response.status_code == 201
        product = response.json()
        assert product["code"] == "gloves" and product["unit"] == "piece"
        assert product["created_by"]
        with factory() as session:
            assert session.query(Product).count() == 1
        with factory.begin() as session:
            for code, name in (("nul\u0000code", "Valid"), ("ß" * 64, "Valid"), ("valid", "nul\u0000name")):
                with pytest.raises(ValueError):
                    create_product(session, code=code, name=name, created_by=actor_id)
            with pytest.raises(ValueError, match="Offset"):
                list_products(session, offset=2**63, limit=50)
            with pytest.raises(ValueError, match="Offset"):
                list_branch_stock(session, branch_id=uuid4(), offset=2**63, limit=50)
            assert session.query(StockInitialization).count() == 0
    finally:
        engine.dispose()


def test_inventory_requires_admin_and_reports_missing_stock_as_null(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'inventory-read.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    actor_id = seed_admin(factory)
    with factory.begin() as session:
        branch = Branch(code="central", name="Central")
        session.add(branch)
        session.flush()
        branch_id = branch.id
        other_branch = Branch(code="north", name="North")
        session.add(other_branch)
        session.flush()
        other_branch_id = other_branch.id
        product = Product(code="bands", name="Resistance bands", created_by=actor_id)
        session.add(product)
        session.flush()
        product_id = product.id
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            assert client.get(f"/api/v1/inventory/branches/{branch_id}/stock").status_code == 401
            headers = approved_admin_headers(client, delivery)
            empty = client.get(f"/api/v1/inventory/branches/{branch_id}/stock", headers=headers).json()
            assert empty["items"][0]["initialized"] is False and empty["items"][0]["quantity"] is None
            created = client.post(f"/api/v1/inventory/branches/{branch_id}/initializations", headers=headers, json={"product_id": str(product_id), "quantity": 0})
            assert created.status_code == 201 and created.json()["quantity"] == 0
            duplicate = client.post(f"/api/v1/inventory/branches/{branch_id}/initializations", headers=headers, json={"product_id": str(product_id), "quantity": 7})
            assert duplicate.status_code == 409
            stock = client.get(f"/api/v1/inventory/branches/{branch_id}/stock", headers=headers).json()
            assert stock["items"][0]["initialized"] is True and stock["items"][0]["quantity"] == 0
            other_stock = client.get(f"/api/v1/inventory/branches/{other_branch_id}/stock", headers=headers).json()
            assert other_stock["items"][0]["initialized"] is False and other_stock["items"][0]["quantity"] is None
            for invalid_quantity in (True, -1, 1.5, "1", 2**63):
                invalid = client.post(f"/api/v1/inventory/branches/{branch_id}/initializations", headers=headers,
                                      json={"product_id": str(product_id), "quantity": invalid_quantity})
                assert invalid.status_code == 422
            missing_product = client.post(f"/api/v1/inventory/branches/{branch_id}/initializations", headers=headers,
                                          json={"product_id": str(uuid4()), "quantity": 1})
            missing_branch = client.post(f"/api/v1/inventory/branches/{uuid4()}/initializations", headers=headers,
                                         json={"product_id": str(product_id), "quantity": 1})
            assert missing_product.status_code == missing_branch.status_code == 404
            unsupported = client.post("/api/v1/inventory/products", headers=headers, json={"code": "scoop", "name": "Scoop", "unit": "scoop"})
            assert unsupported.status_code == 422
            duplicate_code = client.post("/api/v1/inventory/products", headers=headers, json={"code": "bands", "name": "Duplicate"})
            assert duplicate_code.status_code == 409
            huge_offset = 2**63
            product_page = client.get(f"/api/v1/inventory/products?offset={huge_offset}", headers=headers)
            stock_page = client.get(f"/api/v1/inventory/branches/{branch_id}/stock?offset={huge_offset}", headers=headers)
            assert product_page.status_code == stock_page.status_code == 422
    finally:
        engine.dispose()


def test_product_normalization_rejects_unrepresentable_values_without_writing(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'inventory-normalization.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    seed_admin(factory)
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            headers = approved_admin_headers(client, delivery)
            invalid_payloads = [
                {"code": "ß" * 64, "name": "Test"},
                {"code": "nul\u0000code", "name": "Test"},
                {"code": "valid", "name": "nul\u0000name"},
            ]
            responses = [client.post("/api/v1/inventory/products", headers=headers, json=payload)
                         for payload in invalid_payloads]
            assert [response.status_code for response in responses] == [422, 422, 422]
            normal = client.post("/api/v1/inventory/products", headers=headers,
                                 json={"code": "  Straße  ", "name": "  Test  "})
            duplicate = client.post("/api/v1/inventory/products", headers=headers,
                                    json={"code": "STRASSE", "name": "Another name"})
            assert normal.status_code == 201 and normal.json()["code"] == "strasse"
            assert duplicate.status_code == 409
        with factory() as session:
            assert session.query(Product).count() == 1
    finally:
        engine.dispose()


def test_receptionist_cannot_create_products(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'inventory-role.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    with factory.begin() as session:
        branch = Branch(code="central", name="Central")
        staff = StaffUser(login_identifier="reception@example.invalid")
        session.add_all([branch, staff])
        session.flush()
        staff_id, branch_id = staff.id, branch.id
        session.add_all([RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch.id),
                         StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin("1234"))])
    token = issue_session(factory, "reception@example.invalid", "1234", branch_id,
                          datetime.now(timezone.utc) + timedelta(hours=1)).token
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            response = client.post("/api/v1/inventory/products", headers={"Authorization": f"Bearer {token}"},
                                   json={"code": "gloves", "name": "Gloves"})
        assert response.status_code == 403
        with factory() as session:
            assert session.query(Product).count() == 0
    finally:
        engine.dispose()


def test_register_inventory_snapshot_capture_route_exists(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'inventory-snapshot-route.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    admin_id = seed_admin(factory)
    with factory.begin() as session:
        branch = Branch(code="central", name="Central")
        session.add(branch)
        session.flush()
        register = CashRegister(branch_id=branch.id, code="front", name="Front desk")
        session.add(register)
        session.flush()
        register_id, branch_id = register.id, branch.id
    with factory() as session:
        capture_register_inventory_snapshot(session, register_id=register_id, actor_id=admin_id)
        session.rollback()
    with factory() as session:
        assert session.query(RegisterInventorySnapshot).count() == 0
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            headers = approved_admin_headers(client, delivery)
            response = client.post(
                f"/api/v1/registers/{register_id}/inventory-snapshots",
                headers=headers,
            )
        assert response.status_code == 201
    finally:
        engine.dispose()


def test_snapshot_captures_complete_catalog_and_keeps_historical_values(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'inventory-snapshot-complete.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    admin_id = seed_admin(factory)
    with factory.begin() as session:
        branch = Branch(code="central", name="Central")
        session.add(branch)
        session.flush()
        register = CashRegister(branch_id=branch.id, code="front", name="Front desk")
        products = [
            Product(code=f"item-{index:03d}", name=f"Product {index:03d}", created_by=admin_id)
            for index in range(121)
        ]
        session.add_all([register, *products])
        session.flush()
        session.add_all([
            StockInitialization(branch_id=branch.id, product_id=products[0].id, quantity=0,
                                initialized_by=admin_id),
            StockInitialization(branch_id=branch.id, product_id=products[1].id, quantity=7,
                                initialized_by=admin_id),
        ])
        register_id = register.id
        first_product_id, second_product_id = products[0].id, products[1].id

    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            headers = approved_admin_headers(client, delivery)
            captured = client.post(f"/api/v1/registers/{register_id}/inventory-snapshots", headers=headers)
            assert captured.status_code == 201
            first = captured.json()
            assert first["captured_by"] == str(admin_id)
            assert first["item_count"] == 121
            assert first["missing_count"] == 119
            assert first["source_state"] == "missing_initializations"
            assert len(first["items"]) == 121
            assert [item["code"] for item in first["items"]] == sorted(item["code"] for item in first["items"])
            assert first["items"][0]["initialized"] is True
            assert first["items"][0]["expected_quantity"] == 0
            assert first["items"][1]["initialized"] is True
            assert first["items"][1]["expected_quantity"] == 7
            assert first["items"][2]["initialized"] is False
            assert first["items"][2]["expected_quantity"] is None
            assert first["items"][1]["initialized_by"] == str(admin_id)
            with factory() as session:
                observed = {row.product_id: row.quantity for row in session.query(StockInitialization).all()}
                assert observed == {first_product_id: 0, second_product_id: 7}

            with factory.begin() as session:
                product = session.get(Product, second_product_id)
                product.name = "Renamed after capture"
                stock = session.query(StockInitialization).filter_by(product_id=second_product_id).one()
                stock.quantity = 9
                session.add(Product(code="item-121", name="New later", created_by=admin_id))

            later = client.post(f"/api/v1/registers/{register_id}/inventory-snapshots", headers=headers)
            assert later.status_code == 201
            assert later.json()["item_count"] == 122
            old_read = client.get(
                f"/api/v1/registers/{register_id}/inventory-snapshots/{first['id']}", headers=headers
            )
            assert old_read.status_code == 200
            old_item = next(item for item in old_read.json()["items"] if item["product_id"] == str(second_product_id))
            assert old_item["name"] == "Product 001" and old_item["expected_quantity"] == 7
        with factory() as session:
            assert session.query(StockInitialization).filter_by(product_id=first_product_id).one().quantity == 0
            assert session.query(RegisterInventorySnapshot).count() == 2
            assert session.query(RegisterInventorySnapshotItem).count() == 243
    finally:
        engine.dispose()


def test_snapshot_empty_catalog_is_classified_without_authorizing_review(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'inventory-snapshot-empty.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    admin_id = seed_admin(factory)
    with factory.begin() as session:
        branch = Branch(code="central", name="Central")
        session.add(branch)
        session.flush()
        register = CashRegister(branch_id=branch.id, code="front", name="Front desk")
        session.add(register)
        session.flush()
        register_id, branch_id = register.id, branch.id
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            headers = approved_admin_headers(client, delivery)
            response = client.post(f"/api/v1/registers/{register_id}/inventory-snapshots", headers=headers)
            assert response.status_code == 201
            assert response.json()["source_state"] == "empty_catalog"
            assert response.json()["item_count"] == response.json()["missing_count"] == 0
            assert response.json()["items"] == []
            empty_snapshot_id = response.json()["id"]
            with factory.begin() as session:
                product = Product(code="bands", name="Bands", created_by=admin_id)
                session.add(product)
                session.flush()
                session.add(StockInitialization(branch_id=branch_id, product_id=product.id, quantity=0,
                                                initialized_by=admin_id))
            initialized = client.post(f"/api/v1/registers/{register_id}/inventory-snapshots", headers=headers)
            assert initialized.status_code == 201
            assert initialized.json()["source_state"] == "all_initialized"
            assert initialized.json()["items"][0]["initialized"] is True
            assert initialized.json()["items"][0]["expected_quantity"] == 0
            assert client.get(
                f"/api/v1/registers/{register_id}/inventory-snapshots/{empty_snapshot_id}", headers=headers
            ).json()["source_state"] == "empty_catalog"
    finally:
        engine.dispose()


def test_snapshot_rechecks_receptionist_branch_scope_and_session(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'inventory-snapshot-scope.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    with factory.begin() as session:
        central = Branch(code="central", name="Central")
        north = Branch(code="north", name="North")
        staff = StaffUser(login_identifier="snapshot-reception@example.invalid")
        session.add_all([central, north, staff])
        session.flush()
        central_register = CashRegister(branch_id=central.id, code="front", name="Front")
        north_register = CashRegister(branch_id=north.id, code="front", name="Front")
        session.add_all([central_register, north_register])
        session.flush()
        session.add_all([
            RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=central.id),
            StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin("1234")),
        ])
        staff_id, branch_id, central_id, north_id = staff.id, central.id, central_register.id, north_register.id
    token = issue_session(
        factory, "snapshot-reception@example.invalid", "1234", branch_id,
        datetime.now(timezone.utc) + timedelta(hours=1),
    ).token
    app = create_app(configured_settings(url))
    try:
        with TestClient(app) as client:
            headers = {"Authorization": f"Bearer {token}"}
            unauthenticated = client.post(f"/api/v1/registers/{central_id}/inventory-snapshots")
            created = client.post(f"/api/v1/registers/{central_id}/inventory-snapshots", headers=headers)
            assert unauthenticated.status_code == 401
            assert created.status_code == 201
            snapshot_id = created.json()["id"]
            assert client.get(
                f"/api/v1/registers/{central_id}/inventory-snapshots/{snapshot_id}", headers=headers
            ).status_code == 200
            assert client.post(f"/api/v1/registers/{north_id}/inventory-snapshots", headers=headers).status_code == 404
            assert client.get(
                f"/api/v1/registers/{north_id}/inventory-snapshots/{snapshot_id}", headers=headers
            ).status_code == 404
            with factory.begin() as session:
                session.query(StaffSession).filter_by(staff_id=staff_id).one().revoked_at = datetime.now(timezone.utc)
            revoked = client.get(
                f"/api/v1/registers/{central_id}/inventory-snapshots/{snapshot_id}", headers=headers
            )
            assert revoked.status_code == 401
    finally:
        engine.dispose()


def test_product_commercial_fields_and_patch(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'inventory-commercial.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    admin_id = seed_admin(factory)
    with factory.begin() as session:
        branch = Branch(code="central", name="Central Branch")
        session.add(branch)
        session.flush()
        branch_id = branch.id

    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            headers = approved_admin_headers(client, delivery)

            # 1. GET /api/v1/inventory/branches
            branches_res = client.get("/api/v1/inventory/branches", headers=headers)
            assert branches_res.status_code == 200
            assert any(b["id"] == str(branch_id) for b in branches_res.json())

            # 2. POST /api/v1/inventory/products with category, price_minor, cost_minor, initial_quantity
            create_res = client.post(
                "/api/v1/inventory/products",
                headers=headers,
                json={
                    "name": "Electrolito Suero 500ml",
                    "category": "Bebidas",
                    "price_minor": 3500,
                    "cost_minor": 1800,
                    "initial_quantity": 20,
                    "initial_branch_id": str(branch_id),
                },
            )
            assert create_res.status_code == 201
            product = create_res.json()
            product_id = product["id"]
            assert product["name"] == "Electrolito Suero 500ml"
            assert product["category"] == "Bebidas"
            assert product["price_minor"] == 3500
            assert product["cost_minor"] == 1800
            assert product["is_active"] is True
            assert product["code"]  # auto-generated

            # 3. GET /api/v1/inventory/branches/{branch_id}/stock includes commercial metadata and initialized quantity
            stock_res = client.get(f"/api/v1/inventory/branches/{branch_id}/stock", headers=headers)
            assert stock_res.status_code == 200
            stock_items = stock_res.json()["items"]
            item = next(it for it in stock_items if it["product_id"] == product_id)
            assert item["name"] == "Electrolito Suero 500ml"
            assert item["category"] == "Bebidas"
            assert item["price_minor"] == 3500
            assert item["cost_minor"] == 1800
            assert item["is_active"] is True
            assert item["initialized"] is True
            assert item["opening_quantity"] == 20
            assert item["quantity"] == 20
            assert item["restocked_quantity"] == 0
            assert item["waste_quantity"] == 0

            # 4. PATCH /api/v1/inventory/products/{product_id}
            patch_res = client.patch(
                f"/api/v1/inventory/products/{product_id}",
                headers=headers,
                json={
                    "price_minor": 4000,
                    "is_active": False,
                },
            )
            assert patch_res.status_code == 200
            updated = patch_res.json()
            assert updated["price_minor"] == 4000
            assert updated["is_active"] is False
            assert updated["name"] == "Electrolito Suero 500ml"
            assert updated["cost_minor"] == 1800

            # Check stock view reflects updated metadata
            stock_res_2 = client.get(f"/api/v1/inventory/branches/{branch_id}/stock", headers=headers)
            item_2 = next(it for it in stock_res_2.json()["items"] if it["product_id"] == product_id)
            assert item_2["price_minor"] == 4000
            assert item_2["is_active"] is False
            assert item_2["quantity"] == 20
    finally:
        engine.dispose()


def test_stock_movements_ledger_invariants_and_branch_scope(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'inventory-movements.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    admin_id = seed_admin(factory)
    with factory.begin() as session:
        central = Branch(code="central", name="Central Branch")
        north = Branch(code="north", name="North Branch")
        staff = StaffUser(login_identifier="central-staff@example.invalid")
        session.add_all([central, north, staff])
        session.flush()
        central_id, north_id, staff_id = central.id, north.id, staff.id
        session.add_all([
            RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=central.id),
            StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin("1234")),
        ])
        product = Product(
            code="water-500",
            name="Agua 500ml",
            category="Bebidas",
            price_minor=1500,
            cost_minor=800,
            is_active=True,
            created_by=admin_id,
        )
        session.add(product)
        session.flush()
        product_id = product.id
        session.add(StockInitialization(
            branch_id=central_id,
            product_id=product_id,
            quantity=10,
            initialized_by=admin_id,
        ))

    staff_token = issue_session(
        factory, "central-staff@example.invalid", "1234", central_id,
        datetime.now(timezone.utc) + timedelta(hours=1),
    ).token
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            admin_headers = approved_admin_headers(client, delivery)
            staff_headers = {"Authorization": f"Bearer {staff_token}"}

            # Reception staff can read stock in both branches.
            central_stock = client.get(f"/api/v1/inventory/branches/{central_id}/stock", headers=staff_headers)
            assert central_stock.status_code == 200
            assert central_stock.json()["items"][0]["quantity"] == 10

            north_stock = client.get(f"/api/v1/inventory/branches/{north_id}/stock", headers=staff_headers)
            assert north_stock.status_code == 200

            # 2. Restock movement (+5)
            restock_res = client.post(
                f"/api/v1/inventory/branches/{central_id}/movements",
                headers=staff_headers,
                json={
                    "product_id": str(product_id),
                    "kind": "restock",
                    "quantity": 5,
                    "idempotency_key": "key-restock-1",
                },
            )
            assert restock_res.status_code == 201
            mov1 = restock_res.json()
            assert mov1["kind"] == "restock"
            assert mov1["quantity"] == 5
            assert mov1["on_hand_quantity"] == 15

            # 3. Idempotent replay of the exact same movement returns 200 and does NOT increment stock
            replay_res = client.post(
                f"/api/v1/inventory/branches/{central_id}/movements",
                headers=staff_headers,
                json={
                    "product_id": str(product_id),
                    "kind": "restock",
                    "quantity": 5,
                    "idempotency_key": "key-restock-1",
                },
            )
            assert replay_res.status_code == 200
            assert replay_res.json()["on_hand_quantity"] == 15

            # 4. Conflicting idempotency key with different payload returns 409
            conflict_res = client.post(
                f"/api/v1/inventory/branches/{central_id}/movements",
                headers=staff_headers,
                json={
                    "product_id": str(product_id),
                    "kind": "restock",
                    "quantity": 99,
                    "idempotency_key": "key-restock-1",
                },
            )
            assert conflict_res.status_code == 409

            # 5. Waste movement (-3) with reason succeeds and leaves on-hand 12
            waste_res = client.post(
                f"/api/v1/inventory/branches/{central_id}/movements",
                headers=staff_headers,
                json={
                    "product_id": str(product_id),
                    "kind": "waste",
                    "quantity": 3,
                    "reason": "Botella rota en bodega",
                    "idempotency_key": "key-waste-1",
                },
            )
            assert waste_res.status_code == 201
            assert waste_res.json()["on_hand_quantity"] == 12

            # 6. Waste without reason is rejected
            no_reason_res = client.post(
                f"/api/v1/inventory/branches/{central_id}/movements",
                headers=staff_headers,
                json={
                    "product_id": str(product_id),
                    "kind": "waste",
                    "quantity": 1,
                    "idempotency_key": "key-waste-no-reason",
                },
            )
            assert no_reason_res.status_code in (400, 422)

            # 7. Waste exceeding on-hand stock (quantity: 20 > 12) returns 409 Conflict
            excess_waste = client.post(
                f"/api/v1/inventory/branches/{central_id}/movements",
                headers=staff_headers,
                json={
                    "product_id": str(product_id),
                    "kind": "waste",
                    "quantity": 20,
                    "reason": "Pérdida",
                    "idempotency_key": "key-waste-excess",
                },
            )
            assert excess_waste.status_code == 409

            # 8. GET /api/v1/inventory/branches/{branch_id}/movements lists movements
            movs_res = client.get(f"/api/v1/inventory/branches/{central_id}/movements", headers=staff_headers)
            assert movs_res.status_code == 200
            movs_data = movs_res.json()
            assert movs_data["total"] == 2
            assert len(movs_data["items"]) == 2

            # Verify stock endpoint reflects current calculated stock
            stock_check = client.get(f"/api/v1/inventory/branches/{central_id}/stock", headers=staff_headers)
            stock_item = stock_check.json()["items"][0]
            assert stock_item["opening_quantity"] == 10
            assert stock_item["restocked_quantity"] == 5
            assert stock_item["waste_quantity"] == 3
            assert stock_item["quantity"] == 12

            # 9. Deactivate product and verify movements are rejected with 409
            client.patch(
                f"/api/v1/inventory/products/{product_id}",
                headers=admin_headers,
                json={"is_active": False},
            )
            inactive_mov = client.post(
                f"/api/v1/inventory/branches/{central_id}/movements",
                headers=staff_headers,
                json={
                    "product_id": str(product_id),
                    "kind": "restock",
                    "quantity": 2,
                    "idempotency_key": "key-restock-inactive",
                },
            )
            assert inactive_mov.status_code == 409

            # 10. Staff cannot record movements for North branch (403)
            cross_branch = client.post(
                f"/api/v1/inventory/branches/{north_id}/movements",
                headers=staff_headers,
                json={
                    "product_id": str(product_id),
                    "kind": "restock",
                    "quantity": 1,
                    "idempotency_key": "key-cross-branch",
                },
            )
            assert cross_branch.status_code == 403
    finally:
        engine.dispose()
