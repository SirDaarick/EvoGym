"""Tests for cash registers, payment terminals, shifts, and concurrency controls (BK-020)."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session
from app.db.base import Base
from app.db.models import (
    Branch,
    CashRegister,
    Member,
    Plan,
    PlanVersion,
    PaymentTerminal,
    RoleGrant,
    Shift,
    ShiftClosingDenominationCount,
    ShiftDenominationCount,
    StaffCredential,
    StaffUser,
)
from app.inventory.queries import capture_register_inventory_snapshot
from app.main import create_app
from app.shifts.queries import (
    CashRegisterNotFoundError,
    ShiftAlreadyOpenError,
    close_shift,
    create_cash_register,
    create_payment_terminal,
    get_cash_register,
    get_open_shift,
    get_shift_by_id,
    list_cash_registers,
    list_payment_terminals,
    open_shift as _open_shift,
)
from app.shifts.schemas import CloseShiftDTO, OpenShiftDTO
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from admin_session_helpers import approved_admin_headers


def open_shift(session, *, register_id, opened_by, denomination_counts, opening_cash_minor=None,
               inventory_snapshot_id=None, inventory_observations=None):
    """Provide an explicitly captured empty-catalog presentation for legacy domain tests."""
    if inventory_snapshot_id is None:
        snapshot = capture_register_inventory_snapshot(session, register_id=register_id, actor_id=opened_by)
        inventory_snapshot_id = snapshot.id
    return _open_shift(
        session,
        register_id=register_id,
        opened_by=opened_by,
        denomination_counts=denomination_counts,
        opening_cash_minor=opening_cash_minor,
        inventory_snapshot_id=inventory_snapshot_id,
        inventory_observations=inventory_observations,
    )


def test_open_shift_requires_exact_denomination_counts_and_computes_total():
    payload = OpenShiftDTO.model_validate(
        {
            "cash_register_id": str(uuid4()),
            "inventory_snapshot_id": str(uuid4()),
            "denomination_counts": [
                {"denomination_minor": 10000, "quantity": 2},
                {"denomination_minor": 500, "quantity": 4},
            ],
        }
    )

    assert payload.opening_cash_minor == 22000
    assert payload.model_dump()["denomination_counts"] == [
        {"denomination_minor": 10000, "quantity": 2},
        {"denomination_minor": 500, "quantity": 4},
    ]


@pytest.mark.parametrize(
    "counts,total,message",
    [
        ([], None, "at least 1 item"),
        ([{"denomination_minor": 100, "quantity": 1}] * 2, None, "duplicates"),
        ([{"denomination_minor": 0, "quantity": 1}], None, "greater than 0"),
        ([{"denomination_minor": 100, "quantity": -1}], None, "greater than or equal to 0"),
        ([{"denomination_minor": 100, "quantity": True}], None, "valid integer"),
        ([{"denomination_minor": 100, "quantity": 1.5}], None, "valid integer"),
        ([{"denomination_minor": 100, "quantity": "1"}], None, "valid integer"),
        ([{"denomination_minor": 2**63 - 1, "quantity": 2}], None, "signed 64-bit"),
        ([{"denomination_minor": 100, "quantity": 1}], 101, "must match"),
    ],
)
def test_open_shift_rejects_invalid_denomination_evidence(counts, total, message):
    request = {"cash_register_id": str(uuid4()), "inventory_snapshot_id": str(uuid4()), "denomination_counts": counts}
    if total is not None:
        request["opening_cash_minor"] = total
    with pytest.raises(ValidationError, match=message):
        OpenShiftDTO.model_validate(request)


def test_open_shift_accepts_manual_total_without_denomination_breakdown():
    payload = OpenShiftDTO.model_validate(
        {
            "cash_register_id": str(uuid4()),
            "inventory_snapshot_id": str(uuid4()),
            "opening_cash_minor": 12345,
        }
    )

    assert payload.opening_cash_minor == 12345
    assert payload.denomination_counts is None


@pytest.mark.parametrize("invalid_total", [None, True, 1.5, -1, 2**63])
def test_open_shift_requires_valid_explicit_total_without_denomination_breakdown(invalid_total):
    request = {
        "cash_register_id": str(uuid4()),
        "inventory_snapshot_id": str(uuid4()),
    }
    if invalid_total is not None:
        request["opening_cash_minor"] = invalid_total
    with pytest.raises(ValidationError):
        OpenShiftDTO.model_validate(request)


def test_open_shift_rejects_explicit_empty_denomination_list_as_unclear_mode():
    with pytest.raises(ValidationError):
        OpenShiftDTO.model_validate(
            {
                "cash_register_id": str(uuid4()),
                "inventory_snapshot_id": str(uuid4()),
                "opening_cash_minor": 0,
                "denomination_counts": [],
            }
        )


def test_open_shift_allows_explicit_zero_cash_counts():
    payload = OpenShiftDTO.model_validate(
        {
            "cash_register_id": str(uuid4()),
            "inventory_snapshot_id": str(uuid4()),
            "denomination_counts": [{"denomination_minor": 100, "quantity": 0}],
        }
    )
    assert payload.opening_cash_minor == 0


@pytest.mark.parametrize(
    "counts,message",
    [
        ([], "at least 1 item"),
        ([{"denomination_minor": 100, "quantity": 1}] * 2, "duplicates"),
        ([{"denomination_minor": 0, "quantity": 1}], "greater than 0"),
        ([{"denomination_minor": 100, "quantity": -1}], "greater than or equal to 0"),
        ([{"denomination_minor": 100, "quantity": True}], "valid integer"),
        ([{"denomination_minor": 100, "quantity": 1.5}], "valid integer"),
        ([{"denomination_minor": 2**63 - 1, "quantity": 2}], "signed 64-bit"),
    ],
)
def test_close_shift_rejects_invalid_denomination_evidence(counts, message):
    with pytest.raises(ValidationError, match=message):
        CloseShiftDTO.model_validate({"denomination_counts": counts})


@pytest.mark.parametrize("value", [True, 1.5, -1, 2**63])
def test_close_shift_rejects_invalid_manual_total(value):
    with pytest.raises(ValidationError):
        CloseShiftDTO.model_validate({"counted_cash_minor": value})


@pytest.mark.parametrize("body", [{}, {"denomination_counts": []}, {"counted_cash_minor": 1, "denomination_counts": [{"denomination_minor": 1, "quantity": 1}]}])
def test_close_shift_requires_one_unambiguous_capture_mode(body):
    with pytest.raises(ValidationError):
        CloseShiftDTO.model_validate(body)


def test_close_shift_endpoint_persists_server_owned_cash_cut(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "close-route", "Close Route")
        staff_id, token = _seed_receptionist(factory, branch_id, "close-route@example.invalid")
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "close", "Close Register")
            shift = open_shift(
                session,
                register_id=register.id,
                opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 2}],
            )
            shift_id = shift.id

        app = create_app(configured_settings(url))
        headers = {"Authorization": f"Bearer {token}"}
        body = {"denomination_counts": [{"denomination_minor": 500, "quantity": 2}]}
        with TestClient(app) as client:
            response = client.post(f"/api/v1/shifts/{shift_id}/close", json=body, headers=headers)
            assert response.status_code == 201, response.text
            closed = response.json()
            assert closed["status"] == "closed"
            assert closed["closed_by"] == str(staff_id)
            assert closed["expected_cash_at_close_minor"] == 200
            assert closed["counted_cash_minor"] == 1000
            assert closed["difference_minor"] == 800

            retry = client.post(f"/api/v1/shifts/{shift_id}/close", json=body, headers=headers)
            assert retry.status_code == 200
            assert retry.json() == closed
            conflict = client.post(
                f"/api/v1/shifts/{shift_id}/close",
                json={"denomination_counts": [{"denomination_minor": 1000, "quantity": 1}]},
                headers=headers,
            )
            assert conflict.status_code == 409
    finally:
        engine.dispose()


def test_close_shift_endpoint_accepts_manual_total_and_persists_notes(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "close-manual", "Manual Close Branch")
        staff_id, token = _seed_receptionist(factory, branch_id, "close-manual@example.invalid")
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "close-manual", "Manual Close Register")
            shift = open_shift(session, register_id=register.id, opened_by=staff_id,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 4}])
            shift_id = shift.id
        app = create_app(configured_settings(url))
        headers = {"Authorization": f"Bearer {token}"}
        body = {"counted_cash_minor": 250, "closing_notes": "  Drawer was short  "}
        with TestClient(app) as client:
            response = client.post(f"/api/v1/shifts/{shift_id}/close", json=body, headers=headers)
            assert response.status_code == 201, response.text
            closed = response.json()
            assert closed["counted_cash_minor"] == 250
            assert closed["difference_minor"] == -150
            assert closed["closing_notes"] == "Drawer was short"
            assert closed["closing_denomination_counts"] == []
            assert client.get(f"/api/v1/shifts/{shift_id}", headers=headers).json() == closed
            assert client.post(f"/api/v1/shifts/{shift_id}/close", json=body, headers=headers).status_code == 200
            for changed in (
                {"counted_cash_minor": 251, "closing_notes": "Drawer was short"},
                {"counted_cash_minor": 250, "closing_notes": "Different note"},
                {"denomination_counts": [{"denomination_minor": 250, "quantity": 1}], "closing_notes": "Drawer was short"},
            ):
                assert client.post(f"/api/v1/shifts/{shift_id}/close", json=changed, headers=headers).status_code == 409
            assert client.post(f"/api/v1/shifts/{shift_id}/close", json={"counted_cash_minor": True}, headers=headers).status_code == 422
            assert client.post(f"/api/v1/shifts/{shift_id}/close", json={"denomination_counts": []}, headers=headers).status_code == 422
    finally:
        engine.dispose()


def test_open_shift_read_exposes_live_expected_cash_without_freezing_close_total(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "cash-preview", "Cash Preview Branch")
        staff_id, token = _seed_receptionist(factory, branch_id, "cash-preview@example.invalid")
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "cash-preview", "Cash Preview Register")
            shift = open_shift(session, register_id=register.id, opened_by=staff_id,
                               denomination_counts=[{"denomination_minor": 1000, "quantity": 1}])
            shift_id = shift.id
        app = create_app(configured_settings(url))
        headers = {"Authorization": f"Bearer {token}"}
        with TestClient(app) as client:
            current = client.get(f"/api/v1/shifts/{shift_id}", headers=headers)
            assert current.status_code == 200, current.text
            assert current.json()["expected_cash_at_close_minor"] is None
            assert current.json()["current_expected_cash_minor"] == 1000
            closed = client.post(
                f"/api/v1/shifts/{shift_id}/close",
                json={"denomination_counts": [{"denomination_minor": 1000, "quantity": 1}]},
                headers=headers,
            )
            assert closed.status_code == 201, closed.text
            assert closed.json()["expected_cash_at_close_minor"] == current.json()["current_expected_cash_minor"]
            assert closed.json()["current_expected_cash_minor"] is None

            with factory.begin() as session:
                open_shift(session, register_id=UUID(closed.json()["cash_register_id"]), opened_by=staff_id,
                           denomination_counts=[{"denomination_minor": 100, "quantity": 1}])

            history = client.get(f"/api/v1/shifts?register_id={closed.json()['cash_register_id']}&limit=1", headers=headers)
            assert history.status_code == 200, history.text
            assert history.json()["total"] == 2
            assert history.json()["offset"] == 0
            assert history.json()["limit"] == 1
            first_page_id = history.json()["items"][0]["id"]
            next_page = client.get(
                f"/api/v1/shifts?register_id={closed.json()['cash_register_id']}&offset=1&limit=1", headers=headers
            )
            assert next_page.status_code == 200, next_page.text
            assert next_page.json()["total"] == 2
            assert next_page.json()["offset"] == 1
            assert next_page.json()["items"][0]["id"] != first_page_id

            other_branch = _seed_branch(factory, "other-history", "Other History Branch")
            with factory.begin() as session:
                other_register = create_cash_register(session, other_branch, "other-history", "Other History Register")
                other_register_id = other_register.id
            denied = client.get(f"/api/v1/shifts?register_id={other_register_id}", headers=headers)
            assert denied.status_code == 403
    finally:
        engine.dispose()


def test_shift_summary_uses_supported_financial_read_model_and_branch_protection(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "summary-route", "Summary Route")
        _staff_id, token = _seed_receptionist(factory, branch_id, "summary-route@example.invalid")
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "summary-route", "Summary Register")
            shift = open_shift(session, register_id=register.id, opened_by=_staff_id,
                                denomination_counts=[{"denomination_minor": 1000, "quantity": 2}])
            shift_id = shift.id
        app = create_app(configured_settings(url))
        headers = {"Authorization": f"Bearer {token}"}
        with TestClient(app) as client:
            response = client.get(f"/api/v1/shifts/{shift_id}/summary", headers=headers)
            assert response.status_code == 200, response.text
            assert response.json() == {
                "shift_id": str(shift_id), "confirmed_minor": 0, "confirmed_cash_minor": 0,
                "pending_transfer_minor": 0, "payment_methods": [], "activities": [], "payments": [],
                "expected_cash_minor": 2000,
            }
            other_branch = _seed_branch(factory, "summary-other", "Other Branch")
            with factory.begin() as session:
                other_register = create_cash_register(session, other_branch, "summary-other", "Other Register")
                other_shift = open_shift(session, register_id=other_register.id, opened_by=_staff_id,
                                          denomination_counts=[{"denomination_minor": 100, "quantity": 1}])
                other_shift_id = other_shift.id
            denied = client.get(f"/api/v1/shifts/{other_shift_id}/summary", headers=headers)
            assert denied.status_code == 403
    finally:
        engine.dispose()


def test_shift_summary_matches_cash_sale_debt_receipt_and_pending_transfer(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "summary-activity", "Summary Activity")
        staff_id, token = _seed_receptionist(factory, branch_id, "summary-activity@example.invalid")
        with factory.begin() as session:
            member = Member(member_number="SOC-SHIFT-SUMMARY", full_name="Summary Member", phone="5550190")
            plan = Plan(code="shift-summary-plan", name="Summary Plan", kind="membership", status="active")
            session.add_all([member, plan])
            session.flush()
            version = PlanVersion(plan_id=plan.id, version_number=1, name="Summary Plan", price_minor=10000,
                                  currency="MXN", duration_value=1, duration_unit="month", is_active=True)
            session.add(version)
            session.flush()
            register = create_cash_register(session, branch_id, "summary-activity", "Summary Activity Register")
            shift = open_shift(session, register_id=register.id, opened_by=staff_id,
                               denomination_counts=[{"denomination_minor": 1000, "quantity": 2}])
            register_id, member_id, version_id, shift_id = register.id, member.id, version.id, shift.id

        app = create_app(configured_settings(url))
        headers = {"Authorization": f"Bearer {token}"}
        with TestClient(app) as client:
            sale = client.post(f"/api/v1/registers/{register_id}/membership-sales",
                               headers={**headers, "Idempotency-Key": "summary-cash-sale"},
                               json={"member_id": str(member_id), "plan_version_id": str(version_id), "cash_amount_minor": 4000})
            assert sale.status_code == 201, sale.text
            order_id = sale.json()["order"]["id"]
            transfer = client.post(f"/api/v1/registers/{register_id}/membership-transfer-sales",
                                   headers={**headers, "Idempotency-Key": "summary-transfer"},
                                   json={"member_id": str(member_id), "plan_version_id": str(version_id)})
            assert transfer.status_code == 201, transfer.text
            receipt = client.post(f"/api/v1/registers/{register_id}/membership-debt-payments",
                                  headers={**headers, "Idempotency-Key": "summary-debt-receipt"},
                                  json={"order_id": order_id, "amount_minor": 2500})
            assert receipt.status_code == 201, receipt.text

            summary = client.get(f"/api/v1/shifts/{shift_id}/summary", headers=headers)
            assert summary.status_code == 200, summary.text
            body = summary.json()
            assert body["confirmed_minor"] == 6500
            assert body["confirmed_cash_minor"] == 6500
            assert body["pending_transfer_minor"] == 10000
            assert body["expected_cash_minor"] == 8500
            assert body["payment_methods"] == [{"method": "cash", "count": 2, "amount_minor": 6500}]
            assert len(body["payments"]) == 3
            assert {item["status"] for item in body["payments"]} == {"confirmed", "under_review"}
    finally:
        engine.dispose()


def test_shift_denomination_constraints_reject_invalid_and_duplicate_rows(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id = _seed_staff_user(factory)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "denom", "Denomination Test")
            shift = open_shift(
                session,
                register_id=register.id,
                opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 2}],
            )
            shift_id = shift.id

        with factory() as session:
            session.add(ShiftDenominationCount(shift_id=shift_id, denomination_minor=100, quantity=1))
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()
            session.add(ShiftDenominationCount(shift_id=shift_id, denomination_minor=0, quantity=1))
            with pytest.raises(IntegrityError):
                session.commit()
    finally:
        engine.dispose()


def test_shift_closing_denomination_constraints_reject_invalid_and_duplicate_rows(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "close-denom", "Close Denomination")
        staff_id = _seed_staff_user(factory)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "close-denom", "Close Denomination")
            shift = open_shift(
                session,
                register_id=register.id,
                opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
            )
            result = close_shift(
                session,
                shift_id=shift.id,
                closed_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 1}],
            )
            shift_id = result.shift.id

        with factory() as session:
            session.add(ShiftClosingDenominationCount(shift_id=shift_id, denomination_minor=100, quantity=2))
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()
            session.add(ShiftClosingDenominationCount(shift_id=shift_id, denomination_minor=0, quantity=1))
            with pytest.raises(IntegrityError):
                session.commit()
    finally:
        engine.dispose()


def test_shift_and_denomination_counts_rollback_together(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id = _seed_staff_user(factory)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "atomic", "Atomic Test")
            register_id = register.id

        with factory() as session:
            shift = open_shift(
                session,
                register_id=register_id,
                opened_by=staff_id,
                denomination_counts=[{"denomination_minor": 100, "quantity": 2}],
            )
            shift_id = shift.id
            session.rollback()

        with factory() as session:
            assert get_shift_by_id(session, shift_id) is None
            assert session.query(ShiftDenominationCount).filter_by(shift_id=shift_id).count() == 0
    finally:
        engine.dispose()


def _setup_db(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'shifts-test.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    return url, engine, factory


def _seed_branch(factory, code="central", name="Central Branch") -> UUID:
    with factory.begin() as session:
        branch = Branch(code=code, name=name)
        session.add(branch)
        session.flush()
        return branch.id


def _seed_staff_user(factory, login="staff@evogym.com") -> UUID:
    with factory.begin() as session:
        staff = StaffUser(login_identifier=login)
        session.add(staff)
        session.flush()
        return staff.id


def _seed_receptionist(factory, branch_id: UUID, login="receptionist@evogym.com", pin="1234") -> tuple[UUID, str]:
    with factory.begin() as session:
        staff = StaffUser(login_identifier=login)
        session.add(staff)
        session.flush()
        session.add_all([
            RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch_id),
            StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin(pin)),
        ])
        staff_id = staff.id

    now = datetime.now(timezone.utc)
    issued = issue_session(factory, login, pin, branch_id, now + timedelta(hours=1))
    return staff_id, issued.token


# ==============================================================================
# Model & Query Level Tests
# ==============================================================================


def test_payment_terminal_creation_and_per_branch_uniqueness(tmp_path):
    """Verify terminal creation, listing, and per-branch code uniqueness."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        b1 = _seed_branch(factory, "branch-1", "Branch One")
        b2 = _seed_branch(factory, "branch-2", "Branch Two")

        with factory() as session:
            t1 = create_payment_terminal(
                session,
                branch_id=b1,
                code="point_01",
                name="Point Central 1",
                device_id="MP-POINT-001",
                provider="mercado_pago",
            )
            session.commit()
            assert t1.id is not None
            assert t1.code == "point_01"
            assert t1.status == "active"

        # Duplicate code in same branch must fail
        with factory() as session:
            with pytest.raises(IntegrityError):
                create_payment_terminal(
                    session,
                    branch_id=b1,
                    code="point_01",
                    name="Duplicate Code Point",
                    device_id="MP-POINT-002",
                )

        # Same code in a different branch must succeed
        with factory() as session:
            t_b2 = create_payment_terminal(
                session,
                branch_id=b2,
                code="point_01",
                name="Point Branch 2",
                device_id="MP-POINT-003",
            )
            session.commit()
            assert t_b2.id is not None

        # Listing terminals filtered by branch
        with factory() as session:
            b1_terms = list_payment_terminals(session, branch_id=b1)
            assert len(b1_terms) == 1
            assert b1_terms[0].code == "point_01"

            all_terms = list_payment_terminals(session)
            assert len(all_terms) == 2
    finally:
        engine.dispose()


