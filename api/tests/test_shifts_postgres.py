"""Opt-in PostgreSQL concurrency proofs for opening review consumption."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
import os
import time
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.db.models import Branch, CashRegister, Product, StaffUser, StockInitialization
from app.inventory.queries import (
    InventorySnapshotStaleError,
    capture_register_inventory_snapshot,
    validate_opening_inventory_snapshot,
)
from app.shifts.queries import ShiftAlreadyOpenError, open_shift


API_DIR = os.path.dirname(os.path.dirname(__file__))
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


@pytest.fixture
def postgres_shift_target(monkeypatch):
    configured = os.getenv("EVOGYM_TEST_POSTGRES_URL")
    if not configured:
        pytest.skip("Set EVOGYM_TEST_POSTGRES_URL to a disposable local PostgreSQL instance.")
    base_url = make_url(configured)
    if not base_url.drivername.startswith("postgresql+") or base_url.host not in LOOPBACK_HOSTS:
        pytest.fail("PostgreSQL shift tests require a loopback-only disposable target.")
    schema = f"shift_review_{uuid4().hex}"
    admin_engine = create_engine(base_url)
    try:
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        scoped_url = base_url.update_query_dict({"options": f"-csearch_path={schema}"})
        rendered = scoped_url.render_as_string(hide_password=False)
        monkeypatch.setenv("EVOGYM_ENV", "test")
        monkeypatch.setenv("EVOGYM_DEBUG", "false")
        monkeypatch.setenv("EVOGYM_DATABASE_URL", rendered)
        config = Config(os.path.join(API_DIR, "alembic.ini"))
        command.upgrade(config, "head")
        engine = create_engine(scoped_url)
        factory = sessionmaker(engine)
        with factory.begin() as session:
            branch = Branch(code="review", name="Review")
            staff = StaffUser(login_identifier=f"{uuid4()}@example.invalid")
            session.add_all([branch, staff])
            session.flush()
            register = CashRegister(branch_id=branch.id, code="front", name="Front")
            product = Product(code="bands", name="Bands", created_by=staff.id)
            session.add_all([register, product])
            session.flush()
            snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=staff.id)
            values = (register.id, staff.id, product.id, snapshot.id)
        yield engine, factory, values
        engine.dispose()
    finally:
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin_engine.dispose()


def _open(session, register_id, actor_id, snapshot_id):
    return open_shift(
        session,
        register_id=register_id,
        opened_by=actor_id,
        denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
        inventory_snapshot_id=snapshot_id,
    )


def test_postgres_competing_openings_cannot_consume_snapshot_twice(postgres_shift_target):
    _engine, factory, (register_id, actor_id, _product_id, snapshot_id) = postgres_shift_target
    second_actor = uuid4()
    with factory.begin() as session:
        session.add(StaffUser(id=second_actor, login_identifier=f"{second_actor}@example.invalid"))

    first_session = factory()
    first_shift = _open(first_session, register_id, actor_id, snapshot_id)
    first_shift_id = first_shift.id
    started = Event()

    def competing_open():
        started.set()
        with factory() as session:
            try:
                _open(session, register_id, second_actor, snapshot_id)
                session.commit()
                return "opened"
            except ShiftAlreadyOpenError:
                session.rollback()
                return "already_open"

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(competing_open)
        assert started.wait(2)
        time.sleep(0.2)
        first_session.commit()
        first_session.close()
        assert future.result(timeout=5) == "already_open"
    assert first_shift_id is not None


def test_postgres_catalog_writer_waits_for_opening_comparison_and_commit(postgres_shift_target):
    _engine, factory, (register_id, actor_id, _product_id, snapshot_id) = postgres_shift_target
    opening_session = factory()
    _open(opening_session, register_id, actor_id, snapshot_id)
    started = Event()
    finished = Event()

    def add_product():
        with factory() as session:
            started.set()
            session.add(Product(code="gloves", name="Gloves", created_by=actor_id))
            session.flush()
            session.commit()
            finished.set()

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(add_product)
        assert started.wait(2)
        time.sleep(0.2)
        assert not finished.is_set()
        opening_session.commit()
        opening_session.close()
        future.result(timeout=5)
        assert finished.is_set()


def test_postgres_source_change_before_opening_makes_snapshot_stale(postgres_shift_target):
    _engine, factory, (register_id, actor_id, product_id, snapshot_id) = postgres_shift_target
    with factory.begin() as session:
        session.get(Product, product_id).name = "Changed before opening"
    with factory() as session:
        with pytest.raises(InventorySnapshotStaleError):
            _open(session, register_id, actor_id, snapshot_id)
        session.rollback()


def test_postgres_cached_source_objects_cannot_hide_stale_snapshot(postgres_shift_target):
    _engine, factory, (register_id, actor_id, product_id, _initial_snapshot_id) = postgres_shift_target
    with factory.begin() as session:
        initialization = StockInitialization(
            branch_id=session.get(CashRegister, register_id).branch_id,
            product_id=product_id,
            quantity=3,
            initialized_by=actor_id,
        )
        session.add(initialization)
        session.flush()
        initialization_id = initialization.id
    opening_session = factory()
    snapshot = capture_register_inventory_snapshot(
        opening_session, register_id=register_id, actor_id=actor_id
    )
    snapshot_id = snapshot.id
    opening_session.commit()
    cached_product = opening_session.get(Product, product_id)
    cached_initialization = opening_session.get(StockInitialization, initialization_id)
    branch_id = opening_session.get(CashRegister, register_id).branch_id
    assert cached_product.name == "Bands"
    assert cached_initialization.quantity == 3

    with factory.begin() as writer:
        writer.get(Product, product_id).name = "Changed in another session"
        writer.get(StockInitialization, initialization_id).quantity = 8

    with pytest.raises(InventorySnapshotStaleError):
        validate_opening_inventory_snapshot(
            opening_session,
            register_id=register_id,
            branch_id=branch_id,
            snapshot_id=snapshot_id,
        )
    opening_session.rollback()
    opening_session.close()
