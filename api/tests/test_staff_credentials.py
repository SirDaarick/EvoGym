from datetime import datetime, timedelta, timezone
import re
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy import event
from fastapi.testclient import TestClient

from app.auth.credentials import AuthenticationStatus, authenticate_pin, change_initial_pin, issue_initial_pin
from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session
from app.db.base import Base
from app.db.models import (AdminPasswordCredential, AdminTrustedDevice, Branch, ReceptionStation, RoleGrant,
                           StaffCredential, StaffRosterProfile, StaffSession, StaffUser)
from app.db.session import create_session_factory
from app.auth.authorization import AuthorizationDenied
from app.auth.passwords import hash_admin_password
from app.auth.admin import _jwt
import hashlib
from app.main import create_app
from app.settings import Settings


@pytest.fixture
def pin_store(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'staff-pin.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    now = datetime.now(timezone.utc) - timedelta(seconds=1)
    with factory.begin() as session:
        staff = StaffUser(id=UUID("00000000-0000-0000-0000-000000000001"), login_identifier="reception@example.test")
        admin = StaffUser(id=UUID("00000000-0000-0000-0000-000000000002"), login_identifier="admin@example.test")
        branch = Branch(code="front", name="Front")
        session.add_all([staff, admin, branch])
        session.flush()
        device = AdminTrustedDevice(staff_id=admin.id, category="computer", cookie_digest="d" * 64,
                                    created_at=now, last_used_at=now)
        session.add(device)
        session.flush()
        admin_session_id = uuid4()
        admin_token = _jwt({"exp": int((now + timedelta(minutes=15)).timestamp()), "sid": str(admin_session_id),
                            "sub": str(admin.id), "typ": "access"}, "x" * 32)
        admin_session = StaffSession(id=admin_session_id, staff_id=admin.id, scope_kind="organization", auth_method="admin_password",
                                     token_digest=hashlib.sha256(admin_token.encode("ascii")).hexdigest(), issued_at=now, expires_at=now + timedelta(minutes=15),
                                     absolute_expires_at=now + timedelta(days=90), last_seen_at=now,
                                     admin_trusted_device_id=device.id)
        session.add_all([
            StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin("246810")),
            StaffCredential(staff_id=admin.id, method="pin", secret_hash=hash_pin("111111")),
            AdminPasswordCredential(staff_id=admin.id, password_hash=hash_admin_password("password"), recovery_email="admin@example.test"),
            RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch.id),
            RoleGrant(staff_id=admin.id, role="admin", scope_kind="organization", branch_id=None),
            admin_session,
        ])
        profile = StaffRosterProfile(branch_id=branch.id, staff_user_id=staff.id,
                                     full_name="Reception Staff", position="Reception")
        station_secret = "s" * 43
        station = ReceptionStation(branch_id=branch.id, created_by=admin.id,
                                   credential_digest=hashlib.sha256(station_secret.encode()).hexdigest(),
                                   created_at=now, expires_at=now + timedelta(days=90))
        session.add_all([profile, station]); session.flush()
        ids = {"staff": staff.id, "admin": admin.id, "branch": branch.id, "profile": profile.id,
               "station": station.id, "station_secret": station_secret,
               "admin_session": admin_session.id, "admin_token": admin_token}
    yield factory, ids, now
    engine.dispose()


def test_admin_issued_pin_is_six_digits_hash_only_and_expires_after_seven_days(pin_store):
    factory, ids, now = pin_store
    issue_session(factory, "reception@example.test", "246810", ids["branch"], now + timedelta(minutes=10), clock=lambda: now)
    from app.auth.sessions import issue_reception_session
    issue_reception_session(factory, ids["station_secret"], ids["profile"], "246810", clock=lambda: now)
    raw = issue_initial_pin(factory, ids["staff"], actor_id=ids["admin"], admin_session_id=ids["admin_session"], clock=lambda: now)
    assert re.fullmatch(r"\d{6}", raw)
    with factory() as session:
        credential = session.scalar(select(StaffCredential).where(StaffCredential.staff_id == ids["staff"]))
        assert raw not in credential.secret_hash
        assert credential.pin_change_required is True
        assert credential.initial_pin_expires_at.replace(tzinfo=timezone.utc) == now + timedelta(days=7)
        employee_sessions = session.scalars(select(StaffSession).where(
            StaffSession.staff_id == ids["staff"], StaffSession.scope_kind == "branch",
        )).all()
        assert len(employee_sessions) == 2
        assert all(row.revoked_at is not None for row in employee_sessions)
        assert session.scalar(select(StaffSession).where(StaffSession.id == ids["admin_session"])).revoked_at is None
    assert authenticate_pin(factory, "reception@example.test", raw, clock=lambda: now + timedelta(days=7)).status is AuthenticationStatus.DENIED
    assert authenticate_pin(factory, "reception@example.test", raw, clock=lambda: now + timedelta(days=7) - timedelta(microseconds=1)).status is AuthenticationStatus.AUTHENTICATED


