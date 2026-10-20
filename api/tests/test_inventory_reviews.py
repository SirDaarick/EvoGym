from uuid import uuid4

from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
import pytest
from pydantic import ValidationError

from app.db.base import Base
from app.db.models import (
    Branch, CashRegister, Product, Shift, ShiftDenominationCount,
    ShiftInventoryObservation, ShiftInventoryReview, StaffUser, StockInitialization,
)
from app.inventory.queries import (
    InventorySnapshotConsumedError, InventorySnapshotStaleError,
    InventorySnapshotUnavailableError, capture_register_inventory_snapshot,
)
from app.shifts.queries import get_shift_by_id, open_shift, to_shift_dto
from app.shifts.schemas import OpenShiftDTO


def test_open_shift_requires_and_preserves_inventory_snapshot_reference():
    snapshot_id = uuid4()
    payload = OpenShiftDTO.model_validate(
        {
            "cash_register_id": str(uuid4()),
            "inventory_snapshot_id": str(snapshot_id),
            "denomination_counts": [{"denomination_minor": 100, "quantity": 0}],
        }
    )

    assert payload.inventory_snapshot_id == snapshot_id
    assert payload.inventory_observations == []


def _opening_session(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'opening-review.db').as_posix()}")
    Base.metadata.create_all(engine)
    session = Session(engine)
    branch = Branch(code="opening", name="Opening")
    actor = StaffUser(login_identifier="opening@example.invalid")
    session.add_all([branch, actor])
    session.flush()
    register = CashRegister(branch_id=branch.id, code="front", name="Front")
    product = Product(code="bands", name="Resistance bands", created_by=actor.id)
    session.add_all([register, product])
    session.flush()
    return engine, session, actor, register, product


def test_opening_accepts_missing_baseline_without_fabricating_physical_count(tmp_path):
    engine, session, actor, register, product = _opening_session(tmp_path)
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)
    assert snapshot.items[0].initialized is False
    assert snapshot.items[0].expected_quantity is None

    shift = open_shift(
        session,
        register_id=register.id,
        opened_by=actor.id,
        denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
        inventory_snapshot_id=snapshot.id,
    )
    session.flush()

    review = session.scalar(select(ShiftInventoryReview).where(ShiftInventoryReview.shift_id == shift.id))
    assert review.mode == "no_changes_declared"
    assert review.confirmed_by == actor.id
    assert review.snapshot_id == snapshot.id
    assert review.observations == []
    assert to_shift_dto(shift).inventory_review.mode == "no_changes_declared"
    assert session.scalar(select(StockInitialization).where(StockInitialization.product_id == product.id)) is None
    session.rollback()
    session.close()
    engine.dispose()


def test_opening_persists_physical_observation_without_rewriting_unknown_expected_value(tmp_path):
    engine, session, actor, register, product = _opening_session(tmp_path)
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)
    shift = open_shift(
        session,
        register_id=register.id,
        opened_by=actor.id,
        denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
        inventory_snapshot_id=snapshot.id,
        inventory_observations=[{"product_id": product.id, "physical_quantity": 6}],
    )
    session.flush()

    review = shift.inventory_review
    assert review.mode == "physical_counts_reported"
    assert review.observations[0].physical_quantity == 6
    assert review.observations[0].snapshot_item.expected_quantity is None
    assert review.observations[0].snapshot_item.initialized is False
    session.rollback()
    session.close()
    engine.dispose()


def test_stale_snapshot_cannot_open_shift(tmp_path):
    engine, session, actor, register, product = _opening_session(tmp_path)
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)
    product.name = "Updated label"
    session.flush()

    with pytest.raises(InventorySnapshotStaleError):
        open_shift(
            session,
            register_id=register.id,
            opened_by=actor.id,
            denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            inventory_snapshot_id=snapshot.id,
        )
    session.rollback()
    session.close()
    engine.dispose()


