from datetime import datetime, timezone
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import select
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app.db.models import AdminTrustedDevice, OrganizationOwner, SecurityEvent, StaffSession
from test_admin_staff_accounts import _client, _setup
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings, seed_admin


def test_pending_alert_pagination_is_stable_for_tied_timestamps_and_rejects_bad_cursors(tmp_path):
    url, engine, factory, ids = _setup(tmp_path)
    client = None
    try:
        event_ids = [
            UUID("00000000-0000-4000-8000-000000000001"),
            UUID("00000000-0000-4000-8000-000000000002"),
            UUID("00000000-0000-4000-8000-000000000003"),
            UUID("00000000-0000-4000-8000-000000000004"),
        ]
        timestamp = datetime(2026, 10, 24, tzinfo=timezone.utc)
        with factory.begin() as session:
            session.add_all([SecurityEvent(
                id=event_id, staff_id=ids["employee"], occurred_at=timestamp, locked_until=timestamp,
            ) for event_id in event_ids])
        client, admin = _client(url)
        path = "/api/v1/admin/security-alerts"
        first = client.get(path, params={"limit": 2}, headers=admin)
        assert first.status_code == 200, first.text
        first_rows = first.json()["alerts"]
        assert [row["id"] for row in first_rows] == [str(event_id) for event_id in reversed(event_ids[2:])]
        assert first.json()["next_cursor"] == first_rows[-1]["id"]

        second = client.get(path, params={"limit": 2, "cursor": first.json()["next_cursor"]}, headers=admin)
        assert second.status_code == 200, second.text
        second_rows = second.json()["alerts"]
        assert [row["id"] for row in second_rows] == [str(event_id) for event_id in reversed(event_ids[:2])]
        assert second.json()["next_cursor"] is None
        assert {row["id"] for row in first_rows}.isdisjoint(row["id"] for row in second_rows)
        assert {row["id"] for row in first_rows + second_rows} == {str(event_id) for event_id in event_ids}

        missing = client.get(path, params={"cursor": str(uuid4())}, headers=admin)
        malformed = client.get(path, params={"cursor": "not-a-uuid"}, headers=admin)
        assert missing.status_code == 400
        assert "cursor" not in missing.text.lower()
        assert malformed.status_code == 422
        assert "not-a-uuid" not in malformed.text
    finally:
        if client is not None:
            client.close()
        engine.dispose()


def _load_0036_migration():
    migration_path = Path(__file__).parents[1] / "migrations" / "versions" / "0036_staff_lockout_alert_acknowledgement.py"
    spec = spec_from_file_location("migration_0036_lockout_alerts", migration_path)
    assert spec is not None and spec.loader is not None
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _legacy_security_event_database(tmp_path):
    engine = sa.create_engine(f"sqlite+pysqlite:///{(tmp_path / 'legacy-security-events.db').as_posix()}")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE staff_users (id CHAR(32) PRIMARY KEY)"))
        connection.execute(sa.text(
            "CREATE TABLE security_events (id CHAR(32) PRIMARY KEY, staff_id CHAR(32) NOT NULL, "
            "occurred_at DATETIME NOT NULL, locked_until DATETIME NOT NULL, reason VARCHAR(32) NOT NULL, "
            "delivery_status VARCHAR(16) NOT NULL, CONSTRAINT ck_security_events_reason CHECK "
            "(reason = 'staff_pin_lockout'), CONSTRAINT ck_security_events_pending_delivery CHECK "
            "(delivery_status = 'pending'), FOREIGN KEY(staff_id) REFERENCES staff_users(id) ON DELETE RESTRICT)"
        ))
        staff_id, event_id = uuid4().hex, uuid4().hex
        connection.execute(sa.text("INSERT INTO staff_users (id) VALUES (:id)"), {"id": staff_id})
        connection.execute(sa.text(
            "INSERT INTO security_events (id, staff_id, occurred_at, locked_until, reason, delivery_status) "
            "VALUES (:id, :staff, :at, :until, 'staff_pin_lockout', 'pending')"
        ), {"id": event_id, "staff": staff_id, "at": datetime(2026, 10, 24), "until": datetime(2026, 10, 24)})
    return engine, staff_id, event_id


def test_0036_downgrade_refuses_to_discard_acknowledgement_history(tmp_path):
    migration = _load_0036_migration()
    engine, staff_id, event_id = _legacy_security_event_database(tmp_path)
    try:
        with engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            connection.execute(sa.text(
                "UPDATE security_events SET acknowledged_at=:at, acknowledged_by=:actor WHERE id=:id"
            ), {"at": datetime(2026, 10, 24), "actor": staff_id, "id": event_id})
            with pytest.raises(RuntimeError, match="Acknowledged lockout alert history is retained"):
                with Operations.context(MigrationContext.configure(connection)):
                    migration.downgrade()
            columns = {column["name"] for column in sa.inspect(connection).get_columns("security_events")}
            assert "acknowledged_at" in columns and "acknowledged_by" in columns
            assert connection.execute(sa.text(
                "SELECT acknowledged_by FROM security_events WHERE id=:id"
            ), {"id": event_id}).scalar_one() == staff_id
    finally:
        engine.dispose()


def test_0036_downgrade_allows_pending_legacy_rows_without_acknowledgement(tmp_path):
    migration = _load_0036_migration()
    engine, _staff_id, event_id = _legacy_security_event_database(tmp_path)
    try:
        with engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.downgrade()
            columns = {column["name"] for column in sa.inspect(connection).get_columns("security_events")}
            assert "acknowledged_at" not in columns and "acknowledged_by" not in columns
            assert connection.execute(sa.text("SELECT count(*) FROM security_events WHERE id=:id"),
                                      {"id": event_id}).scalar_one() == 1
    finally:
        engine.dispose()


