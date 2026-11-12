"""Acceptance tests for cash movements recorded against a shift."""

from fastapi.testclient import TestClient

from app.main import create_app
from app.db.models import StaffRosterProfile
from app.shifts.queries import create_cash_register
from test_admin_auth import FakeRecoveryDelivery, configured_settings, seed_admin
from admin_session_helpers import approved_admin_headers
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
        seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            admin = approved_admin_headers(client, delivery)
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
            assert client.post(f"/api/v1/expenses/{expense.json()['id']}/void", headers=headers, json={"reason": "Duplicate"}).status_code == 403
            voided = client.post(f"/api/v1/expenses/{expense.json()['id']}/void", headers=admin, json={"reason": "Duplicate"})
            assert voided.status_code == 200
            assert client.get(f"/api/v1/registers/{register_id}/expenses", headers=headers).json()["total_minor"] == 0
            assert client.get(f"/api/v1/shifts/{shift_id}/summary", headers=headers).json()["expected_cash_minor"] == 1000
            same_void = client.post(f"/api/v1/expenses/{expense.json()['id']}/void", headers=admin, json={"reason": "Duplicate"})
            assert same_void.status_code == 200
            assert client.post(f"/api/v1/expenses/{expense.json()['id']}/void", headers=admin, json={"reason": "Different"}).status_code == 409
            assert client.post(f"/api/v1/shifts/{shift_id}/close", headers=headers, json={"counted_cash_minor": 1000}).status_code == 201
            replay_after_close = client.post(f"/api/v1/expenses/{expense.json()['id']}/void", headers=admin, json={"reason": "Duplicate"})
            assert replay_after_close.status_code == 200 and replay_after_close.json()["id"] == expense.json()["id"]
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
        seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            admin = approved_admin_headers(client, delivery)
            created = client.post(f"/api/v1/registers/{register_id}/expenses", headers=headers,
                                  json={"category": "limpieza", "concept": "Soap", "payee_name": "Shop", "amount_minor": 800})
            assert created.status_code == 201
            summary = client.get(f"/api/v1/shifts/{shift_id}/summary", headers=headers).json()
            assert summary["expected_cash_minor"] == -600
            closed = client.post(f"/api/v1/shifts/{shift_id}/close", headers=headers, json={"counted_cash_minor": 0, "closing_notes": "Diferencia por gasto"})
            assert closed.status_code == 201
            assert closed.json()["expected_cash_at_close_minor"] == -600
            assert closed.json()["difference_minor"] == 600
            void_path = f"/api/v1/expenses/{created.json()['id']}/void"
            assert client.post(void_path, headers=headers, json={"reason": "Mistake"}).status_code == 403
            assert client.post(void_path, headers=admin, json={"reason": "Mistake"}).status_code == 409
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



def test_business_expense_and_void_are_persisted(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        seed_admin(factory)
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            headers = {**approved_admin_headers(client, delivery), "Idempotency-Key": "business-1"}
            body = {"branch_id": str(branch_id), "category": "mantenimiento_cardio", "concept": "Repair",
                    "payee_name": "Supplier", "amount_minor": 250000, "payment_method": "transfer"}
            created = client.post("/api/v1/admin/expenses", headers=headers, json=body)
            assert created.status_code == 201
            item = created.json()
            assert item["shift_id"] is None and item["payment_method"] == "transfer"
            replay = client.post("/api/v1/admin/expenses", headers=headers, json=body)
            assert replay.status_code == 201 and replay.json()["id"] == item["id"]
            assert client.post("/api/v1/admin/expenses", headers=headers, json={**body, "amount_minor": 1}).status_code == 409
            voided = client.post(f"/api/v1/expenses/{item['id']}/void", headers=headers, json={"reason": "Mistake"})
            assert voided.status_code == 200 and voided.json()["void_reason"] == "Mistake"
            assert client.post(f"/api/v1/expenses/{item['id']}/void", headers=headers, json={"reason": "Different"}).status_code == 409
            listed = client.get("/api/v1/admin/expenses?from=2000-01-01&to=2100-01-01", headers=headers)
            assert listed.status_code == 200
            assert listed.json()["items"][0]["void_reason"] == "Mistake"
    finally:
        engine.dispose()



def test_unconfigured_evidence_upload_validates_request(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        _, token = _seed_receptionist(factory, branch_id)
        headers = {"Authorization": f"Bearer {token}"}
        # Storage must stay unconfigured even when the ambient environment points at a live server.
        settings = configured_settings(url, evidence_s3_endpoint=None, evidence_public_endpoint=None,
                                       evidence_s3_bucket=None, evidence_s3_access_key=None, evidence_s3_secret_key=None)
        with TestClient(create_app(settings)) as client:
            path = "/api/v1/expenses/evidence-uploads"
            body = {"branch_id": str(branch_id), "content_type": "image/webp", "file_size_bytes": 100}
            assert client.post(path, headers=headers, json=body).status_code == 501
            assert client.post(path, headers=headers, json={**body, "content_type": "image/png"}).status_code == 422
            assert client.post(path, headers=headers, json={**body, "file_size_bytes": 1048577}).status_code == 422
    finally:
        engine.dispose()



def test_evidence_is_branch_scoped_and_returned_as_signed_url(tmp_path):
    class FakeStorage:
        def __init__(self):
            self.keys = set()

        def presign_put(self, key, content_type, size):
            return "https://storage.invalid/put"

        def presign_get(self, key):
            return "https://storage.invalid/signed"

        def exists(self, key):
            return key in self.keys

    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "expense", "Expense Register")
            register_id = register.id
            open_shift(session, register_id=register_id, opened_by=staff_id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 2}])
        app = create_app(configured_settings(url))
        app.state.evidence_storage = storage = FakeStorage()
        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "photo"}
        with TestClient(app) as client:
            upload = client.post("/api/v1/expenses/evidence-uploads", headers=headers,
                                 json={"branch_id": str(branch_id), "content_type": "image/webp", "file_size_bytes": 100})
            assert upload.status_code == 200
            key = upload.json()["evidence_key"]
            body = {"category": "limpieza", "concept": "Soap", "payee_name": "Supplier", "amount_minor": 100, "evidence_key": key}
            path = f"/api/v1/registers/{register_id}/expenses"
            assert client.post(path, headers=headers, json=body).status_code == 422
            storage.keys.add(key)
            assert client.post(path, headers=headers, json={**body, "evidence_key": "expenses/other/file.webp"}).status_code == 422
            created = client.post(path, headers=headers, json=body)
            assert created.status_code == 201
            assert created.json()["evidence_url"] == "https://storage.invalid/signed"
            assert "evidence_key" not in created.json()
            listed = client.get(path, headers=headers).json()["items"]
            assert listed[0]["evidence_url"] == "https://storage.invalid/signed"
            assert key not in str(listed)
    finally:
        engine.dispose()



