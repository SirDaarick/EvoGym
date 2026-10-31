"""Acceptance tests for cash movements recorded against a shift."""

from fastapi.testclient import TestClient

from app.main import create_app
from app.db.models import StaffRosterProfile
from app.shifts.queries import create_cash_register
from test_admin_auth import configured_settings
from test_shifts import _seed_branch, _seed_receptionist, _setup_db, open_shift


def test_shift_expense_and_contribution_reconcile_cash(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            session.add(StaffRosterProfile(branch_id=branch_id, staff_user_id=staff_id, full_name="Cashier Name", position="Reception"))
            register = create_cash_register(session, branch_id, "expense", "Expense Register")
            register_id = register.id
            shift = open_shift(session, register_id=register_id, opened_by=staff_id,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 2}])
            shift_id = shift.id

        headers = {"Authorization": f"Bearer {token}"}
        with TestClient(create_app(configured_settings(url))) as client:
            expense = client.post(f"/api/v1/registers/{register_id}/expenses", headers={**headers, "Idempotency-Key": "expense-1"},
                                  json={"category": "limpieza", "concept": "Soap", "payee_name": "Supplier", "amount_minor": 800})
            assert expense.status_code == 201
            assert expense.json()["recorded_by_name"] == "Cashier Name"
            assert expense.json()["recorded_at"].endswith(("Z", "+00:00"))
            contribution = client.post(f"/api/v1/registers/{register_id}/cash-contributions", headers={**headers, "Idempotency-Key": "extra-1"},
                                       json={"concept": "Fund", "contributor_name": "Admin", "amount_minor": 800})
            assert contribution.status_code == 201
            assert contribution.json()["recorded_by_name"] == "Cashier Name"
            assert contribution.json()["recorded_at"].endswith(("Z", "+00:00"))
            summary = client.get(f"/api/v1/shifts/{shift_id}/summary", headers=headers)
            assert summary.status_code == 200
            assert summary.json()["expected_cash_minor"] == 200
            assert summary.json()["expense_minor"] == 800
            assert summary.json()["expense_count"] == 1
            assert summary.json()["extra_minor"] == 800
            expenses = client.get(f"/api/v1/registers/{register_id}/expenses", headers=headers)
            assert expenses.status_code == 200
            assert expenses.json()["total_minor"] == 800
            assert len(expenses.json()["items"]) == 1
            extra = client.get(f"/api/v1/registers/{register_id}/cash-contributions", headers=headers)
            assert extra.status_code == 200
            assert extra.json()["total_minor"] == 800
            replay = client.post(f"/api/v1/registers/{register_id}/expenses", headers={**headers, "Idempotency-Key": "expense-1"},
                                 json={"category": "limpieza", "concept": "Soap", "payee_name": "Supplier", "amount_minor": 800})
            assert replay.status_code == 201
            assert replay.json()["id"] == expense.json()["id"]
            altered = client.post(f"/api/v1/registers/{register_id}/expenses", headers={**headers, "Idempotency-Key": "expense-1"},
                                  json={"category": "limpieza", "concept": "Soap", "payee_name": "Supplier", "amount_minor": 801})
            assert altered.status_code == 409
            assert client.get(f"/api/v1/registers/{register_id}/expenses", headers=headers).json()["total_minor"] == 800
            extra_replay = client.post(f"/api/v1/registers/{register_id}/cash-contributions", headers={**headers, "Idempotency-Key": "extra-1"},
                                       json={"concept": "Fund", "contributor_name": "Admin", "amount_minor": 800})
            assert extra_replay.status_code == 201
            assert extra_replay.json()["id"] == contribution.json()["id"]
            extra_altered = client.post(f"/api/v1/registers/{register_id}/cash-contributions", headers={**headers, "Idempotency-Key": "extra-1"},
                                        json={"concept": "Fund", "contributor_name": "Admin", "amount_minor": 801})
            assert extra_altered.status_code == 409
            assert client.get(f"/api/v1/registers/{register_id}/cash-contributions", headers=headers).json()["total_minor"] == 800
    finally:
        engine.dispose()