def test_cash_register_creation_and_terminal_linkage(tmp_path):
    """Verify cash register creation, terminal linkage, and uniqueness."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        b1 = _seed_branch(factory, "branch-1", "Branch One")

        with factory() as session:
            terminal = create_payment_terminal(
                session,
                branch_id=b1,
                code="term_front",
                name="Front Desk Terminal",
                device_id="MP-DEV-99",
            )
            session.commit()
            term_id = terminal.id

        with factory() as session:
            reg = create_cash_register(
                session,
                branch_id=b1,
                code="reg_01",
                name="Register 01",
                default_terminal_id=term_id,
            )
            session.commit()
            assert reg.id is not None
            assert reg.code == "reg_01"
            assert reg.default_terminal_id == term_id

        with factory() as session:
            loaded_reg = get_cash_register(session, reg.id)
            assert loaded_reg is not None
            assert loaded_reg.default_terminal is not None
            assert loaded_reg.default_terminal.id == term_id
            assert loaded_reg.default_terminal.code == "term_front"

        # Duplicate register code in same branch must fail
        with factory() as session:
            with pytest.raises(IntegrityError):
                create_cash_register(
                    session,
                    branch_id=b1,
                    code="reg_01",
                    name="Duplicate Register",
                )
    finally:
        engine.dispose()


def test_shift_open_lifecycle_and_single_active_invariant(tmp_path):
    """Verify shift opening, actor/timestamp retention, and at most one open shift per register."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        b1 = _seed_branch(factory)
        staff1_id = _seed_staff_user(factory, "staff1@evogym.com")
        staff2_id = _seed_staff_user(factory, "staff2@evogym.com")

        with factory() as session:
            reg1 = create_cash_register(session, branch_id=b1, code="reg_main", name="Main Register")
            reg2 = create_cash_register(session, branch_id=b1, code="reg_side", name="Side Register")
            session.commit()
            reg1_id = reg1.id
            reg2_id = reg2.id

        # 1. Open shift on reg1
        with factory() as session:
            shift1 = open_shift(
                session,
                register_id=reg1_id,
                opened_by=staff1_id,
                opening_cash_minor=50000,
                denomination_counts=[{"denomination_minor": 1, "quantity": 50000}],  # $500.00
            )
            session.commit()
            assert shift1.id is not None
            assert shift1.status == "open"
            assert shift1.opening_cash_minor == 50000
            assert [(item.denomination_minor, item.quantity) for item in shift1.denomination_counts] == [(1, 50000)]
            assert shift1.opened_by == staff1_id
            assert shift1.opened_at is not None
            assert shift1.closed_at is None
            shift1_id = shift1.id

        # 2. Attempting to open a second shift on reg1 raises ShiftAlreadyOpenError
        with factory() as session:
            with pytest.raises(ShiftAlreadyOpenError):
                open_shift(
                    session,
                    register_id=reg1_id,
                    opened_by=staff2_id,
                    opening_cash_minor=20000,
                denomination_counts=[{"denomination_minor": 1, "quantity": 20000}],
                )

        # 3. Direct DB insert violating partial unique index uq_shifts_active_per_register raises IntegrityError
        with factory() as session:
            illegal_shift = Shift(
                cash_register_id=reg1_id,
                opened_by=staff2_id,
                opening_cash_minor=10000,
                status="open",
            )
            session.add(illegal_shift)
            with pytest.raises(IntegrityError):
                session.commit()

        # 4. Opening a shift on reg2 succeeds (independent registers)
        with factory() as session:
            shift2 = open_shift(
                session,
                register_id=reg2_id,
                opened_by=staff2_id,
                opening_cash_minor=30000,
                denomination_counts=[{"denomination_minor": 1, "quantity": 30000}],
            )
            session.commit()
            assert shift2.id is not None
            assert shift2.status == "open"

        # 5. Get current open shift
        with factory() as session:
            current = get_open_shift(session, reg1_id)
            assert current is not None
            assert current.id == shift1_id

            shift_by_id = get_shift_by_id(session, shift1_id)
            assert shift_by_id is not None
            assert shift_by_id.cash_register_id == reg1_id

        # 6. Close shift 1, now a new shift can be opened on reg1
        with factory() as session:
            s1 = session.get(Shift, shift1_id)
            s1.status = "closed"
            s1.closed_by = staff1_id
            s1.closed_at = datetime.now(timezone.utc)
            s1.counted_cash_minor = 55000
            session.commit()

        with factory() as session:
            # Current open shift is now None
            assert get_open_shift(session, reg1_id) is None

            # New shift can now be opened on reg1
            shift3 = open_shift(
                session,
                register_id=reg1_id,
                opened_by=staff2_id,
                opening_cash_minor=60000,
                denomination_counts=[{"denomination_minor": 1, "quantity": 60000}],
            )
            session.commit()
            assert shift3.id is not None
            assert shift3.status == "open"
    finally:
        engine.dispose()