def test_initial_pin_cannot_issue_session_and_change_requires_different_six_digit_pin(pin_store):
    factory, ids, now = pin_store
    raw = issue_initial_pin(factory, ids["staff"], actor_id=ids["admin"], admin_session_id=ids["admin_session"], clock=lambda: now)
    with pytest.raises(AuthorizationDenied):
        issue_session(factory, "reception@example.test", raw, ids["branch"], now + timedelta(minutes=10), clock=lambda: now)
    assert not change_initial_pin(factory, ids["staff"], ids["branch"], raw, "12345", clock=lambda: now)
    assert not change_initial_pin(factory, ids["staff"], uuid4(), raw, "005731", clock=lambda: now)
    assert not change_initial_pin(factory, ids["staff"], ids["branch"], raw, raw, clock=lambda: now)
    assert change_initial_pin(factory, ids["staff"], ids["branch"], raw, "005731", clock=lambda: now) is True
    with factory() as session:
        credential = session.scalar(select(StaffCredential).where(StaffCredential.staff_id == ids["staff"]))
        assert credential.pin_change_required is False
        assert credential.initial_pin_expires_at is None
    assert authenticate_pin(factory, "reception@example.test", "005731", clock=lambda: now).status is AuthenticationStatus.AUTHENTICATED
    with pytest.raises(AuthorizationDenied):
        issue_session(factory, "reception@example.test", raw, ids["branch"], now + timedelta(minutes=10), clock=lambda: now)
    issued = issue_session(factory, "reception@example.test", "005731", ids["branch"], now + timedelta(minutes=10), clock=lambda: now)
    assert issued.token
    assert not change_initial_pin(factory, ids["staff"], ids["branch"], raw, "123456", clock=lambda: now)


def test_wrong_initial_pin_uses_existing_five_attempt_lockout(pin_store):
    factory, ids, now = pin_store
    issue_initial_pin(factory, ids["staff"], actor_id=ids["admin"], admin_session_id=ids["admin_session"], clock=lambda: now)
    for attempt in range(5):
        assert not change_initial_pin(factory, ids["staff"], ids["branch"], "999999", "005731", clock=lambda: now)
    with factory() as session:
        credential = session.scalar(select(StaffCredential).where(StaffCredential.staff_id == ids["staff"]))
        assert credential.failed_attempts == 5
        assert credential.locked_until.replace(tzinfo=timezone.utc) == now + timedelta(minutes=5)
    assert not change_initial_pin(factory, ids["staff"], ids["branch"], "999999", "005731", clock=lambda: now + timedelta(minutes=4))
    assert change_initial_pin(factory, ids["staff"], ids["branch"], "999999", "005731", clock=lambda: now + timedelta(minutes=5)) is False


def test_issue_session_preserves_legacy_credentials_without_initial_state(pin_store):
    factory, ids, now = pin_store
    issued = issue_session(factory, "reception@example.test", "246810", ids["branch"], now + timedelta(minutes=10), clock=lambda: now)
    assert issued.token
    with factory() as session:
        assert session.scalar(select(StaffSession).where(StaffSession.staff_id == ids["staff"])) is not None


