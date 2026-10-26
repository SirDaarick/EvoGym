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
