from datetime import datetime, timedelta, timezone
import logging
from hashlib import sha256
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker

from app.auth.admin import _jwt, approve_admin_login
from app.auth.passwords import hash_admin_password
from app.db.base import Base
from app.db.models import AdminAuthEvent, AdminLoginApproval, AdminPasswordCredential, RoleGrant, StaffSession, StaffUser
from app.main import create_app
from app.settings import Settings


def configured_settings(url, **overrides):
    values = {
        "environment": "test", "debug": False, "database_url": url,
        "admin_token_signing_secret": "synthetic-test-signing-secret-at-least-32-bytes",
        "admin_session_ttl_seconds": 900, "admin_lockout_attempts": 2,
        "admin_lockout_seconds": 300, "auth_rate_limit_window_seconds": 60,
        "auth_rate_limit_requests": 100, "auth_request_max_bytes": 8192,
        "auth_max_concurrent_hashes": 2, "admin_recovery_ttl_seconds": 1800,
        "admin_recovery_base_url": "https://example.invalid/recover",
        **overrides,
    }
    return Settings(**values, _env_file=None)


class FakeRecoveryDelivery:
    def __init__(self):
        self.recovery_links = []
        self.approval_links = []
        self.notices = []

    def enqueue_recovery_link(self, email, link):
        self.recovery_links.append((email, link))

    def enqueue_admin_device_approval(self, email, link):
        self.approval_links.append((email, link))

    def enqueue_admin_security_notice(self, email, category):
        self.notices.append((email, category))


def complete_device_login(client, delivery, login, password, category="computer"):
    pending = client.post("/api/v1/auth/sessions", json={
        "login_identifier": login, "password": password, "category": category,
    })
    assert pending.status_code == 202
    poll = pending.json()
    assert poll["status"] == "approval_required"
    assert poll["poll_token"] not in delivery.approval_links[-1][1]
    approval_token = delivery.approval_links[-1][1].split("approval_token=", 1)[1]
    assert client.post("/api/v1/auth/devices/approve", json={"token": approval_token}).status_code == 204
    return client.post(f"/api/v1/auth/devices/approval/{poll['approval_id']}/poll", json={"poll_token": poll["poll_token"]})


def seed_admin(factory, login="owner@example.invalid", password="synthetic-admin-password", *, is_owner=False):
    with factory.begin() as session:
        staff = StaffUser(login_identifier=login)
        session.add(staff)
        session.flush()
        session.add_all([
            RoleGrant(staff_id=staff.id, role="admin", scope_kind="organization"),
            AdminPasswordCredential(
                staff_id=staff.id, password_hash=hash_admin_password(password),
                recovery_email=login, recovery_email_verified_at=datetime.now(timezone.utc),
                is_owner=is_owner,
            ),
        ])
        return staff.id


