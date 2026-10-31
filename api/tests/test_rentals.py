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
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


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


# ==============================================================================
# Rental lifecycle contracts
# ==============================================================================

from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.db.models import (
    Branch, CashRegister, Member, Order, Payment, PaymentReviewEvent, Rental, RentalAsset,
    RentalCancellation, RentalCardAttempt, RentalCharge, Shift, StaffCredential,
    StaffRosterProfile, StaffUser,
)
from app.rentals.payments import local_today, month_end
from app.sales.point import MockPointTerminalClient, PointPaymentIntentDTO
from app.shifts.queries import create_cash_register


@pytest.fixture
def rental_world(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    seed_admin(factory)
    branch = _seed_branch(factory, "rental-world", "Rental World")
    other = _seed_branch(factory, "rental-world-other", "Other Rental World")
    actor, token = _seed_receptionist(factory, branch, "rental-world@example.invalid")
    with factory.begin() as session:
        member = Member(member_number="SOC-RENT-1", full_name="Rental Member", phone="5550001")
        other_member = Member(member_number="SOC-RENT-2", full_name="Other Rental Member", phone="5550002")
        session.add_all([member, other_member])
        session.flush()
        glove = RentalAsset(branch_id=branch, kind="glove", code="g-01", color="Red", ounces=12,
                            price_minor=2500, created_by=actor)
        locker = RentalAsset(branch_id=branch, kind="locker", code="l-01", locker_number=1,
                             price_minor=15000, created_by=actor)
        session.add_all([glove, locker])
        session.flush()
        register = create_cash_register(session, branch, "rental-register", "Rental Register")
        open_shift(session, register_id=register.id, opened_by=actor,
                   denomination_counts=[{"denomination_minor": 100, "quantity": 0}])
        ids = {"member": member.id, "other_member": other_member.id, "glove": glove.id,
               "locker": locker.id, "register": register.id}
    delivery = FakeRecoveryDelivery()
    try:
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            yield client, factory, branch, other, actor, token, ids, approved_admin_headers(client, delivery)
    finally:
        engine.dispose()


def _staff(token):
    return {"Authorization": f"Bearer {token}", "Idempotency-Key": "rental-key"}


def _rent_glove(client, token, branch, ids, components=None, key="glove-rent-1",
                expected_total_minor=2500, accepted_shortfall_minor=None):
    components = components or []
    if accepted_shortfall_minor is None:
        accepted_shortfall_minor = expected_total_minor - sum(item["amount_minor"] for item in components)
    return client.post(
        "/api/v1/rentals/gloves",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": key},
        json={"branch_id": str(branch), "asset_id": str(ids["glove"]), "member_id": str(ids["member"]),
              "register_id": str(ids["register"]), "components": components,
              "expected_total_minor": expected_total_minor,
              "accepted_shortfall_minor": accepted_shortfall_minor},
    )


def _assign_locker(client, token, branch, ids, components=None, key="locker-assign-1",
                   expected_total_minor=15000, accepted_shortfall_minor=None):
    components = components or []
    if accepted_shortfall_minor is None:
        accepted_shortfall_minor = expected_total_minor - sum(item["amount_minor"] for item in components)
    return client.post(
        "/api/v1/rentals/lockers",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": key},
        json={"branch_id": str(branch), "asset_id": str(ids["locker"]), "member_id": str(ids["member"]),
              "register_id": str(ids["register"]), "components": components,
              "expected_total_minor": expected_total_minor,
              "accepted_shortfall_minor": accepted_shortfall_minor},
    )


def test_glove_rental_records_mixed_tender_shortfall_repayment_and_return(rental_world):
    client, factory, branch, _other, _actor, token, ids, admin = rental_world
    rented = _rent_glove(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 1000}])
    assert rented.status_code == 201, rented.text
    body = rented.json()
    rental_id = body["id"]
    assert body["status"] == "active" and body["kind"] == "glove"
    assert body["paid_minor"] == 1000 and body["outstanding_minor"] == 1500
    assert body["charges"][0]["amount_minor"] == 2500
    assert body["charges"][0]["outstanding_minor"] == 1500

    replay = _rent_glove(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 1000}])
    assert replay.status_code == 200 and replay.json()["id"] == rental_id
    conflict = _rent_glove(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 900}],
                           key="other-key")
    assert conflict.status_code == 409

    assets = client.get(f"/api/v1/rentals/assets?branch_id={branch}&kind=glove",
                        headers={"Authorization": f"Bearer {token}"})
    assert assets.json()["items"][0]["active_rental_id"] == rental_id

    receipt = client.post(
        f"/api/v1/rentals/{rental_id}/receivable-payments",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "glove-repay-1"},
        json={"register_id": str(ids["register"]), "method": "cash", "amount_minor": 500},
    )
    assert receipt.status_code == 201, receipt.text
    assert receipt.json()["remaining_minor"] == 1000
    replay_receipt = client.post(
        f"/api/v1/rentals/{rental_id}/receivable-payments",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "glove-repay-1"},
        json={"register_id": str(ids["register"]), "method": "cash", "amount_minor": 500},
    )
    assert replay_receipt.status_code == 200
    too_much = client.post(
        f"/api/v1/rentals/{rental_id}/receivable-payments",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "glove-repay-2"},
        json={"register_id": str(ids["register"]), "method": "cash", "amount_minor": 1001},
    )
    assert too_much.status_code == 409

    returned = client.post(f"/api/v1/rentals/{rental_id}/return",
                           headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "glove-return-1"})
    assert returned.status_code == 200, returned.text
    assert returned.json()["status"] == "returned"
    assert returned.json()["outstanding_minor"] == 1000
    replay_return = client.post(f"/api/v1/rentals/{rental_id}/return",
                                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "glove-return-1"})
    assert replay_return.status_code == 200 and replay_return.json()["id"] == rental_id

    page = client.get(f"/api/v1/rentals?branch_id={branch}&status=returned",
                      headers={"Authorization": f"Bearer {token}"})
    assert page.status_code == 200 and page.json()["total"] == 1

    summary = client.get(f"/api/v1/shifts/{_open_shift_id(factory, branch)}/summary",
                         headers={"Authorization": f"Bearer {token}"})
    assert summary.status_code == 200, summary.text
    assert summary.json()["confirmed_cash_minor"] == 1500

    pending = client.get("/api/v1/admin/pending-money", headers=admin)
    rental_items = [item for item in pending.json()["items"] if item["item_type"] == "rental_receivable"]
    assert len(rental_items) == 1
    assert rental_items[0]["amount_minor"] == 1000
    assert rental_items[0]["order_id"] is None
    assert rental_items[0]["rental_id"] == rental_id

    reloaded = client.get(f"/api/v1/members/{ids['member']}/reload?branch_id={branch}", headers=admin)
    assert reloaded.status_code == 200, reloaded.text
    financial = reloaded.json()["financial"]
    assert financial["has_pending_balance"] is True
    assert financial["rental_pending_balance_minor"] == 1000
    assert len(financial["rental_debts"]) == 1
    assert financial["debts"] == []


