from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.models import (
    Branch,
    CashRegister,
    Product,
    RegisterInventorySnapshot,
    RegisterInventorySnapshotItem,
    StaffUser,
    StockInitialization,
)
from app.inventory.queries import capture_register_inventory_snapshot, get_register_inventory_snapshot


def _snapshot_session(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'snapshot-check.db').as_posix()}")
    Base.metadata.create_all(engine)
    session = Session(engine)
    branch = Branch(code="north", name="North")
    actor = StaffUser(login_identifier="snapshot@example.invalid")
    session.add_all([branch, actor])
    session.flush()
    register = CashRegister(branch_id=branch.id, code="front", name="Front")
    session.add(register)
    session.flush()
    return engine, session, branch, actor, register


def test_snapshot_captures_full_catalog_and_distinguishes_missing_from_zero(tmp_path):
    engine, session, branch, actor, register = _snapshot_session(tmp_path)
    products = [
        Product(code=f"item-{index:03d}", name=f"Product {index:03d}", created_by=actor.id)
        for index in range(121)
    ]
    session.add_all(products)
    session.flush()
    session.add(StockInitialization(
        branch_id=branch.id,
        product_id=products[0].id,
        quantity=0,
        initialized_by=actor.id,
    ))
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)

    assert snapshot.item_count == 121
    assert snapshot.missing_count == 120
    assert snapshot.source_state == "missing_initializations"
    assert len(snapshot.items) == 121
    assert snapshot.items[0].code == "item-000"
    assert snapshot.items[0].initialized is True
    assert snapshot.items[0].expected_quantity == 0
    assert snapshot.items[1].initialized is False
    assert snapshot.items[1].expected_quantity is None
    assert snapshot.captured_by == actor.id
    session.rollback()
    session.close()
    engine.dispose()


def test_empty_catalog_is_classified_as_source_state_not_review_acceptance(tmp_path):
    engine, session, _branch, actor, register = _snapshot_session(tmp_path)
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)

    assert snapshot.item_count == 0
    assert snapshot.missing_count == 0
    assert snapshot.source_state == "empty_catalog"
    session.commit()
    session.close()
    engine.dispose()


def test_snapshot_preserves_copied_values_after_catalog_and_baseline_change(tmp_path):
    engine, session, branch, actor, register = _snapshot_session(tmp_path)
    product = Product(code="gloves", name="Training gloves", created_by=actor.id)
    session.add(product)
    session.flush()
    initialization = StockInitialization(
        branch_id=branch.id,
        product_id=product.id,
        quantity=7,
        initialized_by=actor.id,
    )
    session.add(initialization)
    session.flush()
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)
    snapshot_id = snapshot.id
    product_id = product.id
    session.commit()

    product.name = "Renamed gloves"
    initialization.quantity = 99
    session.commit()
    stored = get_register_inventory_snapshot(session, register_id=register.id, snapshot_id=snapshot_id)

    assert stored is not None
    assert stored.items[0].product_id == product_id
    assert stored.items[0].name == "Training gloves"
    assert stored.items[0].expected_quantity == 7
    assert stored.items[0].initialization_id == initialization.id
    session.close()
    engine.dispose()


def test_snapshot_item_check_rejects_initialized_null_but_allows_explicit_zero(tmp_path):
    engine, session, branch, actor, register = _snapshot_session(tmp_path)
    product = Product(code="gloves", name="Training gloves", created_by=actor.id)
    session.add(product)
    session.flush()
    snapshot = RegisterInventorySnapshot(
        register_id=register.id,
        branch_id=branch.id,
        captured_by=actor.id,
        item_count=1,
        missing_count=0,
        source_state="all_initialized",
    )
    session.add(snapshot)
    session.flush()

    session.add(RegisterInventorySnapshotItem(
        snapshot_id=snapshot.id,
        product_id=product.id,
        code="gloves",
        name="Training gloves",
        unit="piece",
        initialized=True,
        expected_quantity=None,
        initialization_id=uuid4(),
        initialized_by=actor.id,
        initialized_at=datetime.now(timezone.utc),
    ))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()

    snapshot = RegisterInventorySnapshot(
        register_id=register.id,
        branch_id=branch.id,
        captured_by=actor.id,
        item_count=1,
        missing_count=0,
        source_state="all_initialized",
    )
    session.add(snapshot)
    session.flush()
    session.add(RegisterInventorySnapshotItem(
        snapshot_id=snapshot.id,
        product_id=product.id,
        code="gloves",
        name="Training gloves",
        unit="piece",
        initialized=True,
        expected_quantity=0,
        initialization_id=uuid4(),
        initialized_by=actor.id,
        initialized_at=datetime.now(timezone.utc),
    ))
    session.flush()
    session.commit()
    session.close()
    engine.dispose()


def test_capture_rollback_leaves_no_snapshot_or_items(tmp_path):
    engine, session, branch, actor, register = _snapshot_session(tmp_path)
    product = Product(code="gloves", name="Training gloves", created_by=actor.id)
    session.add(product)
    session.flush()
    capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)
    session.rollback()

    assert session.query(RegisterInventorySnapshot).count() == 0
    assert session.query(RegisterInventorySnapshotItem).count() == 0
    session.close()
    engine.dispose()
