from datetime import datetime, timedelta, timezone
from hashlib import sha256
from uuid import uuid4

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app.auth.passwords import hash_admin_password, verify_admin_password
from app.auth.recovery import complete_recovery, start_recovery
from app.auth.admin import AdminLoginPending, approve_admin_login, authenticate_admin, poll_admin_login_approval
from app.auth.authorization import AuthorizationDenied
from app.auth.admin import validate_admin_session
import pytest
from app.db.base import Base
from app.db.models import AdminPasswordCredential, AdminRecoveryToken, RoleGrant, StaffSession, StaffUser
from app.db.models.admin_devices import AdminTrustedDevice
from app.main import create_app
from app.settings import Settings


class RecoveryDelivery:
    def __init__(self):
        self.messages = []
        self.approvals = []

    def enqueue_recovery_link(self, email, link):
        self.messages.append((email, link))

    def enqueue_admin_device_approval(self, email, link):
        self.approvals.append((email, link))


def _database(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'admin-recovery.db').as_posix()}")
    Base.metadata.create_all(engine)
    return engine, sessionmaker(engine)


def _admin(factory):
    with factory.begin() as session:
        staff = StaffUser(login_identifier="recovery@example.invalid")
        session.add(staff)
        session.flush()
        session.add_all([
            RoleGrant(staff_id=staff.id, role="admin", scope_kind="organization"),
            AdminPasswordCredential(
                staff_id=staff.id,
                password_hash=hash_admin_password("synthetic-old-password"),
                recovery_email="recovery@example.invalid",
                recovery_email_verified_at=datetime.now(timezone.utc),
            ),
            AdminTrustedDevice(
                staff_id=staff.id,
                category="computer",
                cookie_digest=sha256(b"synthetic-device-cookie").hexdigest(),
                created_at=datetime.now(timezone.utc),
                last_used_at=datetime.now(timezone.utc),
            ),
            StaffSession(
                staff_id=staff.id,
                branch_id=None,
                scope_kind="organization",
                auth_method="admin_password",
                token_digest=sha256(b"synthetic-session-token").hexdigest(),
                issued_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(days=90),
            ),
        ])
        return staff.id


def test_successful_recovery_revokes_admin_sessions_and_trusted_devices(tmp_path):
    engine, factory = _database(tmp_path)
    try:
        staff_id = _admin(factory)
        delivery = RecoveryDelivery()
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        start_recovery(factory, "recovery@example.invalid", 1800, "https://example.invalid/recover", delivery, clock=lambda: now)
        token = delivery.messages[0][1].split("token=", 1)[1]

        assert complete_recovery(factory, token, "synthetic-new-password", uuid4(), clock=lambda: now + timedelta(minutes=1))
        assert not complete_recovery(factory, token, "synthetic-reused-password", uuid4(), clock=lambda: now + timedelta(minutes=2))

        with factory() as session:
            assert session.scalar(select(StaffSession).where(StaffSession.staff_id == staff_id)).revoked_at is not None
            device = session.scalar(select(AdminTrustedDevice).where(AdminTrustedDevice.staff_id == staff_id))
            assert device.revoked_at is not None
    finally:
        engine.dispose()


def test_recovery_token_expiry_does_not_change_password_or_device_trust(tmp_path):
    engine, factory = _database(tmp_path)
    try:
        staff_id = _admin(factory)
        delivery = RecoveryDelivery()
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        start_recovery(factory, "recovery@example.invalid", 1800, "https://example.invalid/recover", delivery, clock=lambda: now)
        token = delivery.messages[0][1].split("token=", 1)[1]
        assert not complete_recovery(factory, token, "synthetic-new-password", uuid4(), clock=lambda: now + timedelta(minutes=31))
        with factory() as session:
            device = session.scalar(select(AdminTrustedDevice).where(AdminTrustedDevice.staff_id == staff_id))
            credential = session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == staff_id))
            assert device.revoked_at is None
            assert verify_admin_password("synthetic-old-password", credential.password_hash)
    finally:
        engine.dispose()