def _open_shift_id(factory, branch):
    with factory() as session:
        return str(session.scalar(select(Shift.id).join(CashRegister).where(CashRegister.branch_id == branch)))


def test_locker_renewal_snapshots_price_and_physical_release_frees_asset(rental_world):
    client, factory, branch, _other, _actor, token, ids, admin = rental_world
    assigned = _assign_locker(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 15000}])
    assert assigned.status_code == 201, assigned.text
    locker = assigned.json()
    rental_id = locker["id"]
    first_period = (locker["starts_on"], locker["ends_on"])
    assert locker["outstanding_minor"] == 0

    price_change = client.patch(f"/api/v1/rentals/assets/{ids['locker']}", headers=admin,
                                json={"price_minor": 18000})
    assert price_change.status_code == 200, price_change.text

    renewed = client.post(
        f"/api/v1/rentals/{rental_id}/renewals",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "locker-renew-1"},
        json={"register_id": str(ids["register"]), "components": [{"method": "cash", "amount_minor": 18000}],
              "expected_total_minor": 18000, "accepted_shortfall_minor": 0},
    )
    assert renewed.status_code == 201, renewed.text
    body = renewed.json()
    assert [charge["amount_minor"] for charge in body["charges"]] == [15000, 18000]
    assert body["charges"][1]["starts_on"] == first_period[1]
    assert body["outstanding_minor"] == 0

    replay = client.post(
        f"/api/v1/rentals/{rental_id}/renewals",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "locker-renew-1"},
        json={"register_id": str(ids["register"]), "components": [{"method": "cash", "amount_minor": 18000}],
              "expected_total_minor": 18000, "accepted_shortfall_minor": 0},
    )
    assert replay.status_code == 200 and len(replay.json()["charges"]) == 2

    with factory() as session:
        assert session.scalar(select(func.count()).select_from(RentalCharge)) == 2

    released = client.post(f"/api/v1/rentals/{rental_id}/release",
                           headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "locker-release-1"})
    assert released.status_code == 200, released.text
    assert released.json()["status"] == "released"
    assert released.json()["outstanding_minor"] == 0

    assets = client.get(f"/api/v1/rentals/assets?branch_id={branch}&kind=locker",
                        headers={"Authorization": f"Bearer {token}"})
    assert assets.json()["items"][0]["active_rental_id"] is None
    again = _assign_locker(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 18000}],
                           key="locker-assign-2", expected_total_minor=18000)
    assert again.status_code == 201, again.text