def test_shift_movements_reject_invalid_wrong_branch_and_closed_shift(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        other_branch = _seed_branch(factory, "other", "Other")
        staff_id, token = _seed_receptionist(factory, branch_id)
        _, other_token = _seed_receptionist(factory, other_branch, "other@example.invalid")
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "expense", "Expense Register")
            register_id = register.id
            shift = open_shift(session, register_id=register_id, opened_by=staff_id,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 2}])
            shift_id = shift.id
        with TestClient(create_app(configured_settings(url))) as client:
            path = f"/api/v1/registers/{register_id}/expenses"
            headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "invalid"}
            valid = {"category": "limpieza", "concept": "Soap", "payee_name": "Supplier", "amount_minor": 800}
            for patch in ({"amount_minor": 0}, {"amount_minor": 1.2}, {"concept": "  "},
                          {"payee_name": "  "}, {"category": "unknown"}):
                assert client.post(path, headers=headers, json={**valid, **patch}).status_code == 422
            assert client.post(path, headers={**headers, "Authorization": f"Bearer {other_token}"}, json=valid).status_code == 403
            assert client.get(path, headers=headers).json()["items"] == []
            closed = client.post(f"/api/v1/shifts/{shift_id}/close", headers=headers,
                                 json={"counted_cash_minor": 200})
            assert closed.status_code == 201
            assert client.post(path, headers=headers, json=valid).status_code == 409
            extra = client.post(f"/api/v1/registers/{register_id}/cash-contributions", headers=headers,
                                json={"concept": "Fund", "contributor_name": "Admin", "amount_minor": 800})
            assert extra.status_code == 409
    finally:
        engine.dispose()


def test_expense_can_exceed_expected_cash_and_close_shows_difference(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "expense", "Expense Register")
            register_id = register.id
            shift = open_shift(session, register_id=register_id, opened_by=staff_id,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 2}])
            shift_id = shift.id
        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "overdraft"}
        with TestClient(create_app(configured_settings(url))) as client:
            created = client.post(f"/api/v1/registers/{register_id}/expenses", headers=headers,
                                  json={"category": "limpieza", "concept": "Soap", "payee_name": "Shop", "amount_minor": 800})
            assert created.status_code == 201
            summary = client.get(f"/api/v1/shifts/{shift_id}/summary", headers=headers).json()
            assert summary["expected_cash_minor"] == -600
            closed = client.post(f"/api/v1/shifts/{shift_id}/close", headers=headers, json={"counted_cash_minor": 0})
            assert closed.status_code == 201
            assert closed.json()["expected_cash_at_close_minor"] == -600
            assert closed.json()["difference_minor"] == 600
    finally:
        engine.dispose()


def test_admin_fund_flow_keeps_expected_cash(tmp_path):
    """A contribution handed to reception and the later purchase cancel each other out."""
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "fund", "Fund Register")
            register_id = register.id
            shift = open_shift(session, register_id=register_id, opened_by=staff_id,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 2}])
            shift_id = shift.id
        headers = {"Authorization": f"Bearer {token}"}
        with TestClient(create_app(configured_settings(url))) as client:
            contribution = client.post(f"/api/v1/registers/{register_id}/cash-contributions",
                                       headers={**headers, "Idempotency-Key": "fund-1"},
                                       json={"concept": "Fondo compra garrafones", "contributor_name": "Admin", "amount_minor": 80000})
            assert contribution.status_code == 201
            expense = client.post(f"/api/v1/registers/{register_id}/expenses", headers={**headers, "Idempotency-Key": "fund-2"},
                                  json={"category": "consumibles", "concept": "Garrafones", "payee_name": "Proveedor", "amount_minor": 80000})
            assert expense.status_code == 201
            summary = client.get(f"/api/v1/shifts/{shift_id}/summary", headers=headers).json()
            assert summary["expected_cash_minor"] == 200
            assert summary["extra_minor"] == 80000
            assert summary["expense_minor"] == 80000
    finally:
        engine.dispose()
