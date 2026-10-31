"""Opt-in PostgreSQL proofs for rental occupancy, idempotency, and migration preservation."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from threading import Barrier
import os
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.db.models import (
    Branch, CashRegister, Member, Payment, PaymentReviewEvent, Rental, RentalCardAttempt,
    RentalCharge, RentalAsset, StaffUser,
)
from app.inventory.queries import capture_register_inventory_snapshot
from app.rentals.payments import RentalConflictError, active_rental_id
from app.rentals.queries import (
    apply_card_attempt, begin_card_attempt, confirm_cancellation, create_rental,
    preview_cancellation, record_receivable_payment, renew_rental, review_transfer,
)
from app.rentals.schemas import TenderComponentInput
from app.shifts.queries import open_shift

API_DIR = os.path.dirname(os.path.dirname(__file__))
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def _configured_url() -> str:
    configured = os.getenv("EVOGYM_TEST_POSTGRES_URL")
    if not configured:
        pytest.skip("Set EVOGYM_TEST_POSTGRES_URL to a disposable local PostgreSQL instance.")
    base_url = make_url(configured)
    if not base_url.drivername.startswith("postgresql+") or base_url.host not in LOOPBACK_HOSTS:
        pytest.fail("PostgreSQL rental tests require a loopback-only disposable target.")
    return configured


@pytest.fixture
def postgres_rental_target(monkeypatch):
    base_url = make_url(_configured_url())
    schema = f"rentals_{uuid4().hex}"
    admin_engine = create_engine(base_url)
    try:
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        scoped_url = base_url.update_query_dict({
            "options": f"-csearch_path={schema} -c lock_timeout=3000 -c statement_timeout=10000"
        })
        monkeypatch.setenv("EVOGYM_ENV", "test")
        monkeypatch.setenv("EVOGYM_DEBUG", "false")
        monkeypatch.setenv("EVOGYM_DATABASE_URL", scoped_url.render_as_string(hide_password=False))
        command.upgrade(Config(os.path.join(API_DIR, "alembic.ini")), "head")
        engine = create_engine(scoped_url)
        factory = sessionmaker(engine)
        with factory.begin() as session:
            branch = Branch(code=f"rent-{uuid4().hex[:8]}", name="Rental Branch", timezone="America/Tijuana")
            staff = StaffUser(login_identifier=f"{uuid4()}@example.invalid")
            other_staff = StaffUser(login_identifier=f"{uuid4()}@example.invalid")
            member = Member(member_number=f"SOC-{uuid4().hex[:12]}", full_name="Rental Member", phone="5550100")
            session.add_all([branch, staff, other_staff, member])
            session.flush()
            asset = RentalAsset(branch_id=branch.id, kind="glove", code=f"g-{uuid4().hex[:8]}",
                                color="Red", ounces=12, price_minor=2500, created_by=staff.id)
            locker = RentalAsset(branch_id=branch.id, kind="locker", code=f"l-{uuid4().hex[:8]}",
                                 locker_number=1, price_minor=15000, created_by=staff.id)
            register = CashRegister(branch_id=branch.id, code=f"rent-{uuid4().hex[:8]}", name="Rental Register")
            session.add_all([asset, locker, register])
            session.flush()
            snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=staff.id)
            open_shift(session, register_id=register.id, opened_by=staff.id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
                       inventory_snapshot_id=snapshot.id)
            ids = (branch.id, staff.id, member.id, asset.id, register.id, other_staff.id, locker.id)
        yield factory, ids
        engine.dispose()
    finally:
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin_engine.dispose()


def _rent(factory, ids, key, *, actor_index=1, kind="glove", asset_index=4, components=None,
          expected_total_minor=2500, accepted_shortfall_minor=2500):
    branch_id, staff_id, member_id, _glove_id, register_id, other_staff_id, _locker_id = ids
    asset_id = _locker_id if kind == "locker" else _glove_id
    actor_id = other_staff_id if actor_index == 2 else staff_id
    with factory.begin() as session:
        rental, replayed = create_rental(
            session, kind=kind, branch_id=branch_id, asset_id=asset_id, member_id=member_id,
            register_id=register_id, actor_id=actor_id, authorized_branch_id=branch_id,
            components=components if components is not None else [
                TenderComponentInput(method="cash", amount_minor=1000)],
            idempotency_key=key,
            expected_total_minor=expected_total_minor,
            accepted_shortfall_minor=accepted_shortfall_minor,
        )
        return rental.id, replayed


def test_rental_idempotency_and_active_asset_exclusivity(postgres_rental_target):
    factory, ids = postgres_rental_target
    first_id, replayed = _rent(factory, ids, "race-key")
    assert replayed is False
    same_id, replayed = _rent(factory, ids, "race-key")
    assert replayed is True and same_id == first_id

    barrier = Barrier(2)

    def attempt(key):
        barrier.wait()
        try:
            return _rent(factory, ids, key)[0]
        except RentalConflictError:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, ("race-a", "race-b")))
    assert results == [None, None]


def test_rental_migration_0048_preserves_assets_on_postgres(monkeypatch):
    base_url = make_url(_configured_url())
    schema = f"rental_migration_{uuid4().hex}"
    admin_engine = create_engine(base_url)
    try:
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        scoped_url = base_url.update_query_dict({"options": f"-csearch_path={schema}"})
        monkeypatch.setenv("EVOGYM_ENV", "test")
        monkeypatch.setenv("EVOGYM_DEBUG", "false")
        monkeypatch.setenv("EVOGYM_DATABASE_URL", scoped_url.render_as_string(hide_password=False))
        config = Config(os.path.join(API_DIR, "alembic.ini"))
        command.upgrade(config, "0047_rental_assets")
        engine = create_engine(scoped_url)
        try:
            with engine.begin() as connection:
                connection.execute(text(
                    "INSERT INTO branches (id, code, name) VALUES (:id, 'legacy', 'Legacy')"),
                    {"id": uuid4().hex})
                connection.execute(text(
                    "INSERT INTO staff_users (id, login_identifier) VALUES (:id, 'legacy@example.invalid')"),
                    {"id": uuid4().hex})
                branch_id, staff_id = uuid4().hex, uuid4().hex
                connection.execute(text(
                    "INSERT INTO branches (id, code, name) VALUES (:id, 'legacy2', 'Legacy 2')"),
                    {"id": branch_id})
                connection.execute(text(
                    "INSERT INTO staff_users (id, login_identifier) VALUES (:id, 'legacy2@example.invalid')"),
                    {"id": staff_id})
                connection.execute(text(
                    "INSERT INTO rental_assets (id, branch_id, kind, code, price_minor, status, color, ounces, created_by) "
                    "VALUES (:id, :branch, 'glove', 'legacy-glove', 2500, 'available', 'Red', 12, :staff)"),
                    {"id": uuid4().hex, "branch": branch_id, "staff": staff_id})
            command.upgrade(config, "head")
            assert {"rentals", "rental_charges", "rental_cancellations", "rental_card_attempts"} <= set(
                inspect(engine).get_table_names())
            assert {"rental_charge_id", "register_id", "shift_id", "idempotency_key"} <= {
                column["name"] for column in inspect(engine).get_columns("payments")}
            with engine.connect() as connection:
                assert connection.execute(text("SELECT code FROM rental_assets")).scalar_one() == "legacy-glove"
                assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0048_rental_lifecycle"
        finally:
            engine.dispose()
    finally:
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin_engine.dispose()


def test_concurrent_different_actor_repayments_never_overpay(postgres_rental_target):
    factory, ids = postgres_rental_target
    branch_id, staff_id, _member_id, _glove_id, register_id, other_staff_id, _locker_id = ids
    rental_id, _ = _rent(factory, ids, "repay-race", components=[], accepted_shortfall_minor=2500)

    barrier = Barrier(2)

    def pay(actor_id, key):
        barrier.wait()
        try:
            with factory.begin() as session:
                _payment, remaining, _replayed = record_receivable_payment(
                    session, rental_id=rental_id, register_id=register_id, actor_id=actor_id,
                    authorized_branch_id=branch_id, method="cash", amount_minor=2000,
                    idempotency_key=key,
                )
                return remaining
        except RentalConflictError:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda item: pay(*item), [(staff_id, "repay-a"), (other_staff_id, "repay-b")]))

    assert sorted(value for value in results if value is not None) == [500]
    with factory() as session:
        confirmed = session.scalar(select(func.sum(Payment.amount_minor)).where(
            Payment.rental_charge_id.in_(select(RentalCharge.id).where(RentalCharge.rental_id == rental_id)),
            Payment.status == "confirmed"))
        assert confirmed == 2000


def test_concurrent_renewal_and_cancellation_with_different_actors_stay_consistent(postgres_rental_target):
    factory, ids = postgres_rental_target
    branch_id, staff_id, _member_id, _glove_id, register_id, other_staff_id, _locker_id = ids
    rental_id, _ = _rent(factory, ids, "renew-cancel-race", kind="locker", components=[
        TenderComponentInput(method="cash", amount_minor=15000)],
        expected_total_minor=15000, accepted_shortfall_minor=0)
    with factory() as session:
        preview = preview_cancellation(session, rental_id=rental_id, authorized_branch_id=branch_id)
        preview_token = preview.preview_token

    barrier = Barrier(2)

    def renew():
        barrier.wait()
        try:
            with factory.begin() as session:
                renew_rental(
                    session, rental_id=rental_id, register_id=register_id, actor_id=staff_id,
                    authorized_branch_id=branch_id, components=[],
                    expected_total_minor=15000, accepted_shortfall_minor=15000,
                    idempotency_key="renew-race",
                )
            return "renewed"
        except RentalConflictError:
            return "conflict"

    def cancel():
        barrier.wait()
        try:
            with factory.begin() as session:
                confirm_cancellation(
                    session, rental_id=rental_id, register_id=register_id, actor_id=other_staff_id,
                    authorized_branch_id=branch_id, preview_token=preview_token,
                    refund_amount_minor=0, refund_method="cash", reason="Race cancellation",
                    idempotency_key="cancel-race",
                )
            return "cancelled"
        except RentalConflictError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = {future: future.result() for future in [pool.submit(renew), pool.submit(cancel)]}
    values = list(outcomes.values())
    assert values.count("conflict") == 1
    with factory() as session:
        rental = session.get(Rental, rental_id)
        charge_count = session.scalar(select(func.count()).select_from(RentalCharge).where(
            RentalCharge.rental_id == rental_id))
        if "cancelled" in values:
            assert rental.status == "cancelled"
            assert charge_count == 1
        else:
            assert rental.status == "active"
            assert charge_count == 2


def test_concurrent_card_settlement_and_repayment_reconcile_without_overpay(postgres_rental_target):
    factory, ids = postgres_rental_target
    branch_id, staff_id, _member_id, _glove_id, register_id, other_staff_id, _locker_id = ids
    rental_id, _ = _rent(factory, ids, "card-repay-race", components=[
        TenderComponentInput(method="cash", amount_minor=1000)], accepted_shortfall_minor=1500)
    with factory.begin() as session:
        attempt, _ = begin_card_attempt(
            session, rental_id=rental_id, charge_id=session.scalar(
                select(RentalCharge.id).where(RentalCharge.rental_id == rental_id)),
            register_id=register_id, actor_id=staff_id, authorized_branch_id=branch_id,
            amount_minor=500, terminal_id=None, idempotency_key="card-race",
        )
        attempt_id = attempt.id

    barrier = Barrier(2)

    def settle():
        barrier.wait()
        with factory.begin() as session:
            apply_card_attempt(session, attempt_id=attempt_id, provider_status="PROCESSED",
                               authorization_code="AUTH", card_brand="VISA", card_last_four="4242",
                               provider_payment_id="provider-race")
        return "settled"

    def repay():
        barrier.wait()
        try:
            with factory.begin() as session:
                record_receivable_payment(
                    session, rental_id=rental_id, register_id=register_id, actor_id=other_staff_id,
                    authorized_branch_id=branch_id, method="cash", amount_minor=1000,
                    idempotency_key="repay-race-card",
                )
            return "paid"
        except RentalConflictError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        values = [future.result() for future in [pool.submit(settle), pool.submit(repay)]]
    assert "settled" in values
    with factory() as session:
        confirmed = session.scalar(select(func.sum(Payment.amount_minor)).where(
            Payment.rental_charge_id.in_(select(RentalCharge.id).where(RentalCharge.rental_id == rental_id)),
            Payment.status == "confirmed"))
        assert confirmed == 2500


def test_concurrent_transfer_review_and_cancellation_do_not_resurrect_cancelled_debt(postgres_rental_target):
    factory, ids = postgres_rental_target
    branch_id, staff_id, _member_id, _glove_id, register_id, other_staff_id, _locker_id = ids
    rental_id, _ = _rent(factory, ids, "review-cancel-race", kind="locker", components=[
        TenderComponentInput(method="transfer", amount_minor=3000)],
        expected_total_minor=15000, accepted_shortfall_minor=12000)
    with factory() as session:
        payment_id = session.scalar(select(Payment.id).where(
            Payment.rental_charge_id.in_(select(RentalCharge.id).where(RentalCharge.rental_id == rental_id))))
        preview_token = preview_cancellation(
            session, rental_id=rental_id, authorized_branch_id=branch_id).preview_token

    barrier = Barrier(2)

    def review():
        barrier.wait()
        try:
            with factory.begin() as session:
                review_transfer(session, payment_id=payment_id, actor_id=staff_id,
                                status="confirmed", idempotency_key="review-race")
            return "reviewed"
        except (RentalConflictError, ValueError):
            return "conflict"

    def cancel():
        barrier.wait()
        try:
            with factory.begin() as session:
                confirm_cancellation(
                    session, rental_id=rental_id, register_id=register_id, actor_id=other_staff_id,
                    authorized_branch_id=branch_id, preview_token=preview_token,
                    refund_amount_minor=0, refund_method="cash", reason="Race cancellation",
                    idempotency_key="cancel-review-race",
                )
            return "cancelled"
        except RentalConflictError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        values = [future.result() for future in [pool.submit(review), pool.submit(cancel)]]
    assert values.count("conflict") <= 1
    with factory() as session:
        rental = session.get(Rental, rental_id)
        payment = session.get(Payment, payment_id)
        review_events = session.scalar(select(func.count()).select_from(PaymentReviewEvent).where(
            PaymentReviewEvent.payment_id == payment_id))
        assert review_events == 1
        assert payment.status == "confirmed"
        if rental.status == "cancelled":
            assert PaymentReviewEvent is not None
        else:
            assert rental.status == "active"