def test_locker_cancellation_preview_confirm_refund_debt_and_admin_review(rental_world):
    client, factory, branch, _other, _actor, token, ids, admin = rental_world
    assigned = _assign_locker(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 3000}])
    assert assigned.status_code == 201, assigned.text
    rental_id = assigned.json()["id"]

    preview = client.get(f"/api/v1/rentals/{rental_id}/cancellation-preview",
                         headers={"Authorization": f"Bearer {token}"})
    assert preview.status_code == 200, preview.text
    facts = preview.json()
    assert facts["can_cancel"] is True
    assert facts["settled_minor"] == 3000
    assert facts["max_refundable_minor"] == 3000
    assert 0 <= facts["suggested_refund_minor"] <= 3000
    assert facts["outstanding_minor"] == 12000
    assert facts["cancelled_debt_minor"] == 12000
    token_value = facts["preview_token"]

    rejected = client.post(
        f"/api/v1/rentals/{rental_id}/cancellation",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "cancel-0"},
        json={"register_id": str(ids["register"]), "preview_token": token_value,
              "refund_amount_minor": 3001, "refund_method": "cash", "reason": "Early cancellation"},
    )
    assert rejected.status_code == 409
    no_reason = client.post(
        f"/api/v1/rentals/{rental_id}/cancellation",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "cancel-1"},
        json={"register_id": str(ids["register"]), "preview_token": token_value,
              "refund_amount_minor": 500, "refund_method": "cash"},
    )
    assert no_reason.status_code == 422

    confirmed = client.post(
        f"/api/v1/rentals/{rental_id}/cancellation",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "cancel-1"},
        json={"register_id": str(ids["register"]), "preview_token": token_value,
              "refund_amount_minor": 500, "refund_method": "cash", "reason": "Early cancellation"},
    )
    assert confirmed.status_code == 201, confirmed.text
    cancellation = confirmed.json()
    assert cancellation["refund_amount_minor"] == 500
    assert cancellation["cancelled_debt_minor"] == 12000
    assert cancellation["reviewed"] is False
    replay = client.post(
        f"/api/v1/rentals/{rental_id}/cancellation",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "cancel-1"},
        json={"register_id": str(ids["register"]), "preview_token": token_value,
              "refund_amount_minor": 500, "refund_method": "cash", "reason": "Early cancellation"},
    )
    assert replay.status_code == 200 and replay.json()["id"] == cancellation["id"]

    detail = client.get(f"/api/v1/rentals/{rental_id}", headers={"Authorization": f"Bearer {token}"})
    assert detail.json()["status"] == "cancelled"
    assert detail.json()["outstanding_minor"] == 0
    assert detail.json()["cancelled_debt_minor"] == 12000
    assets = client.get(f"/api/v1/rentals/assets?branch_id={branch}&kind=locker",
                        headers={"Authorization": f"Bearer {token}"})
    assert assets.json()["items"][0]["active_rental_id"] is None

    denied = client.get(f"/api/v1/rentals/alerts?branch_id={branch}",
                        headers={"Authorization": f"Bearer {token}"})
    assert denied.status_code == 403
    alerts = client.get(f"/api/v1/rentals/alerts?branch_id={branch}", headers=admin)
    assert alerts.status_code == 200, alerts.text
    assert alerts.json()["total"] == 1
    reviewed = client.post(f"/api/v1/rentals/alerts/{cancellation['id']}/review", headers=admin)
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["reviewed"] is True and reviewed.json()["reviewed_at"] is not None
    repeat = client.post(f"/api/v1/rentals/alerts/{cancellation['id']}/review", headers=admin)
    assert repeat.status_code == 200 and repeat.json()["reviewed_at"] == reviewed.json()["reviewed_at"]

    summary = client.get(f"/api/v1/shifts/{_open_shift_id(factory, branch)}/summary",
                         headers={"Authorization": f"Bearer {token}"})
    assert summary.status_code == 200, summary.text
    assert summary.json()["expected_cash_minor"] == 2500


def test_cancellation_rejects_stale_preview_after_new_repayment(rental_world):
    client, _factory, branch, _other, _actor, token, ids, _admin = rental_world
    assigned = _assign_locker(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 3000}])
    rental_id = assigned.json()["id"]
    preview = client.get(f"/api/v1/rentals/{rental_id}/cancellation-preview",
                         headers={"Authorization": f"Bearer {token}"}).json()
    receipt = client.post(
        f"/api/v1/rentals/{rental_id}/receivable-payments",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "stale-repayment"},
        json={"register_id": str(ids["register"]), "method": "cash", "amount_minor": 1000},
    )
    assert receipt.status_code == 201, receipt.text
    stale = client.post(
        f"/api/v1/rentals/{rental_id}/cancellation",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "stale-cancel"},
        json={"register_id": str(ids["register"]), "preview_token": preview["preview_token"],
              "refund_amount_minor": 0, "refund_method": "cash", "reason": "Stale preview"},
    )
    assert stale.status_code == 409
    fresh = client.get(f"/api/v1/rentals/{rental_id}/cancellation-preview",
                       headers={"Authorization": f"Bearer {token}"}).json()
    confirmed = client.post(
        f"/api/v1/rentals/{rental_id}/cancellation",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "fresh-cancel"},
        json={"register_id": str(ids["register"]), "preview_token": fresh["preview_token"],
              "refund_amount_minor": 0, "refund_method": "card", "reason": "No refund requested"},
    )
    assert confirmed.status_code == 201, confirmed.text
    assert confirmed.json()["refund_method"] == "card"


