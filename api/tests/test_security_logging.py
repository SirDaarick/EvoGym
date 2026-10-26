import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.observability.security import (
    OperationalSecurityLogStore,
    SecurityEvent,
    SecurityEventType,
    SecurityOutcome,
    make_security_event,
    queue_security_event,
)
from app.observability.logging import request_context


EMPLOYEE = UUID("00000000-0000-4000-8000-000000000001")
ACTOR = UUID("00000000-0000-4000-8000-000000000002")
DEVICE = UUID("00000000-0000-4000-8000-000000000003")
REQUEST = UUID("00000000-0000-4000-8000-000000000004")


def test_security_event_is_a_closed_allowlist_and_rejects_control_or_secret_fields():
    event = SecurityEvent(
        event_type=SecurityEventType.STAFF_PIN_RESET,
        occurred_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        employee_id=EMPLOYEE,
        device_id=DEVICE,
        initiating_actor_id=ACTOR,
        outcome=SecurityOutcome.SUCCEEDED,
        request_id=REQUEST,
    )
    payload = event.as_dict()
    assert set(payload) == {
        "event_type", "occurred_at", "employee_id", "device_id",
        "initiating_actor_id", "outcome", "request_id",
    }
    assert payload["occurred_at"] == "2026-01-01T00:00:00+00:00"
    assert payload["employee_id"] == str(EMPLOYEE)
    with pytest.raises((TypeError, ValueError)):
        SecurityEvent(event_type="staff_pin_reset\npassword=secret", occurred_at=datetime.now(timezone.utc), outcome="ok")
    with pytest.raises((TypeError, ValueError)):
        SecurityEvent(event_type=SecurityEventType.STAFF_PIN_RESET, occurred_at=datetime.now(), outcome=SecurityOutcome.SUCCEEDED)
    with pytest.raises(TypeError):
        SecurityEvent(event_type=SecurityEventType.STAFF_PIN_RESET, occurred_at=datetime.now(timezone.utc), outcome=SecurityOutcome.SUCCEEDED, password="secret")


def test_store_requires_a_new_owned_namespace_and_persists_only_allowlisted_jsonl(tmp_path):
    target = tmp_path / "owned-security-store"
    store = OperationalSecurityLogStore.create_new(target, activated_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    store.append(SecurityEvent(
        event_type=SecurityEventType.DEVICE_REVOKED,
        occurred_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        employee_id=EMPLOYEE,
        device_id=DEVICE,
        initiating_actor_id=ACTOR,
        outcome=SecurityOutcome.SUCCEEDED,
        request_id=REQUEST,
    ))
    lines = (target / "operational-security.jsonl").read_text(encoding="utf-8").splitlines()
    payload = json.loads(lines[0])
    assert payload["event_type"] == "device_revoked"
    assert "Authorization" not in lines[0] and "secret" not in lines[0]
    with pytest.raises((FileExistsError, ValueError)):
        OperationalSecurityLogStore.create_new(target)
    with pytest.raises(ValueError):
        store.append(SecurityEvent(
            event_type=SecurityEventType.DEVICE_REVOKED,
            occurred_at=datetime(2025, 12, 31, tzinfo=timezone.utc),
            outcome=SecurityOutcome.SUCCEEDED,
        ))


def test_event_rejects_non_uuid_identity_and_non_utc_time():
    with pytest.raises((TypeError, ValueError)):
        SecurityEvent(event_type=SecurityEventType.STAFF_SESSION_ISSUED, occurred_at=datetime.now(timezone.utc), employee_id="not-a-uuid", outcome=SecurityOutcome.SUCCEEDED)
    with pytest.raises((TypeError, ValueError)):
        SecurityEvent(event_type=SecurityEventType.STAFF_SESSION_ISSUED, occurred_at=datetime.now(timezone(timedelta(hours=-5))), outcome=SecurityOutcome.SUCCEEDED)


def test_events_are_persisted_only_after_the_database_transaction_commits(tmp_path):
    store = OperationalSecurityLogStore.create_new(tmp_path / "store")
    factory = sessionmaker(bind=create_engine("sqlite://"), info={"operational_security_log_store": store})
    log = store.directory / "operational-security.jsonl"
    with factory.begin() as session:
        queue_security_event(session, make_security_event(
            SecurityEventType.STAFF_PIN_RESET, employee_id=EMPLOYEE,
            initiating_actor_id=ACTOR,
        ))
        assert not log.exists()
    assert len(log.read_text(encoding="utf-8").splitlines()) == 1
    with pytest.raises(RuntimeError):
        with factory.begin() as session:
            queue_security_event(session, make_security_event(
                SecurityEventType.STAFF_PIN_RESET, employee_id=EMPLOYEE,
                initiating_actor_id=ACTOR,
            ))
            raise RuntimeError("rollback")
    assert len(log.read_text(encoding="utf-8").splitlines()) == 1


def test_request_identity_is_read_only_from_server_request_context():
    with request_context(str(REQUEST)):
        event = make_security_event(
            SecurityEventType.STAFF_SESSION_ISSUED,
            employee_id=EMPLOYEE,
            initiating_actor_id=EMPLOYEE,
        )
    assert event.request_id == REQUEST

def test_operational_store_is_opt_in_and_never_exposed_by_application_routes(tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app
    from app.settings import Settings

    assert Settings(_env_file=None).operational_security_log_directory is None
    api_logger = logging.getLogger("evogym.api")
    handlers_before = tuple(api_logger.handlers)
    root = tmp_path / "explicit-store"
    settings = Settings(_env_file=None, operational_security_log_directory=root)
    app = create_app(settings)
    assert not any("security-log" in getattr(route, "path", "") for route in app.routes)
    with TestClient(app):
        assert OperationalSecurityLogStore.open_managed(root)
    second_app = create_app(settings)
    with TestClient(second_app):
        assert OperationalSecurityLogStore.open_managed(root)
    assert tuple(api_logger.handlers) == handlers_before

    unmanaged = tmp_path / "unmanaged-existing"
    unmanaged.mkdir()
    sentinel = unmanaged / "existing.jsonl"
    sentinel.write_text("preserve", encoding="utf-8")
    with pytest.raises(ValueError):
        with TestClient(create_app(Settings(_env_file=None, operational_security_log_directory=unmanaged))):
            pass
    assert sentinel.read_text(encoding="utf-8") == "preserve"
