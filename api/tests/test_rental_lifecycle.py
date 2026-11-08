"""Server-derived locker lifecycle / glove overdue flag, renewal replay order, credit ledger of rentals."""
from datetime import timedelta
from uuid import UUID

import pytest
from sqlalchemy import select

from app.db.models import Branch, Member, MemberCreditMovement, Rental, RentalCharge
from app.rentals.payments import local_today
from test_member_credit_rentals import _auth, _balance, _body, _deposit
from test_rentals import _assign_locker, _rent_glove, rental_world  # noqa: F401 (fixture)


def _get(client, token, rental_id):
    response = client.get(f"/api/v1/rentals/{rental_id}", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200, response.text
    return response.json()


def _shift_dates(factory, branch, rental_id, ends_days_ago):
    """Move the locker period so it ended `ends_days_ago` branch-local days ago (0 = ends today)."""
    with factory.begin() as session:
        today = local_today(session.get(Branch, branch))
        rental = session.get(Rental, UUID(rental_id))
        rental.ends_on = today - timedelta(days=ends_days_ago)
        rental.starts_on = rental.ends_on - timedelta(days=30)


@pytest.mark.parametrize("days_ago,expected,overdue", [
    (-1, "active", 0), (0, "active", 0), (1, "expired", 1), (14, "expired", 14), (15, "evicted", 15),
])
def test_locker_lifecycle_is_derived_from_branch_local_day(rental_world, days_ago, expected, overdue):  # noqa: F811
    client, factory, branch, _other, _actor, token, ids, _admin = rental_world
    rental_id = _assign_locker(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 15000}]).json()["id"]
    _shift_dates(factory, branch, rental_id, days_ago)
    body = _get(client, token, rental_id)
    assert body["lifecycle_status"] == expected and body["overdue_days"] == overdue and body["overdue"] is False
    listed = client.get(f"/api/v1/rentals?branch_id={branch}&status=active&kind=locker",
                        headers={"Authorization": f"Bearer {token}"}).json()["items"]
    assert listed[0]["lifecycle_status"] == expected


def test_evicted_locker_can_still_be_released_and_loses_lifecycle(rental_world):  # noqa: F811
    client, factory, branch, _other, _actor, token, ids, _admin = rental_world
    rental_id = _assign_locker(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 15000}]).json()["id"]
    _shift_dates(factory, branch, rental_id, 30)
    released = client.post(f"/api/v1/rentals/{rental_id}/release", headers=_auth(token, "evict-release"))
    assert released.status_code == 200, released.text
    assert released.json()["status"] == "released" and released.json()["lifecycle_status"] is None


def test_active_glove_rental_is_overdue_only_after_its_local_day(rental_world):  # noqa: F811
    client, factory, branch, _other, _actor, token, ids, _admin = rental_world
    rental_id = _rent_glove(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 2500}]).json()["id"]
    assert _get(client, token, rental_id)["overdue"] is False
    with factory.begin() as session:
        charge = session.scalar(select(RentalCharge).where(RentalCharge.rental_id == UUID(rental_id)))
        charge.starts_on = local_today(session.get(Branch, branch)) - timedelta(days=1)
        charge.ends_on = charge.starts_on
    body = _get(client, token, rental_id)
    assert body["overdue"] is True and body["lifecycle_status"] is None
    client.post(f"/api/v1/rentals/{rental_id}/return", headers=_auth(token, "glove-ret"))
    assert _get(client, token, rental_id)["overdue"] is False


def test_renewal_replay_after_release_returns_the_original_result(rental_world):  # noqa: F811
    client, _factory, branch, _other, _actor, token, ids, _admin = rental_world
    rental_id = _assign_locker(client, token, branch, ids, components=[{"method": "cash", "amount_minor": 15000}]).json()["id"]
    body = {"register_id": str(ids["register"]), "components": [{"method": "cash", "amount_minor": 15000}],
            "expected_total_minor": 15000, "accepted_shortfall_minor": 0}
    first = client.post(f"/api/v1/rentals/{rental_id}/renewals", headers=_auth(token, "renew-1"), json=body)
    assert first.status_code == 201, first.text
    assert client.post(f"/api/v1/rentals/{rental_id}/release", headers=_auth(token, "renew-rel")).status_code == 200
    replay = client.post(f"/api/v1/rentals/{rental_id}/renewals", headers=_auth(token, "renew-1"), json=body)
    assert replay.status_code == 200, replay.text
    assert replay.json()["ends_on"] == first.json()["ends_on"] and len(replay.json()["charges"]) == 2
    fresh = client.post(f"/api/v1/rentals/{rental_id}/renewals", headers=_auth(token, "renew-2"), json=body)
    assert fresh.status_code == 409  # a new key on a released rental is still rejected


def test_credit_paid_rental_and_renewal_leave_balance_and_ledger_rows(rental_world):  # noqa: F811
    client, factory, branch, _other, _actor, token, ids, _admin = rental_world
    _deposit(client, token, ids, 20000, "led-dep")
    assert client.post("/api/v1/rentals/gloves", headers=_auth(token, "led-glove"),
                       json=_body(branch, ids, "glove", 2500, 500, [{"method": "cash", "amount_minor": 2000}])).status_code == 201
    locker = client.post("/api/v1/rentals/lockers", headers=_auth(token, "led-locker"),
                         json=_body(branch, ids, "locker", 15000, 15000))
    assert locker.status_code == 201, locker.text
    assert _balance(factory, ids) == 4500
    renewal = {"register_id": str(ids["register"]), "components": [{"method": "cash", "amount_minor": 10500}],
               "expected_total_minor": 15000, "accepted_shortfall_minor": 0, "credit_minor": 4500}
    assert client.post(f"/api/v1/rentals/{locker.json()['id']}/renewals", headers=_auth(token, "led-renew"),
                       json=renewal).status_code == 201
    assert _balance(factory, ids) == 0
    with factory() as session:
        rows = session.scalars(select(MemberCreditMovement).where(MemberCreditMovement.member_id == ids["member"])).all()
        assert {(row.kind, row.amount_minor, row.balance_after_minor) for row in rows} == {
            ("deposit", 20000, 20000), ("apply", 500, 19500), ("apply", 15000, 4500), ("apply", 4500, 0)}
        assert session.get(Member, ids["member"]).credit_balance_minor == 0