def test_payment_ownership_check_preserves_legacy_order_uniqueness(rental_world):
    client, factory, branch, _other, _actor, token, ids, _admin = rental_world
    rented = _rent_glove(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 1000}])
    assert rented.status_code == 201, rented.text
    with factory() as session:
        charge_id = session.scalar(select(RentalCharge.id))
        register_id = ids["register"]
        shift_id = session.scalar(select(Shift.id).where(Shift.cash_register_id == register_id))
        legacy_order = Order(branch_id=branch, register_id=register_id, shift_id=shift_id,
                             member_id=ids["member"], seller_id=_actor, idempotency_key="legacy",
                             request_fingerprint="a" * 64, total_minor=100, order_kind="product")
        session.add(legacy_order)
        session.flush()
        both = Payment(order_id=legacy_order.id, rental_charge_id=charge_id, method="cash",
                       status="confirmed", amount_minor=100, received_by=_actor)
        session.add(both)
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()
    with factory() as session:
        neither = Payment(order_id=None, rental_charge_id=None, method="cash", status="confirmed",
                          amount_minor=100, received_by=_actor)
        session.add(neither)
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()
    with factory() as session:
        charge_id = session.scalar(select(RentalCharge.id))
        register_id = ids["register"]
        shift_id = session.scalar(select(Shift.id).where(Shift.cash_register_id == register_id))
        legacy_order = Order(branch_id=branch, register_id=register_id, shift_id=shift_id,
                             member_id=ids["member"], seller_id=_actor, idempotency_key="legacy-2",
                             request_fingerprint="b" * 64, total_minor=100, order_kind="product")
        session.add(legacy_order)
        session.flush()
        session.add(Payment(order_id=legacy_order.id, method="cash", status="confirmed",
                            amount_minor=100, received_by=_actor))
        session.flush()
        session.add(Payment(order_id=legacy_order.id, method="cash", status="confirmed",
                            amount_minor=100, received_by=_actor))
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()


def test_admin_patch_cannot_override_active_occupancy(rental_world):
    client, _factory, branch, _other, _actor, token, ids, admin = rental_world
    rented = _rent_glove(client, token, branch, ids)
    assert rented.status_code == 201, rented.text
    blocked_status = client.patch(f"/api/v1/rentals/assets/{ids['glove']}", headers=admin,
                                  json={"status": "out_of_service"})
    assert blocked_status.status_code == 409
    blocked_code = client.patch(f"/api/v1/rentals/assets/{ids['glove']}", headers=admin,
                                json={"code": "g-99"})
    assert blocked_code.status_code == 409
    price = client.patch(f"/api/v1/rentals/assets/{ids['glove']}", headers=admin, json={"price_minor": 3000})
    assert price.status_code == 200


def test_card_attempts_fail_closed_without_provider_and_do_not_resurrect_cancelled_rental(rental_world):
    client, factory, branch, _other, _actor, token, ids, _admin = rental_world
    rented = _rent_glove(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 1000}])
    rental_id = rented.json()["id"]
    charge_id = rented.json()["charges"][0]["id"]
    path = f"/api/v1/rentals/{rental_id}/charges/{charge_id}/card-attempts"

    unavailable = client.post(path, headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "card-0"},
                              json={"register_id": str(ids["register"]), "amount_minor": 500})
    assert unavailable.status_code == 503
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(RentalCardAttempt)) == 0

    fake = MockPointTerminalClient(auto_process=False)
    client.app.state.rental_point_client = fake
    pending = client.post(path, headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "card-1"},
                          json={"register_id": str(ids["register"]), "amount_minor": 500})
    assert pending.status_code == 201, pending.text
    attempt_id = pending.json()["id"]
    assert pending.json()["status"] == "pending"
    assert pending.json()["payment_id"] is None

    locker = _assign_locker(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 3000}])
    locker_id = locker.json()["id"]
    preview = client.get(f"/api/v1/rentals/{locker_id}/cancellation-preview",
                         headers={"Authorization": f"Bearer {token}"}).json()
    cancelled = client.post(
        f"/api/v1/rentals/{locker_id}/cancellation",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "cancel-card"},
        json={"register_id": str(ids["register"]), "preview_token": preview["preview_token"],
              "refund_amount_minor": 0, "refund_method": "cash", "reason": "Member left"},
    )
    assert cancelled.status_code == 201, cancelled.text

    fake.auto_process = True
    delayed = client.get(f"/api/v1/rentals/card-attempts/{attempt_id}",
                         headers={"Authorization": f"Bearer {token}"})
    assert delayed.status_code == 200, delayed.text
    assert delayed.json()["status"] == "confirmed"
    assert delayed.json()["payment_id"] is not None
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(Payment).where(
            Payment.rental_charge_id == UUID(charge_id), Payment.method == "card")) == 1

    glove_attempt = client.post(
        f"/api/v1/rentals/{locker_id}/charges/{preview['periods'][0]['charge_id']}/card-attempts",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "card-cancelled"},
        json={"register_id": str(ids["register"]), "amount_minor": 100},
    )
    assert glove_attempt.status_code == 409


def test_rental_migration_0048_preserves_populated_assets_and_adds_payment_ownership(tmp_path, monkeypatch):
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    url = f"sqlite+pysqlite:///{(tmp_path / 'rental-migration.db').as_posix()}"
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", url)
    command.upgrade(config, "0047_rental_assets")
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO branches (id, code, name) VALUES (:id, 'legacy', 'Legacy')"),
                               {"id": "b" * 32})
            connection.execute(text(
                "INSERT INTO staff_users (id, login_identifier) VALUES (:id, 'legacy@example.invalid')"),
                {"id": "c" * 32})
            connection.execute(text(
                "INSERT INTO rental_assets (id, branch_id, kind, code, price_minor, status, color, ounces, created_by) "
                "VALUES (:id, :branch, 'glove', 'legacy-glove', 2500, 'available', 'Red', 12, :staff)"),
                {"id": "d" * 32, "branch": "b" * 32, "staff": "c" * 32})
        command.upgrade(config, "head")
        tables = set(inspect(engine).get_table_names())
        assert {"rentals", "rental_charges", "rental_cancellations", "rental_card_attempts"} <= tables
        payment_columns = {column["name"] for column in inspect(engine).get_columns("payments")}
        assert {"rental_charge_id", "register_id", "shift_id", "idempotency_key"} <= payment_columns
        with engine.connect() as connection:
            assert connection.execute(text("SELECT code FROM rental_assets")).scalar_one() == "legacy-glove"
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0048_rental_lifecycle"
    finally:
        engine.dispose()


