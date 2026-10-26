from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.auth.hashing import hash_pin
from app.auth.passwords import hash_admin_password
from app.auth.sessions import issue_session
from app.db.base import Base
from app.db.models import AdminPasswordCredential, Branch, RoleGrant, StaffCredential, StaffSession, StaffUser
from app.main import create_app
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings, seed_admin


def test_admin_lists_only_owned_session_metadata_and_revokes_idempotently(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'admin-sessions.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    admin_id = seed_admin(factory)
    other_id = seed_admin(factory, "other@example.invalid", "other-admin-password")
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            own_login = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password").json()
            other_login = complete_device_login(client, delivery, "other@example.invalid", "other-admin-password").json()
            headers = {"Authorization": f"Bearer {own_login['access_token']}"}
            listing = client.get("/api/v1/admin/sessions", headers=headers)
            assert listing.status_code == 200
            rows = listing.json()["sessions"]
            assert len(rows) == 1
            assert rows[0]["auth_method"] == "admin_password"
            assert rows[0]["scope_kind"] == "organization"
            assert "token" not in str(rows).lower() and "digest" not in str(rows).lower()
            assert own_login["access_token"] not in str(rows)
            own_id = rows[0]["id"]
            assert client.post(f"/api/v1/admin/sessions/{own_id}/revoke", headers=headers).json() == {"revoked": True}
            assert client.get("/api/v1/admin/sessions", headers=headers).status_code == 401
            other_headers = {"Authorization": f"Bearer {other_login['access_token']}"}
            assert client.post(f"/api/v1/admin/sessions/{own_id}/revoke", headers=other_headers).status_code == 404
            assert client.get("/api/v1/admin/sessions", headers=other_headers).json()["sessions"][0]["staff_id"] == str(other_id)
        with factory() as session:
            row = session.scalar(select(StaffSession).where(StaffSession.id == UUID(own_id)))
            assert row.revoked_at is not None
    finally:
        engine.dispose()


def test_branch_pin_session_cannot_authenticate_admin_route(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'branch-session.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    with factory.begin() as session:
        staff = StaffUser(login_identifier="reception@example.invalid")
        branch = Branch(code="front", name="Front")
        session.add_all([staff, branch])
        session.flush()
        session.add_all([
            RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch.id),
            # A later server-side role change must not make this PIN session an Admin password session.
            RoleGrant(staff_id=staff.id, role="admin", scope_kind="organization"),
            AdminPasswordCredential(staff_id=staff.id, password_hash=hash_admin_password("unused"), recovery_email="reception@example.invalid", recovery_email_verified_at=datetime.now(timezone.utc)),
        ])
        session.add(StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin("2468")))
        staff_id, branch_id = staff.id, branch.id
    issued = issue_session(factory, "reception@example.invalid", "2468", branch_id, datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=1))
    app = create_app(configured_settings(url))
    try:
        with TestClient(app) as client:
            response = client.get("/api/v1/admin/sessions", headers={"Authorization": f"Bearer {issued.token}"})
            assert response.status_code == 401
    finally:
        engine.dispose()


def test_trusted_device_revocation_is_self_service_or_owner_only(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'admin-device-revocation.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    owner_id = seed_admin(factory)
    other_id = seed_admin(factory, "other@example.invalid", "other-admin-password")
    delivery = FakeRecoveryDelivery()
    app = create_app(configured_settings(url), recovery_delivery=delivery)
    try:
        with TestClient(app) as client:
            owner_login = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password").json()
            other_login = complete_device_login(client, delivery, "other@example.invalid", "other-admin-password").json()
            own_headers = {"Authorization": f"Bearer {owner_login['access_token']}"}
            other_headers = {"Authorization": f"Bearer {other_login['access_token']}"}
            other_devices = client.get("/api/v1/admin/sessions/devices", headers=other_headers).json()["devices"]
            assert len(other_devices) == 1
            target = other_devices[0]["id"]
            assert client.post(f"/api/v1/admin/sessions/devices/{target}/revoke", headers=own_headers).status_code == 404
            with factory.begin() as session:
                session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == owner_id)).is_owner = True
            assert client.post(f"/api/v1/admin/sessions/devices/{target}/revoke", headers=own_headers).json() == {"revoked": True}
            assert client.get("/api/v1/admin/sessions", headers=other_headers).status_code == 401
        with factory() as session:
            assert session.scalar(select(StaffSession).where(StaffSession.staff_id == other_id)).revoked_at is not None
    finally:
        engine.dispose()