def test_0036_postgres_downgrade_locks_alerts_before_checking_retained_history(monkeypatch):
    migration = _load_0036_migration()
    statements = []

    class _Result:
        def scalar_one(self):
            return 1

    class _Connection:
        dialect = SimpleNamespace(name="postgresql")

        def execute(self, statement):
            statements.append(str(statement))
            return _Result()

    connection = _Connection()
    monkeypatch.setattr(migration, "op", SimpleNamespace(get_bind=lambda: connection))
    with pytest.raises(RuntimeError, match="Acknowledged lockout alert history is retained"):
        migration.downgrade()
    assert statements[0] == "LOCK TABLE security_events IN ACCESS EXCLUSIVE MODE"
    assert "acknowledged_at IS NOT NULL OR acknowledged_by IS NOT NULL" in statements[1]


def test_admin_security_alerts_list_minimal_pending_and_ack_is_global_idempotent(tmp_path):
    url, engine, factory, ids = _setup(tmp_path)
    try:
        with factory.begin() as session:
            event = SecurityEvent(staff_id=ids["employee"], occurred_at=datetime(2026, 10, 24, tzinfo=timezone.utc),
                                  locked_until=datetime(2026, 10, 24, 0, 5, tzinfo=timezone.utc))
            session.add(event)
            session.flush()
            event_id = event.id
        first_client, first_admin = _client(url)
        path = "/api/v1/admin/security-alerts"
        listed = first_client.get(path, headers=first_admin)
        assert listed.status_code == 200, listed.text
        assert listed.json() == {"alerts": [{
            "id": str(event_id), "staff_id": str(ids["employee"]), "login_identifier": "employee@example.invalid",
            "occurred_at": "2026-10-24T00:00:00Z", "locked_until": "2026-10-24T00:05:00Z",
        }], "next_cursor": None}
        assert not any(word in listed.text.lower() for word in ("hash", "secret", "pin", "token", "ip_address"))

        ack = first_client.post(f"{path}/{event_id}/acknowledge", headers=first_admin)
        assert ack.status_code == 200, ack.text
        first_ack = ack.json()
        second_client, second_admin = _client(url)
        retry = second_client.post(f"{path}/{event_id}/acknowledge", headers=second_admin)
        assert retry.status_code == 200, retry.text
        assert retry.json() == first_ack
        assert second_client.get(path, headers=second_admin).json() == {"alerts": [], "next_cursor": None}
        with factory() as session:
            stored = session.scalar(select(SecurityEvent).where(SecurityEvent.id == event_id))
            assert stored.acknowledged_at is not None
            assert stored.acknowledged_by == ids["admin"]
    finally:
        try:
            first_client.close()
        except UnboundLocalError:
            pass
        try:
            second_client.close()
        except UnboundLocalError:
            pass
        engine.dispose()


def test_unknown_security_alert_ack_is_safe_not_found(tmp_path):
    url, engine, _factory, _ids = _setup(tmp_path)
    try:
        client, admin = _client(url)
        response = client.post(f"/api/v1/admin/security-alerts/{uuid4()}/acknowledge", headers=admin)
        assert response.status_code == 404
        assert response.json()["error"]["message"] == "The requested resource was not found."
    finally:
        client.close()
        engine.dispose()


def test_unrelated_organization_admin_bundle_is_not_enough_after_owner_claim(tmp_path):
    url, engine, factory, ids = _setup(tmp_path)
    try:
        seed_admin(factory, "unrelated@example.invalid", "synthetic-unrelated-password")
        with factory.begin() as session:
            session.add(OrganizationOwner(id=1, staff_id=ids["admin"]))
        delivery = FakeRecoveryDelivery()
        from fastapi.testclient import TestClient
        from app.main import create_app
        client = TestClient(create_app(configured_settings(url), recovery_delivery=delivery))
        client.__enter__()
        login = complete_device_login(client, delivery, "unrelated@example.invalid", "synthetic-unrelated-password")
        assert login.status_code == 200
        response = client.get("/api/v1/admin/security-alerts", headers={
            "Authorization": f"Bearer {login.json()['access_token']}"
        })
        assert response.status_code == 403
        assert response.json()["error"]["message"] == "The request could not be completed."
    finally:
        try:
            client.close()
        except UnboundLocalError:
            pass
        engine.dispose()


def test_trusted_device_revoked_after_preflight_is_rejected_inside_request_transaction(tmp_path):
    from app.api.admin_security_alerts import AdminPrincipal, _principal
    from app.auth.admin import validate_admin_session
    from app.main import create_app
    from fastapi.testclient import TestClient

    url, engine, factory, _ids = _setup(tmp_path)
    client = None
    try:
        delivery = FakeRecoveryDelivery()
        settings = configured_settings(url)
        app = create_app(settings, recovery_delivery=delivery)
        client = TestClient(app)
        client.__enter__()
        login = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password")
        assert login.status_code == 200
        token = login.json()["access_token"]

        def revoke_between_preflight_and_route():
            staff_id, session_id = validate_admin_session(
                factory, token, settings.admin_token_signing_secret.get_secret_value()
            )
            with factory.begin() as session:
                active_session = session.get(StaffSession, session_id)
                assert active_session is not None
                device = session.get(AdminTrustedDevice, active_session.admin_trusted_device_id)
                assert device is not None
                device.revoked_at = datetime.now(timezone.utc)
            return AdminPrincipal(staff_id, session_id)

        app.dependency_overrides[_principal] = revoke_between_preflight_and_route
        response = client.get("/api/v1/admin/security-alerts", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 401
    finally:
        if client is not None:
            client.close()
        engine.dispose()
