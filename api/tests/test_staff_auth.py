from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.auth.hashing import hash_pin
from app.db.base import Base
from app.db.models import Branch, RoleGrant, StaffCredential, StaffSession, StaffUser
from app.main import create_app
from app.settings import Settings


def _settings(url, **overrides):
    values = {
        "environment": "test", "database_url": url, "admin_session_ttl_seconds": 3600,
        "staff_session_ttl_seconds": 900, "admin_lockout_attempts": 2,
        "admin_lockout_seconds": 300, "auth_rate_limit_window_seconds": 60,
        "auth_rate_limit_requests": 100, "auth_request_max_bytes": 8192,
        "auth_max_concurrent_hashes": 2,
        **overrides,
    }
    return Settings(**values, _env_file=None)


def _setup(tmp_path, **settings_overrides):
    url = f"sqlite+pysqlite:///{(tmp_path / 'staff-auth.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    with factory.begin() as session:
        active = StaffUser(login_identifier="desk@example.invalid")
        inactive = StaffUser(login_identifier="inactive@example.invalid", is_active=False)
        permitted, other = Branch(code="front", name="Front"), Branch(code="back", name="Back")
        inactive_branch = Branch(code="closed", name="Closed", is_active=False)
        session.add_all([active, inactive, permitted, other, inactive_branch])
        session.flush()
        session.add_all([
            StaffCredential(staff_id=active.id, method="pin", secret_hash=hash_pin("2468")),
            StaffCredential(staff_id=inactive.id, method="pin", secret_hash=hash_pin("2468")),
            RoleGrant(staff_id=active.id, role="receptionist", scope_kind="branch", branch_id=permitted.id),
            RoleGrant(staff_id=inactive.id, role="receptionist", scope_kind="branch", branch_id=permitted.id),
        ])
        identifiers = {"staff": active.id, "inactive": inactive.id, "branch": permitted.id,
                       "other": other.id, "inactive_branch": inactive_branch.id}
    app = create_app(_settings(url, **settings_overrides))
    app.state.session_factory = factory
    return engine, factory, app, identifiers


def test_staff_pin_session_uses_server_policy_and_returns_no_store(tmp_path):
    engine, factory, app, ids = _setup(tmp_path, staff_session_ttl_seconds=720)
    try:
        with TestClient(app) as client:
            response = client.post("/api/v1/auth/staff/sessions", json={
                "login_identifier": "desk@example.invalid", "pin": "2468", "branch_id": str(ids["branch"]),
            })
        assert response.status_code == 201
        assert response.headers["cache-control"] == "no-store"
        result = response.json()
        assert result["token_type"] == "bearer"
        assert len(result["access_token"]) == 43
        expiry = datetime.fromisoformat(result["expires_at"])
        assert 90 * 24 * 60 * 60 - 5 <= (expiry - datetime.now(timezone.utc)).total_seconds() <= 90 * 24 * 60 * 60 + 5
        with factory() as session:
            stored = session.scalar(select(StaffSession).where(StaffSession.staff_id == ids["staff"]))
            assert stored.branch_id == ids["branch"]
            assert stored.expires_at.replace(tzinfo=timezone.utc) == expiry
    finally:
        engine.dispose()


def test_staff_login_ignores_legacy_ttl_and_fails_closed_without_session_factory(tmp_path):
    engine, factory, app, ids = _setup(tmp_path, staff_session_ttl_seconds=None)
    try:
        app.state.session_factory = factory
        with TestClient(app) as client:
            missing_ttl = client.post("/api/v1/auth/staff/sessions", json={
                "login_identifier": "desk@example.invalid", "pin": "2468", "branch_id": str(ids["branch"]),
            })
        assert missing_ttl.status_code == 201
        assert missing_ttl.headers["cache-control"] == "no-store"
        assert 90 * 24 * 60 * 60 - 5 <= (
            datetime.fromisoformat(missing_ttl.json()["expires_at"]) - datetime.now(timezone.utc)
        ).total_seconds() <= 90 * 24 * 60 * 60 + 5
        with TestClient(app) as client:
            app.state.settings = _settings("sqlite+pysqlite://", staff_session_ttl_seconds=900)
            app.state.session_factory = None
            missing_factory = client.post("/api/v1/auth/staff/sessions", json={
                "login_identifier": "desk@example.invalid", "pin": "2468", "branch_id": str(ids["branch"]),
            })
        assert missing_factory.status_code == 503
    finally:
        engine.dispose()


def test_staff_pin_denies_invalid_inactive_and_out_of_scope_credentials(tmp_path):
    engine, _, app, ids = _setup(tmp_path)
    try:
        with TestClient(app) as client:
            for identifier, pin, branch in (
                ("desk@example.invalid", "0000", ids["branch"]),
                ("inactive@example.invalid", "2468", ids["branch"]),
                ("desk@example.invalid", "2468", ids["other"]),
                ("desk@example.invalid", "2468", ids["inactive_branch"]),
            ):
                response = client.post("/api/v1/auth/staff/sessions", json={
                    "login_identifier": identifier, "pin": pin, "branch_id": str(branch),
                })
                assert response.status_code == 401
                assert "access_token" not in response.text
    finally:
        engine.dispose()


def test_staff_pin_rejects_extra_fields_and_oversized_body(tmp_path):
    engine, _, app, ids = _setup(tmp_path, auth_request_max_bytes=512)
    try:
        with TestClient(app) as client:
            extra = client.post("/api/v1/auth/staff/sessions", json={
                "login_identifier": "desk@example.invalid", "pin": "2468", "branch_id": str(ids["branch"]),
                "expires_at": "2099-01-01T00:00:00Z",
            })
            oversized = client.post("/api/v1/auth/staff/sessions", content=b"{" + b" " * 600 + b"}",
                                    headers={"content-type": "application/json"})
        assert extra.status_code == 422
        assert oversized.status_code == 413
    finally:
        engine.dispose()


def test_staff_pin_route_uses_shared_rate_limiter(tmp_path):
    engine, _, app, ids = _setup(tmp_path, auth_rate_limit_requests=1)
    try:
        with TestClient(app) as client:
            payload = {"login_identifier": "desk@example.invalid", "pin": "0000", "branch_id": str(ids["branch"])}
            assert client.post("/api/v1/auth/staff/sessions", json=payload).status_code == 401
            assert client.post("/api/v1/auth/staff/sessions", json=payload).status_code == 429
    finally:
        engine.dispose()


def test_staff_pin_lockout_remains_enforced_by_issue_session(tmp_path):
    engine, _, app, ids = _setup(tmp_path)
    try:
        with TestClient(app) as client:
            for _ in range(5):
                denied = client.post("/api/v1/auth/staff/sessions", json={
                    "login_identifier": "desk@example.invalid", "pin": "0000", "branch_id": str(ids["branch"]),
                })
                assert denied.status_code == 401
            locked = client.post("/api/v1/auth/staff/sessions", json={
                "login_identifier": "desk@example.invalid", "pin": "2468", "branch_id": str(ids["branch"]),
            })
        assert locked.status_code == 401
    finally:
        engine.dispose()


def test_staff_session_ttl_is_bounded():
    for ttl in (59, 86401):
        try:
            _settings("sqlite+pysqlite://", staff_session_ttl_seconds=ttl)
        except ValueError:
            pass
        else:
            raise AssertionError(f"TTL {ttl} should be rejected")