# ==============================================================================
# Correction batch: transfer review, card binding, allocation, asset state, periods
# ==============================================================================


def test_pending_transfer_stays_unsettled_and_admin_review_settles_once(rental_world):
    client, factory, branch, _other, actor, token, ids, admin = rental_world
    rented = _rent_glove(
        client, token, branch, ids,
        components=[{"method": "transfer", "amount_minor": 1000}],
    )
    assert rented.status_code == 201, rented.text
    body = rented.json()
    rental_id = body["id"]
    assert body["paid_minor"] == 0
    assert body["outstanding_minor"] == 2500
    assert body["charges"][0]["outstanding_minor"] == 2500

    pending = client.get("/api/v1/admin/pending-money", headers=admin).json()
    rental_items = [item for item in pending["items"] if item.get("rental_id") == rental_id]
    assert sum(item["amount_minor"] for item in rental_items) == 2500
    assert {item["item_type"] for item in rental_items} == {"rental_receivable", "pending_transfer"}
    transfer_item = next(item for item in rental_items if item["item_type"] == "pending_transfer")
    payment_id = transfer_item["source_event_id"]

    denied = client.post(
        f"/api/v1/rentals/receivables/{payment_id}/review",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "review-1"},
        json={"status": "confirmed"},
    )
    assert denied.status_code == 403

    confirmed = client.post(
        f"/api/v1/rentals/receivables/{payment_id}/review",
        headers={**admin, "Idempotency-Key": "review-1"},
        json={"status": "confirmed"},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"
    replay = client.post(
        f"/api/v1/rentals/receivables/{payment_id}/review",
        headers={**admin, "Idempotency-Key": "review-1"},
        json={"status": "confirmed"},
    )
    assert replay.status_code == 200 and replay.json()["status"] == "confirmed"

    detail = client.get(f"/api/v1/rentals/{rental_id}",
                        headers={"Authorization": f"Bearer {token}"}).json()
    assert detail["paid_minor"] == 1000
    assert detail["outstanding_minor"] == 1500
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(PaymentReviewEvent).where(
            PaymentReviewEvent.payment_id == UUID(payment_id))) == 1


def test_pending_transfer_rejection_review_and_cancellation_are_safe(rental_world):
    client, factory, branch, _other, _actor, token, ids, admin = rental_world
    assigned = _assign_locker(
        client, token, branch, ids,
        components=[{"method": "transfer", "amount_minor": 3000}],
    )
    assert assigned.status_code == 201, assigned.text
    rental_id = assigned.json()["id"]
    assert assigned.json()["outstanding_minor"] == 15000

    preview = client.get(f"/api/v1/rentals/{rental_id}/cancellation-preview",
                         headers={"Authorization": f"Bearer {token}"}).json()
    assert preview["can_cancel"] is False
    blocked = client.post(
        f"/api/v1/rentals/{rental_id}/cancellation",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "cancel-pending"},
        json={"register_id": str(ids["register"]), "preview_token": preview["preview_token"],
              "refund_amount_minor": 0, "refund_method": "cash", "reason": "Pending transfer"},
    )
    assert blocked.status_code == 409

    pending = client.get("/api/v1/admin/pending-money", headers=admin).json()
    payment_id = next(item["source_event_id"] for item in pending["items"]
                      if item.get("rental_id") == rental_id and item["item_type"] == "pending_transfer")
    rejected = client.post(
        f"/api/v1/rentals/receivables/{payment_id}/review",
        headers={**admin, "Idempotency-Key": "review-reject"},
        json={"status": "pending"},
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "pending"
    still_blocked = client.get(f"/api/v1/rentals/{rental_id}/cancellation-preview",
                               headers={"Authorization": f"Bearer {token}"}).json()
    assert still_blocked["can_cancel"] is False
    assert still_blocked["settled_minor"] == 0

    confirmed = client.post(
        f"/api/v1/rentals/receivables/{payment_id}/review",
        headers={**admin, "Idempotency-Key": "review-confirm"},
        json={"status": "confirmed"},
    )
    assert confirmed.status_code == 200 and confirmed.json()["status"] == "confirmed"
    fresh = client.get(f"/api/v1/rentals/{rental_id}/cancellation-preview",
                       headers={"Authorization": f"Bearer {token}"}).json()
    assert fresh["can_cancel"] is True
    assert fresh["settled_minor"] == 3000
    cancelled = client.post(
        f"/api/v1/rentals/{rental_id}/cancellation",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "cancel-after-review"},
        json={"register_id": str(ids["register"]), "preview_token": fresh["preview_token"],
              "refund_amount_minor": 0, "refund_method": "cash", "reason": "Member left"},
    )
    assert cancelled.status_code == 201, cancelled.text

    late = client.post(
        f"/api/v1/rentals/receivables/{payment_id}/review",
        headers={**admin, "Idempotency-Key": "review-late"},
        json={"status": "confirmed"},
    )
    assert late.status_code == 409
    detail = client.get(f"/api/v1/rentals/{rental_id}",
                        headers={"Authorization": f"Bearer {token}"}).json()
    assert detail["status"] == "cancelled" and detail["paid_minor"] == 3000