def test_only_current_organization_admin_can_reissue_and_expired_initial_pin_cannot_change(pin_store):
    factory, ids, now = pin_store
    with pytest.raises(PermissionError):
        issue_initial_pin(factory, ids["staff"], actor_id=ids["staff"], admin_session_id=ids["admin_session"], clock=lambda: now)
    raw = issue_initial_pin(factory, ids["staff"], actor_id=ids["admin"], admin_session_id=ids["admin_session"], clock=lambda: now)
    expired_at = now + timedelta(days=7)
    assert not change_initial_pin(factory, ids["staff"], ids["branch"], raw, "783201", clock=lambda: expired_at)
    with pytest.raises(AuthorizationDenied):
        issue_session(factory, "reception@example.test", raw, ids["branch"],
                      expired_at + timedelta(minutes=10), clock=lambda: expired_at)

    # Keep the Admin authorization independently valid while exercising employee-PIN expiry.
    with factory.begin() as session:
        admin_session = session.get(StaffSession, ids["admin_session"])
        admin_session.expires_at = expired_at + timedelta(minutes=15)
        admin_session.absolute_expires_at = expired_at + timedelta(days=90)
        admin_session.last_seen_at = expired_at

    replacement = issue_initial_pin(factory, ids["staff"], actor_id=ids["admin"],
                                     admin_session_id=ids["admin_session"], clock=lambda: expired_at)
    assert replacement != raw
    assert change_initial_pin(factory, ids["staff"], ids["branch"], replacement, "783201",
                              clock=lambda: expired_at) is True
    assert issue_session(factory, "reception@example.test", "783201", ids["branch"],
                         expired_at + timedelta(minutes=10), clock=lambda: expired_at).staff_id == ids["staff"]


def test_inactive_admin_and_inactive_employee_are_denied(pin_store):
    factory, ids, now = pin_store
    with factory.begin() as session:
        session.get(StaffUser, ids["admin"]).is_active = False
    with pytest.raises(PermissionError):
        issue_initial_pin(factory, ids["staff"], actor_id=ids["admin"], admin_session_id=ids["admin_session"], clock=lambda: now)
    with factory.begin() as session:
        admin = session.get(StaffUser, ids["admin"])
        admin.is_active = True
        session.get(StaffUser, ids["staff"]).is_active = False
    with pytest.raises(LookupError):
        issue_initial_pin(factory, ids["staff"], actor_id=ids["admin"], admin_session_id=ids["admin_session"], clock=lambda: now)


def test_invalid_branch_rejects_before_pin_hash_work_without_consuming_attempt(pin_store, monkeypatch):
    factory, ids, now = pin_store
    raw = issue_initial_pin(factory, ids["staff"], actor_id=ids["admin"], admin_session_id=ids["admin_session"], clock=lambda: now)
    import app.auth.credentials as credentials
    calls = []
    monkeypatch.setattr(credentials, "verify_pin", lambda *_args: calls.append("verify") or False)
    assert not credentials.change_initial_pin(factory, ids["staff"], uuid4(), raw, "005731", clock=lambda: now)
    assert calls == []
    with factory() as session:
        credential = session.scalar(select(StaffCredential).where(StaffCredential.staff_id == ids["staff"]))
        assert credential.failed_attempts == 0


def test_initial_pin_reset_locks_actor_and_target_staff_in_canonical_uuid_order(pin_store):
    factory, ids, now = pin_store
    locked_staff_ids = []

    def record_lock(_conn, _cursor, statement, parameters, _context, _many):
        if "from staff_users" in statement.lower():
            locked_staff_ids.append(str(parameters[0]).replace("-", ""))

    event.listen(factory.kw["bind"], "before_cursor_execute", record_lock)
    try:
        issue_initial_pin(factory, ids["staff"], actor_id=ids["admin"], admin_session_id=ids["admin_session"], clock=lambda: now)
    finally:
        event.remove(factory.kw["bind"], "before_cursor_execute", record_lock)
    assert locked_staff_ids[:2] == sorted([str(ids["admin"]).replace("-", ""), str(ids["staff"]).replace("-", "")])


def _http_app(factory, tmp_path, **settings_overrides):
    values = dict(
        environment="test", database_url=f"sqlite+pysqlite:///{tmp_path / 'guarded-http.db'}", admin_session_ttl_seconds=3600,
        staff_session_ttl_seconds=900, admin_lockout_attempts=5, admin_lockout_seconds=300,
        auth_rate_limit_window_seconds=60, auth_rate_limit_requests=100,
        auth_request_max_bytes=8192, auth_max_concurrent_hashes=2,
        admin_token_signing_secret="x" * 32,
    )
    values.update(settings_overrides)
    settings = Settings(**values, _env_file=None)
    app = create_app(settings)
    return app


def test_first_change_path_uses_shared_auth_body_limit(pin_store, tmp_path):
    factory, ids, _now = pin_store
    app = _http_app(factory, tmp_path, auth_request_max_bytes=256)
    with TestClient(app) as client:
        app.state.session_factory = factory
        response = client.post("/api/v1/staff/credentials/first-change", content=b'{"login_identifier":"' + b'a' * 512 + b'"}', headers={"Content-Type": "application/json"})
    assert response.status_code == 413


