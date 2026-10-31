"""Opt-in race proofs on an isolated PostgreSQL test schema."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
from app.db.models import RoleGrant, Shift
from app.main import create_app
from app.shifts.queries import expected_cash_for_shift
from test_admin_auth import configured_settings


@pytest.fixture
def postgres_expense_target(monkeypatch):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url
    from sqlalchemy.orm import sessionmaker

    from app.db.models import Branch, CashRegister, StaffUser
    from app.inventory.queries import capture_register_inventory_snapshot
    from app.shifts.queries import open_shift

    api_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    configured = os.getenv("EVOGYM_TEST_POSTGRES_URL")
    if not configured:
        pytest.skip("Set EVOGYM_TEST_POSTGRES_URL to a disposable local PostgreSQL instance.")
    base_url = make_url(configured)
    if not base_url.drivername.startswith("postgresql+") or base_url.host not in {"127.0.0.1", "localhost", "::1"}:
        pytest.fail("Expense race tests require a loopback-only disposable target.")
    database = f"expenses_{uuid4().hex[:12]}"
    admin_engine = create_engine(base_url, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{database}"'))
        scoped_url = base_url.set(database=database).update_query_dict({
            "options": "-c lock_timeout=5000 -c statement_timeout=15000"
        })
        monkeypatch.setenv("EVOGYM_ENV", "test")
        monkeypatch.setenv("EVOGYM_DEBUG", "false")
        monkeypatch.setenv("EVOGYM_DATABASE_URL", scoped_url.render_as_string(hide_password=False))
        command.upgrade(Config(os.path.join(api_dir, "alembic.ini")), "head")
        engine = create_engine(scoped_url)
        factory = sessionmaker(engine)
        with factory.begin() as session:
            branch = Branch(code=f"exp-{uuid4().hex[:8]}", name="Expense Branch", timezone="America/Mexico_City")
            staff = StaffUser(login_identifier=f"{uuid4()}@example.invalid")
            session.add_all([branch, staff])
            session.flush()
            register = CashRegister(branch_id=branch.id, code=f"exp-{uuid4().hex[:8]}", name="Expense Register")
            session.add(register)
            session.flush()
            snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=staff.id)
            open_shift(session, register_id=register.id, opened_by=staff.id,
                       denomination_counts=[{"denomination_minor": 100, "quantity": 2}],
                       inventory_snapshot_id=snapshot.id)
            ids = (branch.id, staff.id, register.id)
        yield factory, ids, scoped_url.render_as_string(hide_password=False)
        engine.dispose()
    finally:
        with admin_engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)'))
        admin_engine.dispose()


@pytest.mark.parametrize("movement", ["expense", "contribution", "void", "concurrent_void"])
def test_cash_movements_serialize_with_close(postgres_expense_target, movement):
    factory, ids, url = postgres_expense_target
    branch_id, staff_id, register_id = ids
    with factory.begin() as session:
        session.add(RoleGrant(staff_id=staff_id, role="receptionist", scope_kind="branch", branch_id=branch_id))
        shift_id = session.scalar(select(Shift.id).where(Shift.cash_register_id == register_id, Shift.status == "open"))
    app = create_app(configured_settings(url))
    app.dependency_overrides[get_shift_actor_principal] = lambda: ShiftActorPrincipal(staff_id, False, branch_id)
    headers = {"Idempotency-Key": "movement-key"}
    expense_body = {"category": "limpieza", "concept": "Soap", "payee_name": "Shop", "amount_minor": 800}
    with TestClient(app) as client:
        expense_id = None
        if movement in ("void", "concurrent_void"):
            response = client.post(f"/api/v1/registers/{register_id}/expenses", headers=headers, json=expense_body)
            assert response.status_code == 201, response.text
            expense_id = response.json()["id"]
        barrier = Barrier(2)

        def movement_request():
            barrier.wait()
            if movement == "expense":
                return client.post(f"/api/v1/registers/{register_id}/expenses", headers=headers, json=expense_body).status_code
            if movement == "contribution":
                return client.post(f"/api/v1/registers/{register_id}/cash-contributions", headers=headers,
                                   json={"concept": "Fund", "contributor_name": "Admin", "amount_minor": 800}).status_code
            return client.post(f"/api/v1/expenses/{expense_id}/void", json={"reason": "First"}).status_code

        def competing_request():
            barrier.wait()
            if movement == "concurrent_void":
                return client.post(f"/api/v1/expenses/{expense_id}/void", json={"reason": "Second"}).status_code
            return client.post(f"/api/v1/shifts/{shift_id}/close", json={"counted_cash_minor": 0}).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = pool.submit(movement_request), pool.submit(competing_request)
            result, competing = first.result(), second.result()
        if movement == "concurrent_void":
            assert sorted([result, competing]) == [200, 409]
            with factory() as session:
                shift = session.get(Shift, shift_id)
                assert shift.status == "open"
        else:
            assert competing == 201
            assert result in ([200, 409] if movement == "void" else [201, 409])
            with factory() as session:
                shift = session.get(Shift, shift_id)
                assert shift.status == "closed"
                assert shift.expected_cash_at_close_minor == expected_cash_for_shift(session, shift)