def database(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'admin-auth.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    return url, engine, sessionmaker(engine)


def test_admin_login_fails_closed_when_server_auth_policy_is_unconfigured():
    with TestClient(create_app(Settings(environment="test", debug=False))) as client:
        response = client.post(
            "/api/v1/auth/sessions",
            json={"login_identifier": "unknown@example.invalid", "password": "synthetic"},
        )
    assert response.status_code == 503
    assert "database" not in response.text.lower()


def test_password_login_requires_active_organization_admin_and_returns_token_once(tmp_path, caplog):
    url, engine, factory = database(tmp_path)
    staff_id = seed_admin(factory)
    caplog.set_level(logging.INFO, logger="evogym.api")
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            wrong = client.post("/api/v1/auth/sessions", json={"login_identifier": "owner@example.invalid", "password": "wrong"})
            missing = client.post("/api/v1/auth/sessions", json={"login_identifier": "missing@example.invalid", "password": "wrong"})
            assert wrong.status_code == missing.status_code == 401
            assert {k: v for k, v in wrong.json()["error"].items() if k != "request_id"} == {k: v for k, v in missing.json()["error"].items() if k != "request_id"}
            success = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password")
            assert success.status_code == 200
            body = success.json()
            assert body["token_type"] == "bearer" and body["access_token"]
            assert set(body) == {"access_token", "token_type", "expires_at"}
            assert success.headers["cache-control"] == "no-store"
            assert "mfa" not in str(body).lower()
            assert set(body) == {"access_token", "token_type", "expires_at"}
            with factory() as session:
                row = session.scalar(select(StaffSession).where(StaffSession.staff_id == staff_id))
                assert row.token_digest == sha256(body["access_token"].encode("ascii")).hexdigest()
                assert row.scope_kind == "organization" and row.auth_method == "admin_password" and row.branch_id is None
            assert "synthetic-admin-password" not in caplog.text
            assert body["access_token"] not in caplog.text
            assert client.cookies.get("admin_refresh_computer") not in caplog.text
            assert delivery.approval_links[0][1] not in caplog.text
        with factory.begin() as session:
            session.scalar(select(RoleGrant).where(RoleGrant.staff_id == staff_id)).is_active = False
        with TestClient(app) as client:
            denied = client.post("/api/v1/auth/sessions", json={"login_identifier": "owner@example.invalid", "password": "synthetic-admin-password"})
            assert denied.status_code == 401
    finally:
        engine.dispose()


def test_password_failures_commit_lockout_and_correct_password_is_denied_while_locked(tmp_path):
    url, engine, factory = database(tmp_path)
    seed_admin(factory)
    app = create_app(configured_settings(url, admin_lockout_attempts=2, admin_lockout_seconds=300))
    try:
        with TestClient(app) as client:
            for _ in range(2):
                response = client.post("/api/v1/auth/sessions", json={"login_identifier": "owner@example.invalid", "password": "incorrect"})
                assert response.status_code == 401
            success_during_lock = client.post("/api/v1/auth/sessions", json={"login_identifier": "owner@example.invalid", "password": "synthetic-admin-password"})
            assert success_during_lock.status_code == 401
        with factory() as session:
            credential = session.scalar(select(AdminPasswordCredential))
            assert credential.failed_attempts == 2
            assert credential.locked_until is not None
            assert session.scalar(select(StaffSession)) is None
    finally:
        engine.dispose()


def test_login_request_limit_returns_generic_429_and_body_is_bounded(tmp_path):
    url, engine, factory = database(tmp_path)
    seed_admin(factory)
    app = create_app(configured_settings(url, auth_rate_limit_requests=1, auth_request_max_bytes=256))
    try:
        with TestClient(app) as client:
            first = client.post("/api/v1/auth/sessions", json={"login_identifier": "absent@example.invalid", "password": "bad"})
            limited = client.post("/api/v1/auth/sessions", json={"login_identifier": "owner@example.invalid", "password": "synthetic-admin-password"})
            assert first.status_code == 401 and limited.status_code == 429
            too_large = client.post("/api/v1/auth/sessions", content=b"{" + b" " * 512, headers={"content-type": "application/json"})
            assert too_large.status_code == 413
        bounded = create_app(configured_settings(url, auth_rate_limit_requests=10, auth_request_max_bytes=256))
        with TestClient(bounded) as client:
            too_large = client.post("/api/v1/auth/sessions", content=b"{" + b" " * 512, headers={"content-type": "application/json"})
            assert too_large.status_code == 413
            oversized_refresh = client.post("/api/v1/auth/refresh", content=b"{" + b" " * 512, headers={"content-type": "application/json"})
            assert oversized_refresh.status_code == 413
    finally:
        engine.dispose()


def test_trusted_device_replaces_category_session_without_repeat_approval(tmp_path):
    url, engine, factory = database(tmp_path)
    staff_id = seed_admin(factory)
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            first = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password")
            assert first.status_code == 200
            first_token = first.json()["access_token"]
            approvals = len(delivery.approval_links)
            replacement = client.post("/api/v1/auth/sessions", json={
                "login_identifier": "owner@example.invalid", "password": "synthetic-admin-password", "category": "computer",
            })
            assert replacement.status_code == 201
            assert len(delivery.approval_links) == approvals
            assert delivery.notices == [("owner@example.invalid", "computer")]
            assert client.get("/api/v1/admin/sessions", headers={"Authorization": f"Bearer {first_token}"}).status_code == 401
        with factory() as session:
            rows = session.scalars(select(StaffSession).where(StaffSession.staff_id == staff_id)).all()
            assert sum(row.revoked_at is None for row in rows if row.admin_category == "computer") == 1
    finally:
        engine.dispose()


def test_refresh_rotation_replay_revokes_only_the_replayed_category_session(tmp_path):
    url, engine, factory = database(tmp_path)
    seed_admin(factory)
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            computer = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password").json()
            old_refresh = client.cookies.get("admin_refresh_computer")
            phone = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password", "phone").json()
            rotated = client.post("/api/v1/auth/refresh", json={"category": "computer"})
            assert rotated.status_code == 200
            assert client.cookies.get("admin_refresh_computer") != old_refresh
            email_counts = (len(delivery.recovery_links), len(delivery.approval_links), len(delivery.notices))
            replay = client.post("/api/v1/auth/refresh", json={"category": "computer"},
                                 headers={"Cookie": f"admin_refresh_computer={old_refresh}"})
            assert replay.status_code == 401
            assert client.get("/api/v1/admin/sessions", headers={"Authorization": f"Bearer {phone['access_token']}"}).status_code == 200
            assert client.get("/api/v1/admin/sessions", headers={"Authorization": f"Bearer {computer['access_token']}"}).status_code == 401
        with factory() as session:
            event = session.scalar(select(AdminAuthEvent).where(
                AdminAuthEvent.action == "admin_refresh_reuse_detected",
            ))
            assert event is not None
        assert (len(delivery.recovery_links), len(delivery.approval_links), len(delivery.notices)) == email_counts
    finally:
        engine.dispose()


def test_approval_poll_replacement_sends_security_notice(tmp_path):
    url, engine, factory = database(tmp_path)
    seed_admin(factory)
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as trusted_browser:
            initial = complete_device_login(trusted_browser, delivery, "owner@example.invalid", "synthetic-admin-password")
            initial_token = initial.json()["access_token"]
            with TestClient(app) as untrusted_browser:
                pending = untrusted_browser.post("/api/v1/auth/sessions", json={
                    "login_identifier": "owner@example.invalid", "password": "synthetic-admin-password", "category": "computer",
                })
                assert pending.status_code == 202
                approval_token = delivery.approval_links[-1][1].split("approval_token=", 1)[1]
                assert untrusted_browser.post("/api/v1/auth/devices/approve", json={"token": approval_token}).status_code == 204
                assert delivery.notices == []
                polled = untrusted_browser.post(
                    f"/api/v1/auth/devices/approval/{pending.json()['approval_id']}/poll",
                    json={"poll_token": pending.json()["poll_token"]},
                )
                assert polled.status_code == 200
                assert delivery.notices == [("owner@example.invalid", "computer")]
                assert trusted_browser.get("/api/v1/admin/sessions", headers={"Authorization": f"Bearer {initial_token}"}).status_code == 401
    finally:
        engine.dispose()


def test_trusted_login_supersedes_approved_unpolled_attempt(tmp_path):
    url, engine, factory = database(tmp_path)
    seed_admin(factory)
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as trusted_browser:
            complete_device_login(trusted_browser, delivery, "owner@example.invalid", "synthetic-admin-password")
            with TestClient(app) as untrusted_browser:
                pending = untrusted_browser.post("/api/v1/auth/sessions", json={
                    "login_identifier": "owner@example.invalid", "password": "synthetic-admin-password", "category": "computer",
                })
                assert pending.status_code == 202
                approval_token = delivery.approval_links[-1][1].split("approval_token=", 1)[1]
                assert untrusted_browser.post("/api/v1/auth/devices/approve", json={"token": approval_token}).status_code == 204
                trusted_login = trusted_browser.post("/api/v1/auth/sessions", json={
                    "login_identifier": "owner@example.invalid", "password": "synthetic-admin-password", "category": "computer",
                })
                assert trusted_login.status_code == 201
                stale_poll = untrusted_browser.post(
                    f"/api/v1/auth/devices/approval/{pending.json()['approval_id']}/poll",
                    json={"poll_token": pending.json()["poll_token"]},
                )
                assert stale_poll.status_code == 400
    finally:
        engine.dispose()


def test_approval_confirmation_reads_staff_before_locking_and_revalidating_approval(tmp_path):
    url, engine, factory = database(tmp_path)
    staff_id = seed_admin(factory)
    approval_token = "a" * 43
    now = datetime.now(timezone.utc)
    with factory.begin() as session:
        session.add(AdminLoginApproval(
            staff_id=staff_id, category="computer",
            approval_token_digest=sha256(approval_token.encode()).hexdigest(),
            poll_token_digest=sha256(b"synthetic-poll-token").hexdigest(),
            created_at=now, expires_at=now + timedelta(minutes=30),
        ))

    statements = []
    def record_statement(_conn, _cursor, statement, _params, _ctx, _many):
        statements.append(statement.lower())

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        assert approve_admin_login(factory, approval_token, uuid4(), clock=lambda: now)
        approval_reads = [i for i, sql in enumerate(statements) if "from admin_login_approvals" in sql]
        staff_reads = [i for i, sql in enumerate(statements) if "from staff_users" in sql]
        audit_writes = [i for i, sql in enumerate(statements) if "insert into admin_auth_events" in sql]
        assert len(approval_reads) >= 2
        assert staff_reads and approval_reads[0] < staff_reads[0] < approval_reads[1]
        assert audit_writes and approval_reads[1] < audit_writes[0]
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
        engine.dispose()


def test_logout_revokes_only_cookie_session_and_preserves_other_category_and_trust(tmp_path):
    url, engine, factory = database(tmp_path)
    staff_id = seed_admin(factory)
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            computer_access = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password").json()["access_token"]
            computer_refresh = client.cookies.get("admin_refresh_computer")
            trusted_cookie = client.cookies.get("admin_device_computer")
            phone_access = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password", "phone").json()["access_token"]

            logged_out = client.post("/api/v1/auth/logout", json={"category": "computer"})
            assert logged_out.status_code == 204
            assert logged_out.headers["Cache-Control"] == "no-store"
            cookie = logged_out.headers["set-cookie"].lower()
            assert cookie.startswith("admin_refresh_computer=") and "max-age=0" in cookie
            assert "path=/api/v1/auth" in cookie and "httponly" in cookie and "samesite=strict" in cookie
            assert "admin_device_computer" not in cookie
            assert client.get("/api/v1/admin/sessions", headers={"Authorization": f"Bearer {computer_access}"}).status_code == 401
            assert client.cookies.get("admin_device_computer") == trusted_cookie

            client.cookies.set("admin_refresh_computer", computer_refresh, path="/api/v1/auth")
            assert client.post("/api/v1/auth/refresh", json={"category": "computer"}).status_code == 401
            assert client.post("/api/v1/auth/refresh", json={"category": "phone"}).status_code == 200
            assert client.get("/api/v1/admin/sessions", headers={"Authorization": f"Bearer {phone_access}"}).status_code == 200

        with factory() as session:
            rows = session.scalars(select(StaffSession).where(StaffSession.staff_id == staff_id)).all()
            assert sum(row.revoked_at is None and row.admin_category == "computer" for row in rows) == 0
            assert sum(row.revoked_at is None and row.admin_category == "phone" for row in rows) == 1
    finally:
        engine.dispose()


def test_logout_is_non_enumerating_for_missing_invalid_and_already_revoked_cookies(tmp_path, caplog):
    url, engine, factory = database(tmp_path)
    seed_admin(factory)
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    caplog.set_level(logging.INFO, logger="evogym.api")
    try:
        with TestClient(app) as client:
            missing = client.post("/api/v1/auth/logout", json={"category": "computer"})
            assert missing.status_code == 204
            assert missing.headers["Cache-Control"] == "no-store"
            client.cookies.set("admin_refresh_computer", "not-a-signed-refresh", path="/api/v1/auth")
            invalid = client.post("/api/v1/auth/logout", json={"category": "computer"})
            assert invalid.status_code == 204
            assert invalid.headers["Cache-Control"] == "no-store"
            assert "not-a-signed-refresh" not in caplog.text
            client.cookies.clear()
            valid = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password")
            old_cookie = client.cookies.get("admin_refresh_computer")
            assert valid.status_code == 200
            assert client.post("/api/v1/auth/logout", json={"category": "computer"}).status_code == 204
        with TestClient(app) as replay:
            replay.cookies.set("admin_refresh_computer", old_cookie, path="/api/v1/auth")
            again = replay.post("/api/v1/auth/logout", json={"category": "computer"})
            assert again.status_code == 204
    finally:
        engine.dispose()


def test_logout_reuses_auth_rate_limit_body_limit_and_fails_closed_without_signing_secret(tmp_path):
    url, engine, factory = database(tmp_path)
    seed_admin(factory)
    limited = create_app(configured_settings(url, auth_rate_limit_requests=1))
    unavailable = create_app(configured_settings(url, admin_token_signing_secret=None))
    try:
        with TestClient(limited) as client:
            assert client.post("/api/v1/auth/logout", json={"category": "computer"}).status_code == 204
            assert client.post("/api/v1/auth/logout", json={"category": "computer"}).status_code == 429
        bounded = create_app(configured_settings(url, auth_request_max_bytes=256))
        with TestClient(bounded) as client:
            too_large = client.post("/api/v1/auth/logout", content=b"{" + b" " * 512, headers={"content-type": "application/json"})
            assert too_large.status_code == 413
        with TestClient(unavailable) as client:
            response = client.post("/api/v1/auth/logout", json={"category": "computer"})
            assert response.status_code == 503
            assert "signing" not in response.text.lower()
    finally:
        engine.dispose()

def test_logout_after_refresh_rotation_revokes_session_represented_by_signed_old_generation(tmp_path):
    url, engine, factory = database(tmp_path)
    seed_admin(factory)
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            old_access = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password").json()["access_token"]
            old_refresh = client.cookies.get("admin_refresh_computer")
            rotated = client.post("/api/v1/auth/refresh", json={"category": "computer"})
            assert rotated.status_code == 200
            current_refresh = client.cookies.get("admin_refresh_computer")
            assert current_refresh != old_refresh

            client.cookies.set("admin_refresh_computer", old_refresh, path="/api/v1/auth")
            assert client.post("/api/v1/auth/logout", json={"category": "computer"}).status_code == 204
            client.cookies.set("admin_refresh_computer", current_refresh, path="/api/v1/auth")
            assert client.post("/api/v1/auth/refresh", json={"category": "computer"}).status_code == 401
            assert client.get("/api/v1/admin/sessions", headers={"Authorization": f"Bearer {old_access}"}).status_code == 401
    finally:
        engine.dispose()

def test_logout_wrong_category_and_expired_signed_cookie_do_not_revoke_another_session(tmp_path):
    url, engine, factory = database(tmp_path)
    staff_id = seed_admin(factory)
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            access = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password").json()["access_token"]
            original_refresh = client.cookies.get("admin_refresh_computer")
            client.cookies.set("admin_refresh_phone", original_refresh, path="/api/v1/auth")
            wrong_category = client.post("/api/v1/auth/logout", json={"category": "phone"})
            assert wrong_category.status_code == 204
            assert client.get("/api/v1/admin/sessions", headers={"Authorization": f"Bearer {access}"}).status_code == 200

            with factory() as session:
                row = session.scalar(select(StaffSession).where(StaffSession.staff_id == staff_id))
                expired = _jwt({
                    "exp": int((datetime.now(timezone.utc) - timedelta(seconds=1)).timestamp()),
                    "gen": row.refresh_generation, "sid": str(row.id), "sub": str(staff_id), "typ": "refresh",
                }, "synthetic-test-signing-secret-at-least-32-bytes")
            client.cookies.set("admin_refresh_computer", expired, path="/api/v1/auth")
            expired_logout = client.post("/api/v1/auth/logout", json={"category": "computer"})
            assert expired_logout.status_code == 204
            client.cookies.set("admin_refresh_computer", original_refresh, path="/api/v1/auth")
            assert client.post("/api/v1/auth/refresh", json={"category": "computer"}).status_code == 200
    finally:
        engine.dispose()
