from fastapi.testclient import TestClient
import pytest

from app.credit.queries import CreditConflictError, apply_credit
from app.db.models import CashRegister, Member, MemberCreditMovement, Shift
from app.main import create_app
from app.shifts.queries import create_cash_register, expected_cash_for_shift, shift_financial_summary
from test_admin_auth import configured_settings
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def _seed(factory, *, open_shift_on_register=True):
    branch_id = _seed_branch(factory, "credit-branch", "Credit Branch")
    other_branch_id = _seed_branch(factory, "credit-other", "Credit Other Branch")
    staff_id, token = _seed_receptionist(factory, branch_id, "credit@example.invalid")
    with factory.begin() as session:
        member = Member(member_number="SOC-CREDIT", full_name="Credit Member", phone="5550199")
        session.add(member)
        register = create_cash_register(session, branch_id, "credit-register", "Credit Register")
        other_register = create_cash_register(session, other_branch_id, "credit-other-register", "Other Register")
        shift_id = None
        if open_shift_on_register:
            shift_id = open_shift(session, register_id=register.id, opened_by=staff_id,
                                  denomination_counts=[{"denomination_minor": 100, "quantity": 0}]).id
        session.flush()
        return dict(member_id=member.id, register_id=register.id, other_register_id=other_register.id,
                    shift_id=shift_id, staff_id=staff_id, token=token)


def _headers(token, key):
    return {"Authorization": f"Bearer {token}", "Idempotency-Key": key}


def _balance(factory, member_id):
    with factory() as session:
        return session.get(Member, member_id).credit_balance_minor


def test_deposit_raises_balance_and_expected_cash_and_replays_once(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        ctx = _seed(factory)
        path = f"/api/v1/registers/{ctx['register_id']}/member-credit-deposits"
        body = {"member_id": str(ctx["member_id"]), "amount_minor": 6000}
        with TestClient(create_app(configured_settings(url))) as client:
            first = client.post(path, headers=_headers(ctx["token"], "dep-001"), json=body)
            assert first.status_code == 201, first.text
            movement = first.json()
            assert movement["kind"] == "deposit"
            assert movement["amount_minor"] == 6000
            assert movement["balance_after_minor"] == 6000
            assert movement["shift_id"] == str(ctx["shift_id"])
            assert movement["received_by"] == str(ctx["staff_id"])

            replay = client.post(path, headers=_headers(ctx["token"], "dep-001"), json=body)
            assert replay.status_code == 200
            assert replay.json()["id"] == movement["id"]

            conflict = client.post(path, headers=_headers(ctx["token"], "dep-001"),
                                   json={**body, "amount_minor": 7000})
            assert conflict.status_code == 409

            second = client.post(path, headers=_headers(ctx["token"], "dep-002"),
                                 json={**body, "amount_minor": 1500})
            assert second.status_code == 201
            assert second.json()["balance_after_minor"] == 7500

        assert _balance(factory, ctx["member_id"]) == 7500
        with factory() as session:
            shift = session.get(Shift, ctx["shift_id"])
            assert expected_cash_for_shift(session, shift) == shift.opening_cash_minor + 7500
            summary = shift_financial_summary(session, shift)
            assert summary["confirmed_cash_minor"] == 7500
            assert {row["description"] for row in summary["payments"]} == {"Saldo a favor recibido"}
            assert summary["activities"] == [{"family": "credit", "count": 2, "amount_minor": 7500}]
    finally:
        engine.dispose()


def test_deposit_rejections(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        ctx = _seed(factory)
        path = f"/api/v1/registers/{ctx['register_id']}/member-credit-deposits"
        body = {"member_id": str(ctx["member_id"]), "amount_minor": 1000}
        with TestClient(create_app(configured_settings(url))) as client:
            wrong_branch = client.post(
                f"/api/v1/registers/{ctx['other_register_id']}/member-credit-deposits",
                headers=_headers(ctx["token"], "dep-branch"), json=body)
            assert wrong_branch.status_code == 403
            no_shift = client.post(
                f"/api/v1/registers/{ctx['other_register_id']}/member-credit-deposits",
                headers=_headers(ctx["token"], "dep-noshift"), json=body)
            assert no_shift.status_code == 403
            zero = client.post(path, headers=_headers(ctx["token"], "dep-zero"), json={**body, "amount_minor": 0})
            assert zero.status_code == 422
            unknown = client.post(path, headers=_headers(ctx["token"], "dep-unknown"),
                                  json={**body, "member_id": "00000000-0000-4000-8000-000000000001"})
            assert unknown.status_code == 404
        assert _balance(factory, ctx["member_id"]) == 0
    finally:
        engine.dispose()


def test_deposit_requires_an_open_shift(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        ctx = _seed(factory, open_shift_on_register=False)
        with TestClient(create_app(configured_settings(url))) as client:
            response = client.post(
                f"/api/v1/registers/{ctx['register_id']}/member-credit-deposits",
                headers=_headers(ctx["token"], "dep-closed"),
                json={"member_id": str(ctx["member_id"]), "amount_minor": 1000})
            assert response.status_code == 409
        assert _balance(factory, ctx["member_id"]) == 0
    finally:
        engine.dispose()


def test_movements_list_is_newest_first_and_apply_never_overdraws(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        ctx = _seed(factory)
        path = f"/api/v1/registers/{ctx['register_id']}/member-credit-deposits"
        with TestClient(create_app(configured_settings(url))) as client:
            for key, amount in (("m-1", 2000), ("m-2", 3000)):
                assert client.post(path, headers=_headers(ctx["token"], key),
                                   json={"member_id": str(ctx["member_id"]), "amount_minor": amount}).status_code == 201
            page = client.get(f"/api/v1/members/{ctx['member_id']}/credit-movements",
                              headers={"Authorization": f"Bearer {ctx['token']}"})
            assert page.status_code == 200, page.text
            assert page.json()["total_items"] == 2
            assert [item["amount_minor"] for item in page.json()["items"]] == [3000, 2000]

        with factory.begin() as session:
            member = session.get(Member, ctx["member_id"])
            register = session.get(CashRegister, ctx["register_id"])
            shift = session.get(Shift, ctx["shift_id"])
            applied = apply_credit(session, member=member, register=register, shift=shift,
                                   actor_id=ctx["staff_id"], amount_minor=4000)
            assert applied.balance_after_minor == 1000
            with pytest.raises(CreditConflictError):
                apply_credit(session, member=member, register=register, shift=shift,
                             actor_id=ctx["staff_id"], amount_minor=1001)
            assert member.credit_balance_minor == 1000
        with factory.begin() as session:
            movement = session.query(MemberCreditMovement).filter_by(kind="apply").one()
            movement.amount_minor = 1
            with pytest.raises(ValueError):
                session.flush()
    finally:
        engine.dispose()
