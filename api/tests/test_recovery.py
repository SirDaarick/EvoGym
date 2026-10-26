from datetime import datetime, timedelta, timezone
from hashlib import sha256

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.auth.hashing import hash_pin
from app.auth.passwords import hash_admin_password, verify_admin_password
from app.auth.sessions import issue_session
from app.db.base import Base
from app.db.models import AdminPasswordCredential, AdminRecoveryToken, Branch, RoleGrant, StaffCredential, StaffSession, StaffUser
from app.main import create_app
from test_admin_auth import configured_settings, seed_admin
from admin_session_helpers import approved_admin_session


class CapturingDelivery:
    def __init__(self, fail=False):
        self.fail = fail
        self.messages = []
        self.approval_links = []

    def enqueue_recovery_link(self, email, link):
        if self.fail:
            raise RuntimeError("synthetic delivery failure")
        self.messages.append((email, link))

    def enqueue_admin_device_approval(self, email, link):
        self.approval_links.append((email, link))

    def enqueue_admin_security_notice(self, email, category):
        return None


def test_recovery_start_is_generic_and_token_is_only_delivered_and_digest_stored(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'recovery.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    staff_id = seed_admin(factory)
    delivery = CapturingDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            known = client.post("/api/v1/auth/recovery/start", json={"login_identifier": "owner@example.invalid"})
            unknown = client.post("/api/v1/auth/recovery/start", json={"login_identifier": "missing@example.invalid"})
            assert known.status_code == unknown.status_code == 202
            assert {k: v for k, v in known.json().items() if k != "request_id"} == {k: v for k, v in unknown.json().items() if k != "request_id"}
            assert "owner@example.invalid" not in known.text
            assert len(delivery.messages) == 1 and delivery.messages[0][0] == "owner@example.invalid"
            link = delivery.messages[0][1]
            assert link.startswith("https://example.invalid/recover?token=")
            token = link.split("token=", 1)[1]
            assert token not in known.text
            with factory() as session:
                row = session.scalar(select(AdminRecoveryToken).where(AdminRecoveryToken.staff_id == staff_id))
                assert row.token_digest == sha256(token.encode("ascii")).hexdigest()
                assert token not in row.token_digest and row.email_digest
                assert row.delivery_status == "sent" and row.delivered_at is not None
    finally:
        engine.dispose()


def test_recovery_unavailable_without_sender_and_delivery_failure_stays_generic(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'recovery-unavailable.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    staff_id = seed_admin(factory)
    app = create_app(configured_settings(url), recovery_delivery=None)
    try:
        with TestClient(app) as client:
            for login in ("owner@example.invalid", "missing@example.invalid"):
                response = client.post("/api/v1/auth/recovery/start", json={"login_identifier": login})
                assert response.status_code == 503
                assert "owner@example.invalid" not in response.text
        with factory() as session:
            assert session.scalar(select(AdminRecoveryToken)) is None
        failing = create_app(configured_settings(url), recovery_delivery=CapturingDelivery(fail=True))
        with TestClient(failing) as client:
            response = client.post("/api/v1/auth/recovery/start", json={"login_identifier": "owner@example.invalid"})
            assert response.status_code == 202
            assert response.json()["message"] == "If eligible, recovery instructions have been queued."
        with factory() as session:
            row = session.scalar(select(AdminRecoveryToken).where(AdminRecoveryToken.staff_id == staff_id))
            assert row.delivery_status == "failed" and row.revoked_at is not None
    finally:
        engine.dispose()


def test_recovery_completion_changes_password_and_revokes_all_owned_sessions_atomically(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'recovery-complete.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    target_id = seed_admin(factory)
    other_id = seed_admin(factory, "other@example.invalid", "other-admin-password")
    branch_id = None
    with factory.begin() as session:
        branch = Branch(code="front", name="Front")
        staff = session.get(StaffUser, target_id)
        session.add(branch)
        session.flush()
        branch_id = branch.id
        session.add_all([
            RoleGrant(staff_id=target_id, role="receptionist", scope_kind="branch", branch_id=branch.id),
            StaffCredential(staff_id=target_id, method="pin", secret_hash=hash_pin("2468")),
        ])
    expiry = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=1)
    pin_session = issue_session(factory, "owner@example.invalid", "2468", branch_id, expiry)
    delivery = CapturingDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            first_admin = approved_admin_session(client, delivery)
            other_admin = approved_admin_session(client, delivery, "other@example.invalid", "other-admin-password")
            started = client.post("/api/v1/auth/recovery/start", json={"login_identifier": "owner@example.invalid"})
            token = delivery.messages[0][1].split("token=", 1)[1]
            completed = client.post("/api/v1/auth/recovery/complete", json={"token": token, "new_password": "replacement-password"})
            assert started.status_code == 202 and completed.status_code == 204
            replay = client.post("/api/v1/auth/recovery/complete", json={"token": token, "new_password": "another-password"})
            assert replay.status_code == 400
            assert client.get("/api/v1/admin/sessions", headers={"Authorization": f"Bearer {first_admin.json()['access_token']}"}).status_code == 401
            assert client.get("/api/v1/admin/sessions", headers={"Authorization": f"Bearer {pin_session.token}"}).status_code == 401
            assert client.get("/api/v1/admin/sessions", headers={"Authorization": f"Bearer {other_admin.json()['access_token']}"}).status_code == 200
            replacement = approved_admin_session(client, delivery, password="replacement-password")
        with factory() as session:
            credential = session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == target_id))
            assert verify_admin_password("replacement-password", credential.password_hash)
            assert session.scalar(select(StaffSession).where(StaffSession.staff_id == target_id, StaffSession.revoked_at.is_(None))) is not None
            assert session.scalar(select(StaffSession).where(StaffSession.staff_id == other_id, StaffSession.revoked_at.is_(None))) is not None
    finally:
        engine.dispose()


def test_expired_and_unverified_email_recovery_tokens_fail_closed(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'recovery-expired.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    staff_id = seed_admin(factory)
    delivery = CapturingDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            assert client.post("/api/v1/auth/recovery/start", json={"login_identifier": "owner@example.invalid"}).status_code == 202
            token = delivery.messages[0][1].split("token=", 1)[1]
            with factory.begin() as session:
                token_row = session.scalar(select(AdminRecoveryToken))
                token_row.created_at = datetime(1999, 1, 1, tzinfo=timezone.utc)
                token_row.expires_at = datetime(2000, 1, 1, tzinfo=timezone.utc)
                session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == staff_id)).recovery_email_verified_at = None
            response = client.post("/api/v1/auth/recovery/complete", json={"token": token, "new_password": "replacement"})
            assert response.status_code == 400
            assert "replacement" not in response.text
    finally:
        engine.dispose()
