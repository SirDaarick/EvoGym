"""Opt-in PostgreSQL proofs for membership-sale idempotency and renewal serialization."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
import os
import time
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.db.models import Branch, CashRegister, Member, MembershipPeriod, Plan, PlanVersion, StaffUser
from app.inventory.queries import capture_register_inventory_snapshot
from app.sales.queries import post_membership_cash_sale
from app.shifts.queries import open_shift

API_DIR = os.path.dirname(os.path.dirname(__file__))
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


@pytest.fixture
def postgres_sales_target(monkeypatch):
    configured = os.getenv("EVOGYM_TEST_POSTGRES_URL")
    if not configured:
        pytest.skip("Set EVOGYM_TEST_POSTGRES_URL to a disposable local PostgreSQL instance.")
    base_url = make_url(configured)
    if not base_url.drivername.startswith("postgresql+") or base_url.host not in LOOPBACK_HOSTS:
        pytest.fail("PostgreSQL sales tests require a loopback-only disposable target.")
    schema = f"cash_sales_{uuid4().hex}"
    admin_engine = create_engine(base_url)
    try:
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        scoped_url = base_url.update_query_dict({"options": f"-csearch_path={schema}"})
        monkeypatch.setenv("EVOGYM_ENV", "test")
        monkeypatch.setenv("EVOGYM_DEBUG", "false")
        monkeypatch.setenv("EVOGYM_DATABASE_URL", scoped_url.render_as_string(hide_password=False))
        command.upgrade(Config(os.path.join(API_DIR, "alembic.ini")), "head")
        engine = create_engine(scoped_url)
        factory = sessionmaker(engine)
        with factory.begin() as session:
            branch = Branch(code="cash", name="Cash Branch", timezone="America/Tijuana")
            staff = StaffUser(login_identifier=f"{uuid4()}@example.invalid")
            member = Member(member_number=f"SOC-{uuid4().hex[:12]}", full_name="PG Member", phone="5550199")
            plan = Plan(code=f"pg-{uuid4().hex[:12]}", name="PG Month", kind="membership", status="active")
            session.add_all([branch, staff, member, plan])
            session.flush()
            version = PlanVersion(plan_id=plan.id, version_number=1, name="PG Month 2026", price_minor=9500,
                                  currency="MXN", duration_value=1, duration_unit="month", is_active=True)
            session.add(version)
            registers = [CashRegister(branch_id=branch.id, code=f"front-{i}", name=f"Front {i}") for i in (1, 2)]
            session.add_all(registers)
            session.flush()
            for register in registers:
                snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=staff.id)
                open_shift(session, register_id=register.id, opened_by=staff.id,
                           denomination_counts=[{"denomination_minor": 100, "quantity": 0}],
                           inventory_snapshot_id=snapshot.id)
            ids = (staff.id, member.id, version.id, registers[0].id, registers[1].id)
        yield engine, factory, ids
        engine.dispose()
    finally:
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin_engine.dispose()


def _post(session, register_id, actor_id, member_id, version_id, key):
    branch_id = session.scalar(select(CashRegister.branch_id).where(CashRegister.id == register_id))
    return post_membership_cash_sale(
        session, register_id=register_id, actor_id=actor_id, authorized_branch_id=branch_id, member_id=member_id,
        plan_version_id=version_id, idempotency_key=key,
    )


def test_postgres_same_key_retry_waits_for_first_register_post_and_replays(postgres_sales_target):
    _engine, factory, (actor_id, member_id, version_id, register_id, _other_register_id) = postgres_sales_target
    first_session = factory()
    first = _post(first_session, register_id, actor_id, member_id, version_id, "pg-retry")
    first_order_id = first.order.id
    started = Event()

    def retry():
        with factory() as session:
            started.set()
            result = _post(session, register_id, actor_id, member_id, version_id, "pg-retry")
            replay = (result.replayed, result.order.id)
            session.commit()
            return replay

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(retry)
        assert started.wait(2)
        time.sleep(0.2)
        assert not future.done()
        first_session.commit()
        first_session.close()
        replayed, replay_order_id = future.result(timeout=5)
    assert replayed is True
    assert replay_order_id == first_order_id
    with factory() as session:
        assert len(list(session.scalars(select(MembershipPeriod)))) == 1


def test_postgres_member_renewal_waits_for_locked_member_across_registers(postgres_sales_target):
    _engine, factory, (actor_id, member_id, version_id, first_register, second_register) = postgres_sales_target
    first_session = factory()
    first = _post(first_session, first_register, actor_id, member_id, version_id, "pg-renewal-one")
    first_period_end = first.membership.ends_on
    started = Event()

    def renewal():
        with factory() as session:
            started.set()
            result = _post(session, second_register, actor_id, member_id, version_id, "pg-renewal-two")
            renewal_start = result.membership.starts_on
            session.commit()
            return renewal_start

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(renewal)
        assert started.wait(2)
        time.sleep(0.2)
        assert not future.done()
        first_session.commit()
        first_session.close()
        renewal_start = future.result(timeout=5)
    assert renewal_start == first_period_end
    with factory() as session:
        periods = list(session.scalars(select(MembershipPeriod).order_by(MembershipPeriod.starts_on)))
        assert len(periods) == 2
        assert periods[0].ends_on == periods[1].starts_on
