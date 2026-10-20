from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.main import create_app
from test_admin_auth import configured_settings, seed_admin
from app.db.models import Branch, Product, StockInitialization, StaffUser
from app.db.models import RoleGrant, StaffCredential
from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import pytest
from app.inventory.queries import create_product, list_branch_stock, list_products


def test_admin_can_create_piece_product_without_creating_stock(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'inventory.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    actor_id = seed_admin(factory)
    app = create_app(configured_settings(url))
    try:
        with TestClient(app) as client:
            login = client.post("/api/v1/auth/sessions", json={"login_identifier": "owner@example.invalid", "password": "synthetic-admin-password"})
            token = login.json()["access_token"]
            response = client.post("/api/v1/inventory/products", headers={"Authorization": f"Bearer {token}"}, json={"code": "  gloves  ", "name": "  Training gloves  ", "unit": "piece"})
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
    app = create_app(configured_settings(url))
    try:
        with TestClient(app) as client:
            assert client.get(f"/api/v1/inventory/branches/{branch_id}/stock").status_code == 401
            token = client.post("/api/v1/auth/sessions", json={"login_identifier": "owner@example.invalid", "password": "synthetic-admin-password"}).json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
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
    app = create_app(configured_settings(url))
    try:
        with TestClient(app) as client:
            token = client.post("/api/v1/auth/sessions", json={"login_identifier": "owner@example.invalid", "password": "synthetic-admin-password"}).json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
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
    app = create_app(configured_settings(url))
    try:
        with TestClient(app) as client:
            response = client.post("/api/v1/inventory/products", headers={"Authorization": f"Bearer {token}"},
                                   json={"code": "gloves", "name": "Gloves"})
        assert response.status_code == 403
        with factory() as session:
            assert session.query(Product).count() == 0
    finally:
        engine.dispose()