def test_opening_validation_refreshes_cached_product_and_baseline_from_database(tmp_path):
    engine, opening_session, actor, register, product = _opening_session(tmp_path)
    initialization = StockInitialization(
        branch_id=register.branch_id, product_id=product.id, quantity=3, initialized_by=actor.id
    )
    opening_session.add(initialization)
    opening_session.flush()
    snapshot = capture_register_inventory_snapshot(opening_session, register_id=register.id, actor_id=actor.id)
    snapshot_id = snapshot.id
    opening_session.commit()

    cached_product = opening_session.get(Product, product.id)
    cached_initialization = opening_session.scalar(
        select(StockInitialization).where(StockInitialization.product_id == product.id)
    )
    assert cached_product.name == "Resistance bands"
    assert cached_initialization.quantity == 3

    with Session(engine) as writer:
        writer.get(Product, product.id).name = "Renamed in another session"
        writer.get(StockInitialization, cached_initialization.id).quantity = 8
        writer.commit()

    with pytest.raises(InventorySnapshotStaleError):
        open_shift(
            opening_session,
            register_id=register.id,
            opened_by=actor.id,
            denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            inventory_snapshot_id=snapshot_id,
        )
    assert cached_product.name == "Resistance bands"
    assert cached_initialization.quantity == 3
    opening_session.rollback()
    opening_session.close()
    engine.dispose()


def test_snapshot_capture_refreshes_cached_product_and_baseline_values(tmp_path):
    engine, capture_session, actor, register, product = _opening_session(tmp_path)
    initialization = StockInitialization(
        branch_id=register.branch_id, product_id=product.id, quantity=2, initialized_by=actor.id
    )
    capture_session.add(initialization)
    capture_session.commit()
    cached_product = capture_session.get(Product, product.id)
    cached_initialization = capture_session.scalar(
        select(StockInitialization).where(StockInitialization.product_id == product.id)
    )
    assert cached_product.name == "Resistance bands"
    assert cached_initialization.quantity == 2

    with Session(engine) as writer:
        writer.get(Product, product.id).name = "Current database label"
        writer.get(StockInitialization, cached_initialization.id).quantity = 9
        writer.commit()

    snapshot = capture_register_inventory_snapshot(capture_session, register_id=register.id, actor_id=actor.id)
    assert snapshot.items[0].name == "Current database label"
    assert snapshot.items[0].expected_quantity == 9
    capture_session.rollback()
    capture_session.close()
    engine.dispose()


def test_review_observations_reject_invalid_values_duplicates_and_unknown_products(tmp_path):
    engine, session, actor, register, product = _opening_session(tmp_path)
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)
    common = {
        "cash_register_id": str(register.id),
        "inventory_snapshot_id": str(snapshot.id),
        "denomination_counts": [{"denomination_minor": 100, "quantity": 0}],
    }
    for bad_quantity in (True, 1.25, "2", -1, 2**63):
        with pytest.raises(ValidationError):
            OpenShiftDTO.model_validate({
                **common,
                "inventory_observations": [{"product_id": str(product.id), "physical_quantity": bad_quantity}],
            })
    with pytest.raises(ValidationError, match="duplicate"):
        OpenShiftDTO.model_validate({
            **common,
            "inventory_observations": [
                {"product_id": str(product.id), "physical_quantity": 1},
                {"product_id": str(product.id), "physical_quantity": 2},
            ],
        })
    with pytest.raises(ValueError, match="not present"):
        open_shift(
            session, register_id=register.id, opened_by=actor.id,
            denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            inventory_snapshot_id=snapshot.id,
            inventory_observations=[{"product_id": uuid4(), "physical_quantity": 1}],
        )
    session.rollback()
    session.close()
    engine.dispose()


@pytest.mark.parametrize("invalid", [False, 0, "", {}])
def test_domain_rejects_falsey_nonlist_inventory_observations(tmp_path, invalid):
    engine, session, actor, register, _product = _opening_session(tmp_path)
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)
    with pytest.raises(ValueError, match="list"):
        open_shift(
            session, register_id=register.id, opened_by=actor.id,
            denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            inventory_snapshot_id=snapshot.id,
            inventory_observations=invalid,
        )
    session.rollback()
    session.close()
    engine.dispose()