def test_direct_card_tender_is_rejected_and_persists_nothing(rental_world):
    client, factory, branch, _other, _actor, token, ids, _admin = rental_world
    forged = _rent_glove(
        client, token, branch, ids,
        components=[{"method": "card", "amount_minor": 1000}],
    )
    assert forged.status_code == 422
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(Rental)) == 0
        assert session.scalar(select(func.count()).select_from(RentalCharge)) == 0
        assert session.scalar(select(func.count()).select_from(Payment)) == 0

    rented = _rent_glove(
        client, token, branch, ids,
        components=[{"method": "cash", "amount_minor": 1000}], key="cash-first",
    )
    assert rented.status_code == 201, rented.text
    rental_id = rented.json()["id"]
    forged_repayment = client.post(
        f"/api/v1/rentals/{rental_id}/receivable-payments",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "card-repay"},
        json={"register_id": str(ids["register"]), "method": "card", "amount_minor": 500},
    )
    assert forged_repayment.status_code == 422
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(Payment)) == 1


class _MismatchedProvider:
    def __init__(self):
        self.create_calls = 0
        self.intents: dict[str, PointPaymentIntentDTO] = {}

    def create_payment_intent(self, device_id, amount_minor, external_reference):
        self.create_calls += 1
        intent = PointPaymentIntentDTO(
            id=f"mismatch-{self.create_calls}", device_id=device_id,
            amount_minor=amount_minor + 1, status="OPEN",
        )
        self.intents[intent.id] = intent
        return intent

    def get_payment_intent_status(self, device_id, payment_intent_id):
        return self.intents[payment_intent_id].model_copy(update={"status": "PROCESSED"})


def test_card_attempt_replay_does_not_recharge_and_mismatch_is_not_settled(rental_world):
    client, factory, branch, _other, _actor, token, ids, _admin = rental_world
    rented = _rent_glove(client, token, branch, ids,
                         components=[{"method": "cash", "amount_minor": 1000}], key="card-owner")
    rental_id = rented.json()["id"]
    charge_id = rented.json()["charges"][0]["id"]
    path = f"/api/v1/rentals/{rental_id}/charges/{charge_id}/card-attempts"
    provider = _MismatchedProvider()
    client.app.state.rental_point_client = provider

    first = client.post(path, headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "card-replay"},
                        json={"register_id": str(ids["register"]), "amount_minor": 500})
    assert first.status_code == 201, first.text
    replay = client.post(path, headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "card-replay"},
                         json={"register_id": str(ids["register"]), "amount_minor": 500})
    assert replay.status_code == 200 and replay.json()["id"] == first.json()["id"]
    assert provider.create_calls == 1

    attempt = client.get(f"/api/v1/rentals/card-attempts/{first.json()['id']}",
                         headers={"Authorization": f"Bearer {token}"})
    assert attempt.status_code == 200, attempt.text
    assert attempt.json()["payment_id"] is None
    assert attempt.json()["status"] in {"failed", "unknown"}
    with factory() as session:
        card_payments = session.scalar(select(func.count()).select_from(Payment).where(
            Payment.rental_charge_id == UUID(charge_id), Payment.method == "card"))
        assert card_payments == 0


def test_pending_card_attempt_reserves_amount_against_repayment(rental_world):
    client, factory, branch, _other, _actor, token, ids, _admin = rental_world
    rented = _rent_glove(client, token, branch, ids,
                         components=[{"method": "cash", "amount_minor": 1000}], key="card-reserve")
    rental_id = rented.json()["id"]
    charge_id = rented.json()["charges"][0]["id"]
    fake = MockPointTerminalClient(auto_process=False)
    client.app.state.rental_point_client = fake
    attempt = client.post(
        f"/api/v1/rentals/{rental_id}/charges/{charge_id}/card-attempts",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "card-hold"},
        json={"register_id": str(ids["register"]), "amount_minor": 500},
    )
    assert attempt.status_code == 201, attempt.text

    over = client.post(
        f"/api/v1/rentals/{rental_id}/receivable-payments",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "repay-over"},
        json={"register_id": str(ids["register"]), "method": "cash", "amount_minor": 1500},
    )
    assert over.status_code == 409
    exact = client.post(
        f"/api/v1/rentals/{rental_id}/receivable-payments",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "repay-exact"},
        json={"register_id": str(ids["register"]), "method": "cash", "amount_minor": 1000},
    )
    assert exact.status_code == 201, exact.text
    assert exact.json()["remaining_minor"] == 500

    fake.auto_process = True
    settled = client.get(f"/api/v1/rentals/card-attempts/{attempt.json()['id']}",
                         headers={"Authorization": f"Bearer {token}"})
    assert settled.status_code == 200 and settled.json()["status"] == "confirmed"
    detail = client.get(f"/api/v1/rentals/{rental_id}",
                        headers={"Authorization": f"Bearer {token}"}).json()
    assert detail["outstanding_minor"] == 0
    with factory() as session:
        total = session.scalar(select(func.sum(Payment.amount_minor)).where(
            Payment.rental_charge_id == UUID(charge_id), Payment.status == "confirmed"))
        assert total == 2500