def test_device_approval_is_attempt_bound_and_newer_same_category_supersedes(tmp_path):
    engine, factory = _database(tmp_path)
    try:
        _admin(factory)
        delivery = RecoveryDelivery()
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        args = (factory, "recovery@example.invalid", "synthetic-old-password", 900, uuid4())
        first = authenticate_admin(*args, clock=lambda: now, signing_secret="synthetic-signing-secret-long-enough", delivery=delivery,
            approval_base_url="https://example.invalid/approval")
        second = authenticate_admin(*args[:4], uuid4(), clock=lambda: now + timedelta(minutes=1), signing_secret="synthetic-signing-secret-long-enough", delivery=delivery,
            approval_base_url="https://example.invalid/approval")
        assert isinstance(first, AdminLoginPending) and isinstance(second, AdminLoginPending)
        assert poll_admin_login_approval(factory, second.approval_id, second.poll_token, "synthetic-signing-secret-long-enough", uuid4(), clock=lambda: now + timedelta(minutes=2)).__class__ is AdminLoginPending
        first_token = delivery.approvals[0][1].split("approval_token=", 1)[1]
        second_token = delivery.approvals[1][1].split("approval_token=", 1)[1]
        assert second.poll_token not in delivery.approvals[1][1]
        assert not approve_admin_login(factory, first_token, uuid4(), clock=lambda: now + timedelta(minutes=2))
        assert approve_admin_login(factory, second_token, uuid4(), clock=lambda: now + timedelta(minutes=2))
        issued = poll_admin_login_approval(factory, second.approval_id, second.poll_token,
            "synthetic-signing-secret-long-enough", uuid4(), clock=lambda: now + timedelta(minutes=3))
        assert issued is not None and issued.device_cookie
        assert poll_admin_login_approval(factory, second.approval_id, second.poll_token,
            "synthetic-signing-secret-long-enough", uuid4(), clock=lambda: now + timedelta(minutes=4)) is None
        with pytest.raises(AuthorizationDenied):
            validate_admin_session(factory, issued.token, "synthetic-signing-secret-long-enough",
                                   clock=lambda: now + timedelta(minutes=19))
        expired = authenticate_admin(*args[:4], uuid4(), clock=lambda: now + timedelta(minutes=5), signing_secret="synthetic-signing-secret-long-enough", delivery=delivery,
            approval_base_url="https://example.invalid/approval")
        assert isinstance(expired, AdminLoginPending)
        expired_link = delivery.approvals[-1][1].split("approval_token=", 1)[1]
        assert not approve_admin_login(factory, expired_link, uuid4(), clock=lambda: now + timedelta(minutes=36))
    finally:
        engine.dispose()


def test_recovery_start_response_is_enumeration_safe_and_hides_delivery_link(tmp_path):
    engine, factory = _database(tmp_path)
    try:
        _admin(factory)
        url = f"sqlite+pysqlite:///{(tmp_path / 'admin-recovery.db').as_posix()}"
        delivery = RecoveryDelivery()
        settings = Settings(
            environment="test", debug=False, database_url=url,
            admin_token_signing_secret="synthetic-signing-secret-long-enough",
            admin_session_ttl_seconds=900, admin_lockout_attempts=5, admin_lockout_seconds=300,
            auth_rate_limit_window_seconds=60, auth_rate_limit_requests=100,
            auth_request_max_bytes=8192, auth_max_concurrent_hashes=2,
            admin_recovery_ttl_seconds=1800, admin_recovery_base_url="https://example.invalid/recover",
            _env_file=None,
        )
        with TestClient(create_app(settings, recovery_delivery=delivery)) as client:
            known = client.post("/api/v1/auth/recovery/start", json={"login_identifier": "recovery@example.invalid"})
            unknown = client.post("/api/v1/auth/recovery/start", json={"login_identifier": "missing@example.invalid"})
        assert known.status_code == unknown.status_code == 202
        assert known.json() == unknown.json()
        assert len(delivery.messages) == 1
        assert "token=" not in known.text
        assert delivery.messages[0][1] not in known.text
    finally:
        engine.dispose()
