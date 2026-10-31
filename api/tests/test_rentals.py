"""Rental public contracts use disposable data and genuine authenticated sessions."""
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, inspect, text
from alembic import command
from alembic.config import Config
from pathlib import Path

from app.main import create_app
from admin_session_helpers import approved_admin_headers
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from test_shifts import _seed_branch, _seed_receptionist, _setup_db


@pytest.fixture
def rental_store(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    seed_admin(factory)
    branch = _seed_branch(factory, "rentals", "Rentals")
    other = _seed_branch(factory, "other-rentals", "Other rentals")
    actor, token = _seed_receptionist(factory, branch, "rentals@example.invalid")
    delivery = FakeRecoveryDelivery()
    try:
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            yield client, factory, branch, other, actor, token, approved_admin_headers(client, delivery)
    finally:
        engine.dispose()


def test_rental_assets_admin_create_update_and_reload(rental_store):
    client, factory, branch, _, actor, _, headers = rental_store
    payload = {"branch_id": str(branch), "kind": "glove", "code": " #01 ",
               "color": "Red", "ounces": 12, "price_minor": 2500}
    created = client.post("/api/v1/rentals/assets", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    glove = created.json()
    assert glove["code"] == "#01" and glove["status"] == "available"
    assert glove["price_minor"] == 2500 and glove["kind"] == "glove"
    duplicate = client.post("/api/v1/rentals/assets", headers=headers, json=payload)
    assert duplicate.status_code == 409
    invalid = client.post("/api/v1/rentals/assets", headers=headers,
                          json={**payload, "code": "#02", "ounces": None})
    assert invalid.status_code == 422
    updated = client.patch(f"/api/v1/rentals/assets/{glove['id']}", headers=headers,
                           json={"price_minor": 3000, "status": "out_of_service"})
    assert updated.status_code == 200, updated.text
    page = client.get(f"/api/v1/rentals/assets?branch_id={branch}&kind=glove", headers=headers)
    assert page.status_code == 200
    assert page.json()["total"] == 1
    assert page.json()["items"][0]["price_minor"] == 3000
    assert page.json()["items"][0]["status"] == "out_of_service"
    locker = client.post("/api/v1/rentals/assets", headers=headers, json={
        "branch_id": str(branch), "kind": "locker", "code": "L01",
        "locker_number": 1, "price_minor": 15000,
    })
    assert locker.status_code == 201, locker.text
    invalid_patch = client.patch(f"/api/v1/rentals/assets/{locker.json()['id']}", headers=headers,
                                 json={"color": "Red"})
    assert invalid_patch.status_code == 422
    null_price = client.patch(f"/api/v1/rentals/assets/{glove['id']}", headers=headers,
                              json={"price_minor": None})
    assert null_price.status_code == 422
    with factory() as session:
        assert session.scalar(text("SELECT count(*) FROM rental_assets")) == 2


def test_rental_assets_require_admin_writes_and_branch_scoped_reads(rental_store):
    client, factory, branch, other, _, token, admin = rental_store
    staff = {"Authorization": f"Bearer {token}"}
    payload = {"branch_id": str(other), "kind": "locker", "code": "#01",
               "locker_number": 1, "price_minor": 15000}
    assert client.get(f"/api/v1/rentals/assets?branch_id={branch}").status_code == 401
    assert client.post("/api/v1/rentals/assets", headers=staff, json=payload).status_code == 403
    created = client.post("/api/v1/rentals/assets", headers=admin, json=payload)
    assert created.status_code == 201, created.text
    assert client.patch(f"/api/v1/rentals/assets/{created.json()['id']}", headers=staff,
                        json={"price_minor": 1}).status_code == 403
    assert client.get(f"/api/v1/rentals/assets?branch_id={other}", headers=staff).status_code == 403
    empty = client.get(f"/api/v1/rentals/assets?branch_id={branch}", headers=staff)
    assert empty.status_code == 200 and empty.json()["items"] == []
    with factory() as session:
        assert session.scalar(text("SELECT price_minor FROM rental_assets")) == 15000


def test_rental_asset_migration_adds_constraints_without_changing_existing_data(tmp_path, monkeypatch):
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    url = f"sqlite+pysqlite:///{(tmp_path / 'migration.db').as_posix()}"
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", url)
    command.upgrade(config, "0046_card_payments_point")
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO branches (id, code, name) VALUES (:id, 'legacy', 'Legacy')"),
                               {"id": "a" * 32})
        command.upgrade(config, "head")
        assert "rental_assets" in inspect(engine).get_table_names()
        assert len(inspect(engine).get_check_constraints("rental_assets")) == 5
        with engine.connect() as connection:
            assert connection.execute(text("SELECT name FROM branches WHERE code='legacy'")).scalar_one() == "Legacy"
        command.downgrade(config, "0046_card_payments_point")
        assert "rental_assets" not in inspect(engine).get_table_names()
        with engine.connect() as connection:
            assert connection.execute(text("SELECT name FROM branches WHERE code='legacy'")).scalar_one() == "Legacy"
    finally:
        engine.dispose()
