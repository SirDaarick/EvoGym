from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select

from app.auth.credentials import AuthenticationStatus, authenticate_pin
from app.auth.hashing import hash_pin, verify_pin
from app.db.base import Base
from app.db.models import SecurityEvent, StaffCredential, StaffUser
from app.db.session import create_session_factory


@pytest.fixture
def credential_store(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'credentials.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with factory.begin() as session:
        staff = StaffUser(login_identifier=" Reception@Example.test ", is_active=True)
        session.add(staff)
        session.flush()
        session.add(StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin("2468")))
    yield factory
    engine.dispose()


def test_pin_hash_is_salted_and_verification_fails_closed():
    first = hash_pin("2468")
    second = hash_pin("2468")

    assert first != second
    assert verify_pin("2468", first)
    assert not verify_pin("wrong", first)
    assert not verify_pin("2468", "malformed")
    with pytest.raises(ValueError, match="72 bytes"):
        hash_pin("x" * 73)
    assert not verify_pin("x" * 73, first)


def test_pin_success_resets_failures_and_unknown_or_inactive_is_generic(credential_store):
    now = datetime(2026, 10, 19, tzinfo=timezone.utc)
    for _ in range(2):
        assert authenticate_pin(credential_store, "reception@example.test", "wrong", clock=lambda: now).status is AuthenticationStatus.DENIED
    assert authenticate_pin(credential_store, "reception@example.test", "2468", clock=lambda: now).status is AuthenticationStatus.AUTHENTICATED
    assert authenticate_pin(credential_store, "missing@example.test", "wrong", clock=lambda: now).status is AuthenticationStatus.DENIED
    with credential_store.begin() as session:
        credential = session.scalar(select(StaffCredential))
        staff = session.scalar(select(StaffUser))
        assert credential.secret_hash not in repr(credential)
        assert staff.login_identifier == "reception@example.test"
        assert credential.failed_attempts == 0
        staff.is_active = False
    assert authenticate_pin(credential_store, "reception@example.test", "2468", clock=lambda: now).status is AuthenticationStatus.DENIED


def test_fifth_failure_creates_one_pending_alert_and_lock_expires_exactly(credential_store):
    now = datetime(2026, 10, 19, tzinfo=timezone.utc)
    results = [authenticate_pin(credential_store, "reception@example.test", "wrong", clock=lambda: now) for _ in range(5)]
    assert all(result.status is AuthenticationStatus.DENIED for result in results[:4])
    assert results[4].status is AuthenticationStatus.DENIED
    with credential_store() as session:
        credential = session.scalar(select(StaffCredential))
        events = session.scalars(select(SecurityEvent)).all()
        assert credential.failed_attempts == 5
        assert credential.locked_until.replace(tzinfo=timezone.utc) == now + timedelta(minutes=5)
        assert len(events) == 1
        assert events[0].delivery_status == "pending"
        assert "wrong" not in repr(events[0])

    locked_result = authenticate_pin(credential_store, "reception@example.test", "2468", clock=lambda: now + timedelta(seconds=299))
    unknown_result = authenticate_pin(credential_store, "unknown@example.test", "2468", clock=lambda: now + timedelta(seconds=299))
    wrong_result = authenticate_pin(credential_store, "reception@example.test", "wrong", clock=lambda: now)
    assert locked_result == unknown_result == wrong_result
    with credential_store() as session:
        assert len(session.scalars(select(SecurityEvent)).all()) == 1
        assert session.scalar(select(StaffCredential)).failed_attempts == 5
    assert authenticate_pin(credential_store, "reception@example.test", "2468", clock=lambda: now + timedelta(minutes=5)).status is AuthenticationStatus.AUTHENTICATED
    with credential_store() as session:
        assert session.scalar(select(StaffCredential)).failed_attempts == 0


def test_fifth_failure_starts_full_lockout_after_verification_time_advances(credential_store, monkeypatch):
    import app.auth.credentials as credential_service

    start = datetime(2026, 10, 19, tzinfo=timezone.utc)
    for _ in range(4):
        authenticate_pin(credential_store, "reception@example.test", "wrong", clock=lambda: start)

    current = [start]
    verification_finished = [False]

    def delayed_mismatch(_pin, _stored_hash):
        current[0] += timedelta(seconds=120)
        verification_finished[0] = True
        return False

    def trusted_clock():
        assert verification_finished[0], "decision clock must be sampled after hash verification"
        return current[0]

    monkeypatch.setattr(credential_service, "verify_pin", delayed_mismatch)
    result = authenticate_pin(credential_store, "reception@example.test", "wrong", clock=trusted_clock)

    assert result.status is AuthenticationStatus.DENIED
    with credential_store() as session:
        credential = session.scalar(select(StaffCredential))
        assert credential.locked_until.replace(tzinfo=timezone.utc) == start + timedelta(seconds=420)


def test_correct_pin_queued_until_after_expiry_is_accepted(credential_store, monkeypatch):
    import app.auth.credentials as credential_service

    start = datetime(2026, 10, 19, tzinfo=timezone.utc)
    for _ in range(5):
        authenticate_pin(credential_store, "reception@example.test", "wrong", clock=lambda: start)

    current = [start + timedelta(seconds=299)]
    verification_finished = [False]

    def delayed_match(pin, _stored_hash):
        current[0] = start + timedelta(seconds=301)
        verification_finished[0] = True
        return pin == "2468"

    def trusted_clock():
        assert verification_finished[0], "decision clock must be sampled after hash verification"
        return current[0]

    monkeypatch.setattr(credential_service, "verify_pin", delayed_match)
    result = authenticate_pin(credential_store, "reception@example.test", "2468", clock=trusted_clock)

    assert result.status is AuthenticationStatus.AUTHENTICATED


def test_second_lockout_creates_a_distinct_pending_alert(credential_store):
    now = datetime(2026, 10, 19, tzinfo=timezone.utc)
    for _ in range(5):
        authenticate_pin(credential_store, "reception@example.test", "wrong", clock=lambda: now)
    later = now + timedelta(minutes=5)
    for _ in range(5):
        authenticate_pin(credential_store, "reception@example.test", "wrong", clock=lambda: later)
    with credential_store() as session:
        events = session.scalars(select(SecurityEvent).order_by(SecurityEvent.occurred_at)).all()
        assert len(events) == 2
        assert events[0].id != events[1].id


def test_credential_update_and_alert_share_transaction(credential_store, monkeypatch):
    from app.db.models import staff as staff_models

    def fail_event_insert(*args, **kwargs):
        raise RuntimeError("synthetic alert persistence failure")

    monkeypatch.setattr(staff_models.SecurityEvent, "__init__", fail_event_insert)
    now = datetime(2026, 10, 19, tzinfo=timezone.utc)
    for _ in range(4):
        authenticate_pin(credential_store, "reception@example.test", "wrong", clock=lambda: now)
    with pytest.raises(RuntimeError, match="alert persistence failure"):
        authenticate_pin(credential_store, "reception@example.test", "wrong", clock=lambda: now)
    with credential_store() as session:
        assert session.scalar(select(StaffCredential)).failed_attempts == 4
        assert session.scalars(select(SecurityEvent)).all() == []