def test_actual_empty_catalog_is_accepted_and_classified(tmp_path):
    engine, session, actor, register, product = _opening_session(tmp_path)
    session.delete(product)
    session.flush()
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)
    assert snapshot.source_state == "empty_catalog"
    shift = open_shift(
        session, register_id=register.id, opened_by=actor.id,
        denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
        inventory_snapshot_id=snapshot.id,
    )
    session.commit()
    assert to_shift_dto(get_shift_by_id(session, shift.id)).inventory_review.source_state == "empty_catalog"
    session.close()
    engine.dispose()


def test_explicit_zero_baseline_remains_initialized_zero_at_opening(tmp_path):
    engine, session, actor, register, product = _opening_session(tmp_path)
    session.add(StockInitialization(
        branch_id=register.branch_id, product_id=product.id, quantity=0, initialized_by=actor.id
    ))
    session.flush()
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)
    assert snapshot.items[0].initialized is True
    assert snapshot.items[0].expected_quantity == 0
    shift = open_shift(
        session, register_id=register.id, opened_by=actor.id,
        denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
        inventory_snapshot_id=snapshot.id,
    )
    assert to_shift_dto(shift).inventory_review.missing_count == 0
    assert session.scalar(select(StockInitialization).where(StockInitialization.product_id == product.id)).quantity == 0
    session.rollback()
    session.close()
    engine.dispose()


def test_snapshot_is_one_time_and_foreign_register_snapshot_is_not_accepted(tmp_path):
    engine, session, actor, register, _product = _opening_session(tmp_path)
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)
    other_register = CashRegister(branch_id=register.branch_id, code="other", name="Other")
    session.add(other_register)
    session.flush()
    with pytest.raises(InventorySnapshotUnavailableError):
        open_shift(
            session, register_id=other_register.id, opened_by=actor.id,
            denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            inventory_snapshot_id=snapshot.id,
        )
    shift = open_shift(
        session, register_id=register.id, opened_by=actor.id,
        denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
        inventory_snapshot_id=snapshot.id,
    )
    session.commit()
    other_register.status = "inactive"
    shift.status = "closed"
    session.commit()
    with pytest.raises(InventorySnapshotConsumedError):
        open_shift(
            session, register_id=register.id, opened_by=actor.id,
            denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            inventory_snapshot_id=snapshot.id,
        )
    assert get_shift_by_id(session, shift.id).inventory_review is not None
    session.rollback()
    session.close()
    engine.dispose()


def test_shift_cash_and_review_rollback_together_and_historical_shift_has_no_review(tmp_path):
    engine, session, actor, register, _product = _opening_session(tmp_path)
    historical = Shift(cash_register_id=register.id, opened_by=actor.id, opening_cash_minor=0, status="closed")
    session.add(historical)
    session.flush()
    assert historical.inventory_review is None
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)
    shift = open_shift(
        session, register_id=register.id, opened_by=actor.id,
        denomination_counts=[{"denomination_minor": 100, "quantity": 1}],
        inventory_snapshot_id=snapshot.id,
    )
    shift_id = shift.id
    session.rollback()
    assert get_shift_by_id(session, shift_id) is None
    assert session.scalar(select(ShiftInventoryReview).where(ShiftInventoryReview.snapshot_id == snapshot.id)) is None
    assert session.scalar(select(ShiftDenominationCount).where(ShiftDenominationCount.shift_id == shift_id)) is None
    session.close()
    engine.dispose()


def test_database_rejects_negative_physical_observation(tmp_path):
    engine, session, actor, register, product = _opening_session(tmp_path)
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=actor.id)
    shift = open_shift(
        session, register_id=register.id, opened_by=actor.id,
        denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
        inventory_snapshot_id=snapshot.id,
    )
    session.flush()
    session.add(ShiftInventoryObservation(
        review_id=shift.inventory_review.id,
        snapshot_item_id=snapshot.items[0].id,
        physical_quantity=-1,
    ))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()
    session.close()
    engine.dispose()