def test_repayment_allocates_across_periods_and_replays_original_result(rental_world):
    client, factory, branch, _other, _actor, token, ids, _admin = rental_world
    assigned = _assign_locker(client, token, branch, ids,
                              components=[{"method": "cash", "amount_minor": 5000}])
    assert assigned.status_code == 201, assigned.text
    rental_id = assigned.json()["id"]
    first_charge_id = assigned.json()["charges"][0]["id"]
    renewed = client.post(
        f"/api/v1/rentals/{rental_id}/renewals",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "alloc-renew"},
        json={"register_id": str(ids["register"]), "components": [],
              "expected_total_minor": 15000, "accepted_shortfall_minor": 15000},
    )
    assert renewed.status_code == 201, renewed.text
    second_charge_id = renewed.json()["charges"][1]["id"]
    assert renewed.json()["outstanding_minor"] == 25000

    receipt = client.post(
        f"/api/v1/rentals/{rental_id}/receivable-payments",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "alloc-20000"},
        json={"register_id": str(ids["register"]), "method": "cash", "amount_minor": 20000},
    )
    assert receipt.status_code == 201, receipt.text
    assert receipt.json()["remaining_minor"] == 5000
    assert receipt.json()["allocations"] == [
        {"charge_id": first_charge_id, "amount_minor": 10000},
        {"charge_id": second_charge_id, "amount_minor": 10000},
    ]

    later = client.post(
        f"/api/v1/rentals/{rental_id}/receivable-payments",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "alloc-later"},
        json={"register_id": str(ids["register"]), "method": "cash", "amount_minor": 5000},
    )
    assert later.status_code == 201 and later.json()["remaining_minor"] == 0

    replay = client.post(
        f"/api/v1/rentals/{rental_id}/receivable-payments",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "alloc-20000"},
        json={"register_id": str(ids["register"]), "method": "cash", "amount_minor": 20000},
    )
    assert replay.status_code == 200
    assert replay.json()["remaining_minor"] == 5000
    assert replay.json()["allocations"] == receipt.json()["allocations"]

    with factory() as session:
        totals = dict(session.execute(
            select(Payment.rental_charge_id, func.sum(Payment.amount_minor)).where(
                Payment.rental_charge_id.in_([UUID(first_charge_id), UUID(second_charge_id)]),
                Payment.status == "confirmed").group_by(Payment.rental_charge_id)
        ).all())
        assert totals[UUID(first_charge_id)] == 15000
        assert totals[UUID(second_charge_id)] == 15000


def test_employee_locker_is_not_rentable_and_stale_return_keeps_new_occupancy(rental_world):
    client, factory, branch, _other, _actor, token, ids, admin = rental_world
    employee = client.patch(f"/api/v1/rentals/assets/{ids['locker']}", headers=admin,
                            json={"status": "employee"})
    assert employee.status_code == 200, employee.text
    rejected = _assign_locker(client, token, branch, ids, key="employee-locker")
    assert rejected.status_code == 409
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(Rental)) == 0
        assert session.scalar(select(RentalAsset.status).where(
            RentalAsset.id == ids["locker"])) == "employee"

    restored = client.patch(f"/api/v1/rentals/assets/{ids['locker']}", headers=admin,
                            json={"status": "available"})
    assert restored.status_code == 200

    first = _rent_glove(client, token, branch, ids, key="occupancy-1")
    assert first.status_code == 201, first.text
    returned = client.post(f"/api/v1/rentals/{first.json()['id']}/return",
                           headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "occupancy-return"})
    assert returned.status_code == 200
    second = _rent_glove(client, token, branch, ids, key="occupancy-2")
    assert second.status_code == 201, second.text
    replay_return = client.post(f"/api/v1/rentals/{first.json()['id']}/return",
                                headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "occupancy-return"})
    assert replay_return.status_code == 200
    assets = client.get(f"/api/v1/rentals/assets?branch_id={branch}&kind=glove",
                        headers={"Authorization": f"Bearer {token}"}).json()
    assert assets["items"][0]["active_rental_id"] == second.json()["id"]
    assert assets["items"][0]["active_rental_id"] != first.json()["id"]