def test_reception_and_owner_expense_scenario(tmp_path):
    """Cashier records and voids a shift expense; finance records a business expense."""
    from app.api.deps import FinancePrincipal, _principal as finance_principal

    url, engine, factory = _setup_db(tmp_path)
    try:
        branch_id = _seed_branch(factory)
        staff_id, token = _seed_receptionist(factory, branch_id)
        with factory.begin() as session:
            register = create_cash_register(session, branch_id, "scenario", "Scenario Register")
            register_id = register.id
            shift = open_shift(session, register_id=register_id, opened_by=staff_id,
                               denomination_counts=[{"denomination_minor": 100, "quantity": 2}])
            shift_id = shift.id
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)
        finance_staff_id = seed_admin(factory)
        app.dependency_overrides[finance_principal] = lambda: FinancePrincipal(finance_staff_id, True, None)
        headers = {"Authorization": f"Bearer {token}"}
        with TestClient(app) as client:
            recorded = client.post(f"/api/v1/registers/{register_id}/expenses",
                                   headers={**headers, "Idempotency-Key": "scenario-1"},
                                   json={"category": "limpieza", "concept": "Jabón", "payee_name": "Proveedor",
                                         "amount_minor": 15000, "voucher_reference": "F-15"})
            assert recorded.status_code == 201
            assert recorded.json()["voucher_reference"] == "F-15"
            history = client.get(f"/api/v1/registers/{register_id}/expenses", headers=headers).json()
            assert history["total_minor"] == 15000 and len(history["items"]) == 1

            second = client.post(f"/api/v1/registers/{register_id}/expenses", headers={**headers, "Idempotency-Key": "scenario-2"},
                                 json={"category": "consumibles", "concept": "Agua", "payee_name": "Proveedor", "amount_minor": 5000})
            assert second.status_code == 201
            admin = approved_admin_headers(client, delivery)
            voided = client.post(f"/api/v1/expenses/{second.json()['id']}/void", headers=admin, json={"reason": "Captura duplicada"})
            assert voided.status_code == 200
            assert voided.json()["void_reason"] == "Captura duplicada"
            after_void = client.get(f"/api/v1/registers/{register_id}/expenses", headers=headers).json()
            assert after_void["total_minor"] == 15000
            voided_row = next(item for item in after_void["items"] if item["id"] == second.json()["id"])
            assert voided_row["voided_at"] is not None
            assert voided_row["void_reason"] == "Captura duplicada"

            business = client.post("/api/v1/admin/expenses", headers={"Idempotency-Key": "business-scenario"},
                                   json={"branch_id": str(branch_id), "category": "mantenimiento_cardio", "concept": "Reparación",
                                         "payee_name": "Proveedor", "amount_minor": 250000, "payment_method": "transfer"})
            assert business.status_code == 201
            assert business.json()["shift_id"] is None
            summary = client.get(f"/api/v1/shifts/{shift_id}/summary", headers=headers).json()
            assert summary["expected_cash_minor"] == 200 - 15000
            assert summary["expense_minor"] == 15000

            admin_range = client.get("/api/v1/admin/expenses?from=2000-01-01&to=2100-01-01").json()
            assert [item["concept"] for item in admin_range["items"]] == ["Reparación", "Agua", "Jabón"]
            assert admin_range["items"][0]["payment_method"] == "transfer"
            assert admin_range["items"][0]["shift_id"] is None
    finally:
        engine.dispose()