def test_negative_opening_cash_rejected(tmp_path):
    """Verify negative opening cash is rejected both by Python check and DB constraint."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        b1 = _seed_branch(factory)
        staff_id = _seed_staff_user(factory)

        with factory() as session:
            reg = create_cash_register(session, branch_id=b1, code="reg_neg", name="Negative Reg")
            session.commit()
            reg_id = reg.id

        # Python check
        with factory() as session:
            with pytest.raises(ValueError, match="Opening cash cannot be negative"):
                open_shift(session, register_id=reg_id, opened_by=staff_id, opening_cash_minor=-100, denomination_counts=[{"denomination_minor": 1, "quantity": 0}])

        # Database CheckConstraint
        with factory() as session:
            neg_shift = Shift(
                cash_register_id=reg_id,
                opened_by=staff_id,
                opening_cash_minor=-500,
                status="open",
            )
            session.add(neg_shift)
            with pytest.raises(IntegrityError):
                session.commit()
    finally:
        engine.dispose()


def test_concurrent_open_shift_yields_exactly_one_success(tmp_path):
    """Simulate concurrent threads attempting to open shift on the same register simultaneously."""
    _url, engine, factory = _setup_db(tmp_path)
    try:
        b1 = _seed_branch(factory)
        staff1_id = _seed_staff_user(factory, "worker1@evogym.com")
        staff2_id = _seed_staff_user(factory, "worker2@evogym.com")

        with factory() as session:
            reg = create_cash_register(session, branch_id=b1, code="reg_race", name="Race Register")
            session.commit()
            reg_id = reg.id

        results = []
        errors = []

        def attempt_open(staff_id: UUID, cash: int):
            try:
                with factory() as session:
                    shift = open_shift(
                        session,
                        register_id=reg_id,
                        opened_by=staff_id,
                        opening_cash_minor=cash,
                denomination_counts=[{"denomination_minor": 1, "quantity": cash}],
                    )
                    session.commit()
                    results.append(shift.id)
            except ShiftAlreadyOpenError as err:
                errors.append(err)
            except Exception as e:
                errors.append(e)

        with ThreadPoolExecutor(max_workers=2) as executor:
            f1 = executor.submit(attempt_open, staff1_id, 10000)
            f2 = executor.submit(attempt_open, staff2_id, 20000)
            f1.result()
            f2.result()

        # Exactly one open attempt must have succeeded and one must have failed with ShiftAlreadyOpenError
        assert len(results) == 1, f"Expected 1 success, got {len(results)}"
        assert len(errors) == 1, f"Expected 1 error, got {len(errors)}"
        assert isinstance(errors[0], ShiftAlreadyOpenError)
    finally:
        engine.dispose()


# ==============================================================================
# API & RBAC Integration Tests
# ==============================================================================


def test_manual_total_opening_roundtrips_without_fabricated_denominations(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory, "manual-branch", "Manual Branch")
        staff_id, token = _seed_receptionist(factory, branch_id, "manual@evogym.com", "1234")
        with factory() as session:
            register = create_cash_register(session, branch_id=branch_id, code="manual", name="Manual")
            snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=staff_id)
            register_id = str(register.id)
            snapshot_id = str(snapshot.id)
            session.commit()
        app = create_app(configured_settings(url), recovery_delivery=FakeRecoveryDelivery())
        headers = {"Authorization": f"Bearer {token}"}
        with TestClient(app) as client:
            empty_counts = client.post(
                "/api/v1/shifts/open", headers=headers,
                json={"cash_register_id": register_id, "inventory_snapshot_id": snapshot_id,
                      "opening_cash_minor": 0, "denomination_counts": []},
            )
            assert empty_counts.status_code == 422
            opened = client.post(
                "/api/v1/shifts/open", headers=headers,
                json={"cash_register_id": register_id, "inventory_snapshot_id": snapshot_id,
                      "opening_cash_minor": 12345},
            )
            assert opened.status_code == 201, opened.text
            shift = opened.json()
            assert shift["opening_cash_minor"] == 12345
            assert shift["opened_by"] == str(staff_id)
            assert shift["denomination_counts"] == []
            current = client.get(f"/api/v1/shifts/current?register_id={register_id}", headers=headers)
            assert current.status_code == 200
            assert current.json()["id"] == shift["id"]
            assert current.json()["denomination_counts"] == []
        with factory() as session:
            assert session.query(ShiftDenominationCount).filter_by(shift_id=UUID(shift["id"])).count() == 0
    finally:
        engine.dispose()


def test_shifts_and_registers_rbac_and_api(tmp_path):
    """Verify RBAC permissions for Receptionist vs Admin across terminals, registers, and shifts."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch1_id = _seed_branch(factory, "branch-1", "Branch 1")
        branch2_id = _seed_branch(factory, "branch-2", "Branch 2")

        _staff1_id, recep1_token = _seed_receptionist(factory, branch1_id, "receptionist1@evogym.com", "1111")
        _staff2_id, recep2_token = _seed_receptionist(factory, branch2_id, "receptionist2@evogym.com", "2222")

        seed_admin(factory, "admin@example.invalid", "super-admin-pass")
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        r1_headers = {"Authorization": f"Bearer {recep1_token}"}
        r2_headers = {"Authorization": f"Bearer {recep2_token}"}

        with TestClient(app) as client:
            admin_headers = approved_admin_headers(client, delivery, "admin@example.invalid", "super-admin-pass")
            # 1. Unauthenticated gets 401
            assert client.get("/api/v1/terminals").status_code == 401
            assert client.get("/api/v1/registers").status_code == 401
            assert client.post("/api/v1/shifts/open", json={"cash_register_id": str(uuid4()), "opening_cash_minor": 0}).status_code == 401

            # 2. Receptionist cannot create a terminal (403)
            res_r_term = client.post(
                "/api/v1/terminals",
                headers=r1_headers,
                json={
                    "branch_id": str(branch1_id),
                    "code": "term_b1",
                    "name": "B1 Terminal",
                    "device_id": "DEV-01",
                },
            )
            assert res_r_term.status_code == 403

            # 3. Receptionist cannot create a cash register (403)
            res_r_reg = client.post(
                "/api/v1/registers",
                headers=r1_headers,
                json={
                    "branch_id": str(branch1_id),
                    "code": "reg_b1",
                    "name": "B1 Cash Register",
                },
            )
            assert res_r_reg.status_code == 403

            # 4. Admin creates terminal for branch 1 (201)
            res_a_t1 = client.post(
                "/api/v1/terminals",
                headers=admin_headers,
                json={
                    "branch_id": str(branch1_id),
                    "code": "term_b1",
                    "name": "B1 Terminal",
                    "device_id": "DEV-01",
                },
            )
            assert res_a_t1.status_code == 201
            t1_data = res_a_t1.json()
            assert t1_data["code"] == "term_b1"
            assert t1_data["provider"] == "mercado_pago"
            t1_id = t1_data["id"]

            # Admin duplicate code in same branch -> 409
            res_a_dup_term = client.post(
                "/api/v1/terminals",
                headers=admin_headers,
                json={
                    "branch_id": str(branch1_id),
                    "code": "term_b1",
                    "name": "Duplicate Code",
                    "device_id": "DEV-02",
                },
            )
            assert res_a_dup_term.status_code == 409

            # 5. Admin creates cash registers for branch 1 and branch 2
            res_a_reg1 = client.post(
                "/api/v1/registers",
                headers=admin_headers,
                json={
                    "branch_id": str(branch1_id),
                    "code": "caja_01",
                    "name": "Caja 1 Front Desk",
                    "default_terminal_id": t1_id,
                },
            )
            assert res_a_reg1.status_code == 201
            reg1_data = res_a_reg1.json()
            assert reg1_data["code"] == "caja_01"
            assert reg1_data["has_open_shift"] is False
            reg1_id = reg1_data["id"]

            res_a_reg2 = client.post(
                "/api/v1/registers",
                headers=admin_headers,
                json={
                    "branch_id": str(branch2_id),
                    "code": "caja_b2",
                    "name": "Caja Branch 2",
                },
            )
            assert res_a_reg2.status_code == 201
            reg2_id = res_a_reg2.json()["id"]

            # Admin duplicate register code in same branch -> 409
            res_a_dup_reg = client.post(
                "/api/v1/registers",
                headers=admin_headers,
                json={
                    "branch_id": str(branch1_id),
                    "code": "caja_01",
                    "name": "Duplicate Register",
                },
            )
            assert res_a_dup_reg.status_code == 409

            # 6. Receptionist 1 lists terminals in Branch 1 (sees 1)
            res_r1_terms = client.get("/api/v1/terminals", headers=r1_headers)
            assert res_r1_terms.status_code == 200
            assert len(res_r1_terms.json()) == 1

            # Receptionist 1 trying to list branch 2 terminals -> 403
            res_r1_terms_b2 = client.get(f"/api/v1/terminals?branch_id={branch2_id}", headers=r1_headers)
            assert res_r1_terms_b2.status_code == 403

            # Receptionist 1 lists registers (sees only Branch 1 register)
            res_r1_regs = client.get("/api/v1/registers", headers=r1_headers)
            assert res_r1_regs.status_code == 200
            regs = res_r1_regs.json()
            assert len(regs) == 1
            assert regs[0]["id"] == reg1_id
            assert regs[0]["has_open_shift"] is False

            # Receptionist 1 checks current shift when none open -> 404
            res_r1_curr_none = client.get(f"/api/v1/shifts/current?register_id={reg1_id}", headers=r1_headers)
            assert res_r1_curr_none.status_code == 404

            # 7. Receptionist 1 opens shift on Branch 1 register (201)
            with factory() as session:
                opening_snapshot = capture_register_inventory_snapshot(
                    session, register_id=UUID(reg1_id), actor_id=_staff1_id
                )
                opening_snapshot_id = str(opening_snapshot.id)
                session.commit()
            res_r1_open = client.post(
                "/api/v1/shifts/open",
                headers=r1_headers,
                json={
                    "cash_register_id": reg1_id,
                    "inventory_snapshot_id": opening_snapshot_id,
                    "opening_cash_minor": 150000,
                    "denomination_counts": [{"denomination_minor": 1, "quantity": 150000}],  # $1,500.00
                },
            )
            assert res_r1_open.status_code == 201
            shift1_data = res_r1_open.json()
            assert shift1_data["cash_register_id"] == reg1_id
            assert shift1_data["status"] == "open"
            assert shift1_data["opening_cash_minor"] == 150000
            assert shift1_data["denomination_counts"] == [{"denomination_minor": 1, "quantity": 150000}]
            assert shift1_data["inventory_review"]["mode"] == "no_changes_declared"
            assert shift1_data["inventory_review"]["source_state"] == "empty_catalog"
            shift1_id = shift1_data["id"]

            # Receptionist 1 trying to open SECOND shift on same register -> 409
            with factory() as session:
                duplicate_snapshot = capture_register_inventory_snapshot(
                    session, register_id=UUID(reg1_id), actor_id=_staff1_id
                )
                duplicate_snapshot_id = str(duplicate_snapshot.id)
                session.commit()
            res_r1_open_dup = client.post(
                "/api/v1/shifts/open",
                headers=r1_headers,
                json={
                    "cash_register_id": reg1_id,
                    "inventory_snapshot_id": duplicate_snapshot_id,
                    "opening_cash_minor": 50000,
                    "denomination_counts": [{"denomination_minor": 1, "quantity": 50000}],
                },
            )
            assert res_r1_open_dup.status_code == 409

            # Negative opening cash -> 422
            res_r1_open_neg = client.post(
                "/api/v1/shifts/open",
                headers=r1_headers,
                json={
                    "cash_register_id": reg1_id,
                    "inventory_snapshot_id": opening_snapshot_id,
                    "opening_cash_minor": -10,
                    "denomination_counts": [{"denomination_minor": 1, "quantity": -10}],
                },
            )
            assert res_r1_open_neg.status_code == 422

            # Receptionist 1 attempting to open shift on Branch 2 register -> 403
            res_r1_open_b2 = client.post(
                "/api/v1/shifts/open",
                headers=r1_headers,
                json={
                    "cash_register_id": reg2_id,
                    "inventory_snapshot_id": str(uuid4()),
                    "opening_cash_minor": 10000,
                    "denomination_counts": [{"denomination_minor": 1, "quantity": 10000}],
                },
            )
            assert res_r1_open_b2.status_code == 403

            # Receptionist 1 queries current shift -> 200 with open shift
            res_r1_curr = client.get(f"/api/v1/shifts/current?register_id={reg1_id}", headers=r1_headers)
            assert res_r1_curr.status_code == 200
            assert res_r1_curr.json()["id"] == shift1_id
            assert res_r1_curr.json()["denomination_counts"] == [{"denomination_minor": 1, "quantity": 150000}]

            # Receptionist 1 queries shift by ID -> 200
            res_r1_shift_by_id = client.get(f"/api/v1/shifts/{shift1_id}", headers=r1_headers)
            assert res_r1_shift_by_id.status_code == 200
            assert res_r1_shift_by_id.json()["id"] == shift1_id
            assert res_r1_shift_by_id.json()["denomination_counts"] == [{"denomination_minor": 1, "quantity": 150000}]

            # Registers list now reflects has_open_shift=True
            res_r1_regs_updated = client.get("/api/v1/registers", headers=r1_headers)
            assert res_r1_regs_updated.status_code == 200
            assert res_r1_regs_updated.json()[0]["has_open_shift"] is True

            # Admin can list all registers across branches
            res_a_all_regs = client.get("/api/v1/registers", headers=admin_headers)
            assert res_a_all_regs.status_code == 200
            assert len(res_a_all_regs.json()) == 2
    finally:
        engine.dispose()