def test_late_locker_renewal_starts_from_branch_today_and_preserves_old_period(rental_world):
    client, factory, branch, _other, _actor, token, ids, _admin = rental_world
    assigned = _assign_locker(client, token, branch, ids,
                              components=[{"method": "cash", "amount_minor": 15000}])
    rental_id = assigned.json()["id"]
    original = assigned.json()["charges"][0]
    with factory.begin() as session:
        rental = session.get(Rental, UUID(rental_id))
        rental.starts_on = date.today() - timedelta(days=70)
        rental.ends_on = date.today() - timedelta(days=40)
        charge = session.scalar(select(RentalCharge).where(RentalCharge.rental_id == UUID(rental_id)))
        charge.starts_on = rental.starts_on
        charge.ends_on = rental.ends_on
        original = {"starts_on": charge.starts_on.isoformat(), "ends_on": charge.ends_on.isoformat()}
        branch_row = session.get(Branch, branch)
        today = local_today(branch_row)

    renewed = client.post(
        f"/api/v1/rentals/{rental_id}/renewals",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "late-renew"},
        json={"register_id": str(ids["register"]), "components": [],
              "expected_total_minor": 15000, "accepted_shortfall_minor": 15000},
    )
    assert renewed.status_code == 201, renewed.text
    body = renewed.json()
    assert body["starts_on"] == today.isoformat()
    assert body["ends_on"] == month_end(today).isoformat()
    assert body["charges"][0]["starts_on"] == original["starts_on"]
    assert body["charges"][0]["ends_on"] == original["ends_on"]
    assert body["charges"][1]["starts_on"] == today.isoformat()


def test_rental_and_cancellation_dtos_expose_real_identity_and_pagination(rental_world):
    client, factory, branch, _other, actor, token, ids, admin = rental_world
    with factory.begin() as session:
        session.add(StaffRosterProfile(
            branch_id=branch, staff_user_id=actor, full_name="Ana Reception", position="Receptionist"
        ))
    rented = _rent_glove(client, token, branch, ids, key="identity-rent")
    assert rented.status_code == 201, rented.text
    rental = rented.json()
    assert rental["member_name"] == "Rental Member"
    assert rental["member_number"] == "SOC-RENT-1"
    assert rental["asset_code"] == "g-01"
    assert rental["assigned_by_name"] == "Ana Reception"

    assigned = _assign_locker(client, token, branch, ids,
                              components=[{"method": "cash", "amount_minor": 3000}], key="identity-locker")
    locker_id = assigned.json()["id"]
    assert assigned.json()["assigned_by_name"] == "Ana Reception"
    preview = client.get(f"/api/v1/rentals/{locker_id}/cancellation-preview",
                         headers={"Authorization": f"Bearer {token}"}).json()
    cancelled = client.post(
        f"/api/v1/rentals/{locker_id}/cancellation",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "identity-cancel"},
        json={"register_id": str(ids["register"]), "preview_token": preview["preview_token"],
              "refund_amount_minor": 0, "refund_method": "cash", "reason": "Identity check"},
    )
    assert cancelled.status_code == 201, cancelled.text
    alert = cancelled.json()
    assert alert["actor_id"] == str(actor)
    assert alert["actor_name"] == "Ana Reception"
    assert alert["member_name"] == "Rental Member"
    assert alert["member_number"] == "SOC-RENT-1"
    assert alert["asset_code"] == "l-01"
    assert alert["reviewed_by"] is None and alert["reviewed_by_name"] is None

    page = client.get(f"/api/v1/rentals/alerts?branch_id={branch}&offset=0&limit=1", headers=admin)
    assert page.status_code == 200 and page.json()["total"] == 1
    assert len(page.json()["items"]) == 1
    reviews = client.post(f"/api/v1/rentals/alerts/{alert['id']}/review", headers=admin)
    assert reviews.status_code == 200
    assert reviews.json()["reviewed_by"] is not None
    assert reviews.json()["reviewed_by_name"]


def test_displayed_price_and_shortfall_acceptance_are_enforced_before_effects(rental_world):
    client, factory, branch, _other, _actor, token, ids, admin = rental_world
    patched = client.patch(f"/api/v1/rentals/assets/{ids['glove']}", headers=admin,
                           json={"price_minor": 3000})
    assert patched.status_code == 200

    stale = _rent_glove(client, token, branch, ids, key="stale-price",
                        expected_total_minor=2500, accepted_shortfall_minor=2500)
    assert stale.status_code == 409
    wrong = _rent_glove(client, token, branch, ids, key="wrong-shortfall",
                        expected_total_minor=3000, accepted_shortfall_minor=1000)
    assert wrong.status_code == 409
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(Rental)) == 0
        assert session.scalar(select(func.count()).select_from(RentalCharge)) == 0
        assert session.scalar(select(func.count()).select_from(Payment)) == 0

    accepted = _rent_glove(client, token, branch, ids, key="accepted-shortfall",
                           expected_total_minor=3000, accepted_shortfall_minor=3000)
    assert accepted.status_code == 201, accepted.text
    assert accepted.json()["outstanding_minor"] == 3000

    assigned = _assign_locker(client, token, branch, ids,
                              components=[{"method": "cash", "amount_minor": 15000}], key="drift-locker")
    locker_id = assigned.json()["id"]
    locker_patch = client.patch(f"/api/v1/rentals/assets/{ids['locker']}", headers=admin,
                                json={"price_minor": 18000})
    assert locker_patch.status_code == 200
    stale_renewal = client.post(
        f"/api/v1/rentals/{locker_id}/renewals",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "stale-renew"},
        json={"register_id": str(ids["register"]), "components": [],
              "expected_total_minor": 15000, "accepted_shortfall_minor": 15000},
    )
    assert stale_renewal.status_code == 409
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(RentalCharge).where(
            RentalCharge.rental_id == UUID(locker_id))) == 1
