"""Opt-in concurrency proof for an explicitly supplied disposable PostgreSQL database."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import threading
import time

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import make_url

from app.auth.credentials import AuthenticationStatus, authenticate_pin
from app.auth.hashing import hash_pin
from app.db.models import SecurityEvent, StaffCredential, StaffUser
from app.db.session import create_session_factory


API_DIR = Path(__file__).resolve().parents[1]
POSTGRES_URL = os.environ.get("EVOGYM_TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not POSTGRES_URL, reason="requires explicit disposable EVOGYM_TEST_POSTGRES_URL")


def test_concurrent_failures_serialize_and_record_one_lockout(monkeypatch):
    assert POSTGRES_URL is not None
    parsed_url = make_url(POSTGRES_URL)
    assert parsed_url.drivername == "postgresql+psycopg"
    assert parsed_url.host == "127.0.0.1"
    assert parsed_url.database == "evogym_test"
    monkeypatch.setenv("EVOGYM_ENV", "production")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", POSTGRES_URL)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0001_baseline")
    command.upgrade(config, "head")
    command.upgrade(config, "head")

    engine = create_engine(POSTGRES_URL)
    factory = create_session_factory(engine)
    try:
        with factory.begin() as session:
            staff = StaffUser(login_identifier="concurrency-test@example.invalid", is_active=True)
            session.add(staff)
            session.flush()
            session.add(StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin("1357")))

        with ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(
                lambda _: authenticate_pin(factory, "concurrency-test@example.invalid", "wrong"),
                range(10),
            ))

        assert all(result.status is AuthenticationStatus.DENIED for result in results)
        with factory() as session:
            staff = session.scalar(select(StaffUser).where(StaffUser.login_identifier == "concurrency-test@example.invalid"))
            credential = session.scalar(select(StaffCredential).where(StaffCredential.staff_id == staff.id))
            events = session.scalars(select(SecurityEvent).where(SecurityEvent.staff_id == staff.id)).all()
            assert credential.failed_attempts == 5
            assert credential.locked_until is not None
            assert len(events) == 1
            assert events[0].delivery_status == "pending"

        start = datetime.now(timezone.utc)
        with factory.begin() as session:
            delayed_staff = StaffUser(login_identifier="lock-wait@example.invalid", is_active=True)
            session.add(delayed_staff)
            session.flush()
            session.add(StaffCredential(
                staff_id=delayed_staff.id,
                method="pin",
                secret_hash=hash_pin("2468"),
                failed_attempts=4,
            ))
            delayed_staff_id = delayed_staff.id

        lock_session = factory()
        lock_session.begin()
        lock_session.scalar(select(StaffUser).where(StaffUser.id == delayed_staff_id).with_for_update())
        row_query_started = threading.Event()
        clock_called = threading.Event()
        request_started = threading.Event()
        decision_time = [start]

        def observe_lock_query(_connection, _cursor, statement, _parameters, _context, _executemany):
            if "staff_users" in statement and "FOR UPDATE" in statement.upper():
                row_query_started.set()

        event.listen(engine, "before_cursor_execute", observe_lock_query)

        def controlled_clock():
            clock_called.set()
            return decision_time[0]

        def blocked_attempt():
            request_started.set()
            return authenticate_pin(factory, "lock-wait@example.invalid", "wrong", clock=controlled_clock)

        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(blocked_attempt)
                assert request_started.wait(timeout=5)
                assert row_query_started.wait(timeout=5), "authentication did not issue the locked row query"

                deadline = time.monotonic() + 5
                blocked_on_row_lock = False
                while time.monotonic() < deadline:
                    with engine.connect() as connection:
                        blocked_on_row_lock = bool(connection.execute(text(
                            "select 1 from pg_stat_activity "
                            "where datname = current_database() and pid <> pg_backend_pid() "
                            "and wait_event_type = 'Lock' and query ilike '%FOR UPDATE%' limit 1"
                        )).scalar())
                    if blocked_on_row_lock:
                        break
                    time.sleep(0.05)
                assert blocked_on_row_lock, "authentication query did not block on the held PostgreSQL row"
                assert not clock_called.is_set(), "decision clock ran before the row lock was acquired"
                decision_time[0] = start + timedelta(seconds=120)
                lock_session.commit()
                delayed_result = pending.result(timeout=10)
        finally:
            if lock_session.in_transaction():
                lock_session.rollback()
            lock_session.close()
            event.remove(engine, "before_cursor_execute", observe_lock_query)

        assert delayed_result.status is AuthenticationStatus.DENIED
        assert clock_called.is_set()
        with factory() as session:
            delayed_credential = session.scalar(select(StaffCredential).where(StaffCredential.staff_id == delayed_staff_id))
            assert delayed_credential.locked_until is not None
            assert delayed_credential.locked_until.replace(tzinfo=timezone.utc) == start + timedelta(seconds=420)
    finally:
        engine.dispose()
