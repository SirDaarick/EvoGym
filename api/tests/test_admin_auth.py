from datetime import datetime, timezone
import logging
from hashlib import sha256

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.auth.passwords import hash_admin_password
from app.db.base import Base
from app.db.models import AdminPasswordCredential, RoleGrant, StaffSession, StaffUser
from app.main import create_app
from app.settings import Settings


def configured_settings(url, **overrides):
    values = {
        "environment": "test", "debug": False, "database_url": url,
        "admin_session_ttl_seconds": 3600, "admin_lockout_attempts": 2,
        "admin_lockout_seconds": 300, "auth_rate_limit_window_seconds": 60,
        "auth_rate_limit_requests": 100, "auth_request_max_bytes": 8192,
        "auth_max_concurrent_hashes": 2, "admin_recovery_ttl_seconds": 600,
        "admin_recovery_base_url": "https://example.invalid/recover",
        **overrides,
    }
    return Settings(**values, _env_file=None)


def seed_admin(factory, login="owner@example.invalid", password="synthetic-admin-password"):
    with factory.begin() as session:
        staff = StaffUser(login_identifier=login)
        session.add(staff)
        session.flush()
        session.add_all([
            RoleGrant(staff_id=staff.id, role="admin", scope_kind="organization"),
            AdminPasswordCredential(
                staff_id=staff.id, password_hash=hash_admin_password(password),
                recovery_email=login, recovery_email_verified_at=datetime.now(timezone.utc),
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
    app = create_app(configured_settings(url))
    try:
        with TestClient(app) as client:
            wrong = client.post("/api/v1/auth/sessions", json={"login_identifier": "owner@example.invalid", "password": "wrong"})
            missing = client.post("/api/v1/auth/sessions", json={"login_identifier": "missing@example.invalid", "password": "wrong"})
            assert wrong.status_code == missing.status_code == 401
            assert {k: v for k, v in wrong.json()["error"].items() if k != "request_id"} == {k: v for k, v in missing.json()["error"].items() if k != "request_id"}
            success = client.post("/api/v1/auth/sessions", json={"login_identifier": "owner@example.invalid", "password": "synthetic-admin-password"})
            assert success.status_code == 201
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
    finally:
        engine.dispose()
