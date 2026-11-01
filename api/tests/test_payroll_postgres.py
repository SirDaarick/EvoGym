"""Opt-in payroll concurrency proof against an isolated local PostgreSQL database."""
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.db.models import Branch, Expense, PayrollAdvance, PayrollPayment, StaffRosterProfile
from app.main import create_app
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings, seed_admin

URL = os.environ.get("EVOGYM_TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not URL, reason="requires explicit disposable EVOGYM_TEST_POSTGRES_URL")


def test_payroll_concurrent_writes_preserve_financial_invariants(monkeypatch):
    parsed = make_url(URL)
    assert parsed.drivername == "postgresql+psycopg" and parsed.host == "127.0.0.1" and parsed.database == "evogym_test"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", URL)
    command.upgrade(Config(str(Path(__file__).resolve().parents[1] / "alembic.ini")), "head")
    engine = create_engine(URL)
    factory = sessionmaker(engine)
    suffix = uuid4().hex
    login = f"payroll-{suffix}@example.invalid"
    seed_admin(factory, login=login)
    with factory.begin() as session:
        branch = Branch(code=f"payroll-{suffix}", name="Synthetic payroll")
        session.add(branch)
        session.flush()
        profile = StaffRosterProfile(branch_id=branch.id, full_name="Synthetic Employee", position="Staff", monthly_salary_minor=1400000)
        session.add(profile)
        session.flush()
        branch_id, profile_id = branch.id, profile.id
    delivery = FakeRecoveryDelivery()
    try:
        with TestClient(create_app(configured_settings(URL), recovery_delivery=delivery)) as client:
            token = complete_device_login(client, delivery, login, "synthetic-admin-password").json()["access_token"]
            auth = {"Authorization": f"Bearer {token}"}
            body = {"branch_id": str(branch_id), "staff_profile_id": str(profile_id),
                    "week_start": "2026-10-26", "amount_minor": 50000}
            barrier = Barrier(2)

            def advance():
                barrier.wait(timeout=10)
                return client.post("/api/v1/admin/payroll/advances", headers={**auth, "Idempotency-Key": "race-advance"}, json=body)

            def reduce_salary():
                barrier.wait(timeout=10)
                return client.patch(f"/api/v1/staff-roster/{profile_id}", headers=auth, json={"monthly_salary_minor": 100000})

            with ThreadPoolExecutor(max_workers=2) as pool:
                first, second = pool.submit(advance), pool.submit(reduce_salary)
                advance_response, salary_response = first.result(timeout=30), second.result(timeout=30)
            assert (advance_response.status_code, salary_response.status_code) in {(201, 409), (422, 200)}
            with factory() as session:
                salary = session.get(StaffRosterProfile, profile_id).monthly_salary_minor
                advances = session.scalar(select(func.coalesce(func.sum(PayrollAdvance.amount_minor), 0)).where(PayrollAdvance.staff_profile_id == profile_id))
                expenses = session.scalars(select(Expense).where(Expense.branch_id == branch_id)).all()
                assert advances <= (salary + 2) // 4
                assert len(expenses) == (1 if advances else 0)
                assert sum(row.amount_minor for row in expenses) == advances

            assert client.patch(f"/api/v1/staff-roster/{profile_id}", headers=auth, json={"monthly_salary_minor": 1400000}).status_code == 200
            barrier = Barrier(2)
            payment = {"branch_id": str(branch_id), "staff_profile_id": str(profile_id),
                       "week_start": "2026-11-02", "payment_method": "cash"}

            def pay():
                barrier.wait(timeout=10)
                return client.post("/api/v1/admin/payroll/payments", headers={**auth, "Idempotency-Key": "race-payment"}, json=payment)

            with ThreadPoolExecutor(max_workers=2) as pool:
                first, second = pool.submit(pay), pool.submit(pay)
                responses = [first.result(timeout=30), second.result(timeout=30)]
            assert [response.status_code for response in responses] == [201, 201]
            assert responses[0].json() == responses[1].json()
            with factory() as session:
                assert session.scalar(select(func.count()).select_from(PayrollPayment).where(PayrollPayment.staff_profile_id == profile_id)) == 1
                assert session.scalar(select(func.count()).select_from(Expense).where(Expense.branch_id == branch_id, Expense.concept == "Nómina semanal")) == 1
    finally:
        engine.dispose()
