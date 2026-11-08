"""Rental charges (gloves, lockers) can be settled from member credit (saldo a favor)."""
from app.db.models import Member, Shift
from app.shifts.queries import expected_cash_for_shift, shift_financial_summary
from test_rentals import _assign_locker, _rent_glove, rental_world  # noqa: F401 (fixture)


def _auth(token, key):
    return {"Authorization": f"Bearer {token}", "Idempotency-Key": key}


def _deposit(client, token, ids, amount, key):
    response = client.post(f"/api/v1/registers/{ids['register']}/member-credit-deposits", headers=_auth(token, key),
                           json={"member_id": str(ids["member"]), "amount_minor": amount})
    assert response.status_code == 201, response.text


def _balance(factory, ids):
    with factory() as session:
        return session.get(Member, ids["member"]).credit_balance_minor


def _body(branch, ids, asset, price, credit, components=()):
    return {"branch_id": str(branch), "asset_id": str(ids[asset]), "member_id": str(ids["member"]),
            "register_id": str(ids["register"]), "components": list(components),
            "expected_total_minor": price,
            "accepted_shortfall_minor": price - credit - sum(c["amount_minor"] for c in components),
            "credit_minor": credit}


def test_rental_debt_can_be_paid_from_credit(rental_world):  # noqa: F811
    client, factory, branch, _other, _actor, token, ids, _admin = rental_world
    rented = client.post("/api/v1/rentals/gloves", headers=_auth(token, "rd-glove"),
                         json=_body(branch, ids, "glove", 2500, 0))
    assert rented.status_code == 201, rented.text
    rental_id = rented.json()["id"]
    assert rented.json()["outstanding_minor"] == 2500
    pay = f"/api/v1/rentals/{rental_id}/receivable-payments"
    body = {"register_id": str(ids["register"]), "method": "credit", "amount_minor": 1000}

    assert client.post(pay, headers=_auth(token, "rd-over"), json=body).status_code == 409  # no balance yet
    _deposit(client, token, ids, 1500, "rd-dep")
    paid = client.post(pay, headers=_auth(token, "rd-pay"), json=body)
    assert paid.status_code == 201, paid.text
    assert paid.json()["method"] == "credit" and paid.json()["status"] == "confirmed"
    assert paid.json()["remaining_minor"] == 1500
    replay = client.post(pay, headers=_auth(token, "rd-pay"), json=body)
    assert replay.status_code == 200 and replay.json()["id"] == paid.json()["id"]
    assert _balance(factory, ids) == 500

    too_much = client.post(pay, headers=_auth(token, "rd-too-much"), json={**body, "amount_minor": 600})
    assert too_much.status_code == 409  # only 500 left
    rest = client.post(pay, headers=_auth(token, "rd-rest"), json={**body, "amount_minor": 500})
    assert rest.status_code == 201 and rest.json()["remaining_minor"] == 1000
    assert _balance(factory, ids) == 0
    after = client.get(f"/api/v1/rentals/{rental_id}", headers={"Authorization": f"Bearer {token}"})
    assert after.json()["paid_minor"] == 1500 and after.json()["outstanding_minor"] == 1000

    with factory() as session:
        shift = session.query(Shift).one()
        assert expected_cash_for_shift(session, shift) == shift.opening_cash_minor + 1500  # only the deposit
        summary = shift_financial_summary(session, shift)
        by_method = {item["method"]: item["amount_minor"] for item in summary["payment_methods"]}
        assert by_method["credit"] == 1500 and by_method["cash"] == 1500


def test_glove_and_locker_rentals_draw_credit_and_locker_cancellation_is_blocked(rental_world):  # noqa: F811
    client, factory, branch, _other, _actor, token, ids, _admin = rental_world
    overdraft = client.post("/api/v1/rentals/gloves", headers=_auth(token, "rc-overdraft"),
                            json=_body(branch, ids, "glove", 2500, 2500))
    assert overdraft.status_code == 409  # no balance yet
    _deposit(client, token, ids, 20000, "rc-dep-1")
    assert _balance(factory, ids) == 20000

    glove_body = _body(branch, ids, "glove", 2500, 500, [{"method": "cash", "amount_minor": 1000}])
    glove = client.post("/api/v1/rentals/gloves", headers=_auth(token, "rc-glove"), json=glove_body)
    assert glove.status_code == 201, glove.text
    assert glove.json()["paid_minor"] == 1500 and glove.json()["outstanding_minor"] == 1000
    replay = client.post("/api/v1/rentals/gloves", headers=_auth(token, "rc-glove"), json=glove_body)
    assert replay.status_code == 200 and replay.json()["id"] == glove.json()["id"]
    assert _balance(factory, ids) == 19500
    changed = client.post("/api/v1/rentals/gloves", headers=_auth(token, "rc-glove"),
                          json=_body(branch, ids, "glove", 2500, 600, [{"method": "cash", "amount_minor": 1000}]))
    assert changed.status_code == 409

    locker = client.post("/api/v1/rentals/lockers", headers=_auth(token, "rc-locker"),
                         json=_body(branch, ids, "locker", 15000, 15000))
    assert locker.status_code == 201, locker.text
    assert locker.json()["paid_minor"] == 15000 and locker.json()["outstanding_minor"] == 0
    locker_id = locker.json()["id"]
    assert _balance(factory, ids) == 4500

    renewal_body = {"register_id": str(ids["register"]), "components": [], "expected_total_minor": 15000,
                    "accepted_shortfall_minor": 0, "credit_minor": 15000}
    short = client.post(f"/api/v1/rentals/{locker_id}/renewals", headers=_auth(token, "rc-renew-1"), json=renewal_body)
    assert short.status_code == 409  # only 4500 left
    _deposit(client, token, ids, 11000, "rc-dep-2")
    renewed = client.post(f"/api/v1/rentals/{locker_id}/renewals", headers=_auth(token, "rc-renew-2"), json=renewal_body)
    assert renewed.status_code == 200 or renewed.status_code == 201, renewed.text
    assert renewed.json()["outstanding_minor"] == 0 and len(renewed.json()["charges"]) == 2
    assert _balance(factory, ids) == 500

    preview = client.get(f"/api/v1/rentals/{locker_id}/cancellation-preview", headers={"Authorization": f"Bearer {token}"})
    assert preview.status_code == 200 and preview.json()["can_cancel"] is False
    cancel = client.post(f"/api/v1/rentals/{locker_id}/cancellation", headers=_auth(token, "rc-cancel"), json={
        "register_id": str(ids["register"]), "preview_token": preview.json()["preview_token"],
        "refund_amount_minor": 0, "refund_method": "cash",
        "reason": "test"})
    assert cancel.status_code == 409
    release = client.post(f"/api/v1/rentals/{locker_id}/release", headers=_auth(token, "rc-release"))
    assert release.status_code == 200, release.text

    with factory() as session:
        shift = session.query(Shift).one()
        assert expected_cash_for_shift(session, shift) == shift.opening_cash_minor + 20000 + 11000 + 1000
        summary = shift_financial_summary(session, shift)
        by_method = {item["method"]: item["amount_minor"] for item in summary["payment_methods"]}
        assert by_method["credit"] == 500 + 15000 + 15000
        assert by_method["cash"] == 20000 + 11000 + 1000
        families = {item["family"]: item["amount_minor"] for item in summary["activities"]}
        assert families["rental"] == 1000 + 500 + 15000 + 15000
        assert len([row for row in summary["payments"] if row["method"] == "credit"]) == 3