def test_first_change_uses_shared_auth_rate_limit(pin_store, tmp_path):
    factory, ids, _now = pin_store
    app = _http_app(factory, tmp_path, auth_rate_limit_requests=1)
    payload = {"login_identifier": "reception@example.test", "branch_id": str(ids["branch"]), "current_pin": "999999", "new_pin": "005731"}
    with TestClient(app) as client:
        app.state.session_factory = factory
        assert client.post("/api/v1/staff/credentials/first-change", json=payload).status_code == 401
        assert client.post("/api/v1/staff/credentials/first-change", json=payload).status_code == 429


def test_first_change_uses_shared_password_hash_capacity(pin_store, tmp_path):
    factory, ids, _now = pin_store
    app = _http_app(factory, tmp_path)
    payload = {"login_identifier": "reception@example.test", "branch_id": str(ids["branch"]), "current_pin": "999999", "new_pin": "005731"}
    with TestClient(app) as client:
        app.state.session_factory = factory
        capacity = app.state.settings.auth_max_concurrent_hashes
        for _ in range(capacity):
            assert app.state.password_hash_capacity.acquire(blocking=False)
        try:
            response = client.post("/api/v1/staff/credentials/first-change", json=payload)
        finally:
            for _ in range(capacity):
                app.state.password_hash_capacity.release()
    assert response.status_code == 503


def test_admin_http_issue_then_employee_first_change_uses_normal_session_flow(pin_store, tmp_path, caplog):
    factory, ids, _now = pin_store
    settings = Settings(
        environment="test", database_url=f"sqlite+pysqlite:///{tmp_path / 'http-change.db'}", admin_session_ttl_seconds=3600,
        staff_session_ttl_seconds=900, admin_lockout_attempts=5, admin_lockout_seconds=300,
        auth_rate_limit_window_seconds=60, auth_rate_limit_requests=100,
        auth_request_max_bytes=8192, auth_max_concurrent_hashes=2,
        admin_token_signing_secret="x" * 32, _env_file=None,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        app.state.session_factory = factory
        issued = client.post(f"/api/v1/staff/credentials/{ids['staff']}/initial-pin",
                             headers={"Authorization": f"Bearer {ids['admin_token']}"})
        assert issued.status_code == 200
        raw_pin = issued.json()["initial_pin"]
        changed = client.post("/api/v1/staff/credentials/first-change", json={
            "login_identifier": "reception@example.test", "branch_id": str(ids["branch"]),
            "current_pin": raw_pin, "new_pin": "005731",
        })
    assert changed.status_code == 204
    assert raw_pin not in caplog.text
    with pytest.raises(AuthorizationDenied):
        issue_session(factory, "reception@example.test", raw_pin, ids["branch"], datetime.now(timezone.utc) + timedelta(minutes=5))
    assert issue_session(factory, "reception@example.test", "005731", ids["branch"], datetime.now(timezone.utc) + timedelta(minutes=5)).token


def test_http_admin_issue_is_scoped_and_returns_pin_once(pin_store, tmp_path):
    factory, ids, _now = pin_store
    settings = Settings(
        environment="test", database_url=f"sqlite+pysqlite:///{tmp_path / 'http-app.db'}", admin_session_ttl_seconds=3600,
        staff_session_ttl_seconds=900, admin_lockout_attempts=5, admin_lockout_seconds=300,
        auth_rate_limit_window_seconds=60, auth_rate_limit_requests=100,
        auth_request_max_bytes=8192, auth_max_concurrent_hashes=2,
        admin_token_signing_secret="x" * 32, _env_file=None,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        app.state.session_factory = factory
        denied = client.post(f"/api/v1/staff/credentials/{ids['staff']}/initial-pin", headers={"Authorization": "Bearer invalid"})
        assert denied.status_code == 401
        response = client.post(f"/api/v1/staff/credentials/{ids['staff']}/initial-pin",
                               headers={"Authorization": f"Bearer {ids['admin_token']}"})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    pin = response.json()["initial_pin"]
    with factory() as session:
        stored = session.scalar(select(StaffCredential).where(StaffCredential.staff_id == ids["staff"]))
        assert pin not in stored.secret_hash
