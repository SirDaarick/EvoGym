"""Security contracts for the employee profile-selection binding flow."""

import hashlib
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.devices import issue_device_pairing_code
from app.auth.hashing import hash_pin
from app.auth.profile_access import (ProfilePinSetupRequired, bind_profile_access, change_profile_initial_pin,
                                     issue_profile_session, logout_profile_access, paired_profile_choices)
from app.auth.sessions import validate_session
from app.db.base import Base
from app.db.models import (
    AdminTrustedDevice, Branch, OrganizationOwner, ReceptionStation, RoleGrant, StaffCredential,
    StaffDevicePairingCode, StaffPairedDevice, StaffRosterProfile, StaffSession, StaffUser,
)
from app.main import create_app
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings, seed_admin
from test_devices import _seed_staff


def _add_profile(factory, staff_id, branch_id, name, pin="246810"):
    with factory.begin() as session:
        profile = StaffRosterProfile(branch_id=branch_id, staff_user_id=staff_id,
                                     full_name=name, position="Reception")
        session.add_all([
            profile,
            StaffCredential(staff_id=staff_id, method="pin", secret_hash=hash_pin(pin)),
        ])
        session.flush()
        return profile.id


def _seed_employee(factory, login, branch_code):
    with factory.begin() as session:
        staff = StaffUser(login_identifier=login)
        branch = Branch(code=branch_code, name=f"{branch_code.title()} Branch")
        session.add_all([staff, branch])
        session.flush()
        session.add(RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch.id))
        return staff.id, branch.id


def test_code_only_pairing_returns_only_an_httponly_cookie(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'profile-access.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        admin_id = seed_admin(factory, "owner@example.invalid")
        staff_id = _seed_staff(factory, "employee@example.invalid")
        with factory() as session:
            branch_id = session.scalar(select(RoleGrant.branch_id).where(RoleGrant.staff_id == staff_id))
        profile_id = _add_profile(factory, staff_id, branch_id, "Employee")
        issued = issue_device_pairing_code(factory, admin_id, staff_id)
        app = create_app(configured_settings(database_url, cors_allowed_origins="https://trusted.example"))

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/auth/profile-access/pair",
                json={"pairing_code": issued.raw_code},
                headers={"Origin": "https://trusted.example"},
            )

        assert response.status_code == 200
        assert response.json() == {"status": "paired"}
        cookie = response.cookies.get("evogym_profile_access")
        assert cookie is not None and len(cookie) == 43
        set_cookie = response.headers["set-cookie"].lower()
        assert "httponly" in set_cookie
        assert "samesite=strict" in set_cookie
        assert "path=/api/v1/auth/profile-access" in set_cookie
        assert "secure" not in set_cookie
        assert "no-store" in response.headers["cache-control"].lower()
        assert cookie not in response.text

        with factory() as session:
            device = session.scalar(select(StaffPairedDevice).where(StaffPairedDevice.staff_id == staff_id))
            assert device is not None
            assert device.device_identifier_hash == hashlib.sha256(cookie.encode("ascii")).hexdigest()
            assert session.scalar(select(StaffUser).where(StaffUser.id == staff_id)).is_active
    finally:
        engine.dispose()


def test_pairing_code_is_globally_unambiguous_and_expired_hash_can_be_reused(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'pairing-collision.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        admin_id = seed_admin(factory, "owner@example.invalid")
        first_id, _first_branch_id = _seed_employee(factory, "first@example.invalid", "first")
        second_id, _second_branch_id = _seed_employee(factory, "second@example.invalid", "second")
        with factory.begin() as session:
            now = datetime.now(timezone.utc)
            expired = StaffDevicePairingCode(
                staff_id=first_id, code_hash=hashlib.sha256(b"000007").hexdigest(),
                created_by=admin_id, created_at=now - timedelta(days=2),
                expires_at=now - timedelta(days=1),
            )
            session.add(expired)

        from app.auth import devices
        candidates = iter((7, 7, 8))
        original_randbelow = devices.secrets.randbelow
        devices.secrets.randbelow = lambda _limit: next(candidates)
        try:
            first = issue_device_pairing_code(factory, admin_id, first_id)
            second = issue_device_pairing_code(factory, admin_id, second_id)
        finally:
            devices.secrets.randbelow = original_randbelow
        assert first.raw_code == "000007"
        assert second.raw_code == "000008"
        with factory() as session:
            rows = session.scalars(select(StaffDevicePairingCode).where(
                StaffDevicePairingCode.code_hash == hashlib.sha256(b"000007").hexdigest()
            )).all()
            assert len(rows) == 2
            assert sum(row.revoked_at is None and row.used_at is None for row in rows) == 1
    finally:
        engine.dispose()


def test_expired_code_is_revoked_after_denied_bind(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'expired-code.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        admin_id = seed_admin(factory)
        staff_id, branch_id = _seed_employee(factory, "employee@example.invalid", "employee")
        _add_profile(factory, staff_id, branch_id, "Employee")
        now = datetime.now(timezone.utc)
        code = issue_device_pairing_code(factory, admin_id, staff_id, ttl_seconds=60, clock=lambda: now)
        with pytest.raises(AuthorizationDenied):
            bind_profile_access(factory, code.raw_code, clock=lambda: now + timedelta(seconds=60))
        with factory() as session:
            row = session.get(StaffDevicePairingCode, code.id)
            assert row.revoked_at.replace(tzinfo=timezone.utc) == now + timedelta(seconds=60)
            assert row.used_at is None
    finally:
        engine.dispose()


def test_paired_profiles_are_limited_to_own_identity_and_pin_entry(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'paired-profile-access.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        admin_id = seed_admin(factory)
        staff_id, branch_id = _seed_employee(factory, "employee@example.invalid", "employee")
        foreign_id, foreign_branch_id = _seed_employee(factory, "foreign@example.invalid", "foreign")
        own_profile_id = _add_profile(factory, staff_id, branch_id, "Employee")
        foreign_profile_id = _add_profile(factory, foreign_id, foreign_branch_id, "Foreign")
        code = issue_device_pairing_code(factory, admin_id, staff_id)
        binding = bind_profile_access(factory, code.raw_code)

        identities = paired_profile_choices(factory, binding.credential)
        assert len(identities) == 1
        assert identities[0].staff_id == staff_id
        assert [item.profile_id for item in identities[0].branches] == [own_profile_id]
        with pytest.raises(AuthorizationDenied):
            issue_profile_session(factory, foreign_profile_id, foreign_branch_id, "246810",
                                  paired_credential=binding.credential)

        employee_session = issue_profile_session(factory, own_profile_id, branch_id, "246810",
                                                 paired_credential=binding.credential)
        assert employee_session.purpose == "phone"
        assert employee_session.staff_id == staff_id
        assert employee_session.access_token
        validate_session(factory, employee_session.access_token, Permission.MEMBER_OPERATIONAL_READ)
    finally:
        engine.dispose()


def test_temporary_pin_enters_profile_scoped_setup_without_an_operating_session(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'temporary-pin-setup.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        admin_id = seed_admin(factory)
        staff_id, branch_id = _seed_employee(factory, "employee@example.invalid", "temporary")
        profile_id = _add_profile(factory, staff_id, branch_id, "Employee")
        temporary_pin = "135790"
        now = datetime.now(timezone.utc)
        with factory.begin() as session:
            credential = session.scalar(select(StaffCredential).where(StaffCredential.staff_id == staff_id))
            credential.secret_hash = hash_pin(temporary_pin)
            credential.pin_change_required = True
            credential.initial_pin_expires_at = now + timedelta(days=7)
        code = issue_device_pairing_code(factory, admin_id, staff_id, clock=lambda: now)
        binding = bind_profile_access(factory, code.raw_code, clock=lambda: now)

        setup = issue_profile_session(factory, profile_id, branch_id, temporary_pin,
                                       paired_credential=binding.credential, clock=lambda: now)
        assert setup == ProfilePinSetupRequired(staff_id, profile_id, branch_id)
        with factory() as session:
            assert session.scalar(select(StaffSession).where(StaffSession.staff_id == staff_id)) is None

        assert change_profile_initial_pin(factory, profile_id, branch_id, temporary_pin, "975310",
                                          paired_credential=binding.credential, clock=lambda: now)
        with pytest.raises(AuthorizationDenied):
            issue_profile_session(factory, profile_id, branch_id, temporary_pin,
                                  paired_credential=binding.credential, clock=lambda: now)
        entered = issue_profile_session(factory, profile_id, branch_id, "975310",
                                        paired_credential=binding.credential, clock=lambda: now)
        assert entered.staff_id == staff_id and entered.profile_id == profile_id
        assert entered.purpose == "phone"
    finally:
        engine.dispose()


def test_http_temporary_pin_setup_is_typed_and_requires_server_confirmed_change(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'temporary-pin-http.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        admin_id = seed_admin(factory)
        staff_id, branch_id = _seed_employee(factory, "employee@example.invalid", "temporary-http")
        profile_id = _add_profile(factory, staff_id, branch_id, "Employee")
        temporary_pin = "864209"
        now = datetime.now(timezone.utc)
        with factory.begin() as session:
            credential = session.scalar(select(StaffCredential).where(StaffCredential.staff_id == staff_id))
            credential.secret_hash = hash_pin(temporary_pin)
            credential.pin_change_required = True
            credential.initial_pin_expires_at = now + timedelta(days=7)
        pairing = issue_device_pairing_code(factory, admin_id, staff_id)
        app = create_app(configured_settings(database_url, cors_allowed_origins="https://trusted.example"))
        with TestClient(app) as client:
            headers = {"Origin": "https://trusted.example"}
            paired = client.post("/api/v1/auth/profile-access/pair", json={"pairing_code": pairing.raw_code}, headers=headers)
            assert paired.status_code == 200
            setup = client.post("/api/v1/auth/profile-access/sessions", json={
                "profile_id": str(profile_id), "branch_id": str(branch_id), "pin": temporary_pin,
            }, headers=headers)
            assert setup.status_code == 201
            assert setup.json() == {"status": "setup_required", "identity": {"id": str(staff_id)},
                                    "profile": {"id": str(profile_id), "branch_id": str(branch_id)}}
            assert "access_token" not in setup.json()
            changed = client.post("/api/v1/auth/profile-access/first-pin-change", json={
                "profile_id": str(profile_id), "branch_id": str(branch_id),
                "current_pin": temporary_pin, "new_pin": "902468",
            }, headers=headers)
            assert changed.status_code == 204
            old_pin = client.post("/api/v1/auth/profile-access/sessions", json={
                "profile_id": str(profile_id), "branch_id": str(branch_id), "pin": temporary_pin,
            }, headers=headers)
            entered = client.post("/api/v1/auth/profile-access/sessions", json={
                "profile_id": str(profile_id), "branch_id": str(branch_id), "pin": "902468",
            }, headers=headers)
        assert old_pin.status_code == 401
        assert entered.status_code == 201 and entered.json()["access_token"]
    finally:
        engine.dispose()


def test_profile_proof_enforces_idle_and_absolute_upper_bounds(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'proof-expiry.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        admin_id = seed_admin(factory)
        staff_id, branch_id = _seed_employee(factory, "employee@example.invalid", "employee")
        _add_profile(factory, staff_id, branch_id, "Employee")
        now = datetime.now(timezone.utc)
        code = issue_device_pairing_code(factory, admin_id, staff_id, clock=lambda: now)
        binding = bind_profile_access(factory, code.raw_code, clock=lambda: now)
        paired_profile_choices(factory, binding.credential, clock=lambda: now + timedelta(days=30) - timedelta(microseconds=1))
        with pytest.raises(AuthorizationDenied):
            paired_profile_choices(factory, binding.credential, clock=lambda: now + timedelta(days=60))

        replacement_code = issue_device_pairing_code(factory, admin_id, staff_id, clock=lambda: now + timedelta(days=60))
        replacement = bind_profile_access(factory, replacement_code.raw_code, clock=lambda: now + timedelta(days=60))
        for day in (89, 118, 147):
            paired_profile_choices(factory, replacement.credential, clock=lambda day=day: now + timedelta(days=day))
        with pytest.raises(AuthorizationDenied):
            paired_profile_choices(factory, replacement.credential, clock=lambda: now + timedelta(days=150))
    finally:
        engine.dispose()


def test_rebinding_and_logout_revoke_profile_proof_and_employee_phone_session(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'proof-replacement.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        admin_id = seed_admin(factory)
        staff_id, branch_id = _seed_employee(factory, "employee@example.invalid", "employee")
        profile_id = _add_profile(factory, staff_id, branch_id, "Employee")
        first_code = issue_device_pairing_code(factory, admin_id, staff_id)
        first = bind_profile_access(factory, first_code.raw_code)
        phone = issue_profile_session(factory, profile_id, branch_id, "246810", paired_credential=first.credential)
        second_code = issue_device_pairing_code(factory, admin_id, staff_id)
        second = bind_profile_access(factory, second_code.raw_code)
        with pytest.raises(AuthorizationDenied):
            paired_profile_choices(factory, first.credential)
        with factory() as session:
            old_phone = session.scalar(select(StaffSession).where(StaffSession.token_digest == hashlib.sha256(phone.access_token.encode()).hexdigest()))
            assert old_phone.revoked_at is not None

        second_phone = issue_profile_session(factory, profile_id, branch_id, "246810", paired_credential=second.credential)
        logout_profile_access(factory, second.credential)
        with pytest.raises(AuthorizationDenied):
            paired_profile_choices(factory, second.credential)
        with factory() as session:
            device = session.get(StaffPairedDevice, second.device_id)
            assert device.profile_access_digest is None
            assert device.revoked_at is not None
            row = session.scalar(select(StaffSession).where(StaffSession.token_digest == hashlib.sha256(second_phone.access_token.encode()).hexdigest()))
            assert row.revoked_at is not None
    finally:
        engine.dispose()


def test_profile_access_logout_returns_empty_204_and_clears_cookie(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'logout-http.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        admin_id = seed_admin(factory)
        staff_id = _seed_staff(factory, "employee@example.invalid")
        with factory() as session:
            branch_id = session.scalar(select(RoleGrant.branch_id).where(RoleGrant.staff_id == staff_id))
        _add_profile(factory, staff_id, branch_id, "Employee")
        code = issue_device_pairing_code(factory, admin_id, staff_id)
        app = create_app(configured_settings(database_url, cors_allowed_origins="https://trusted.example"))
        with TestClient(app, raise_server_exceptions=False) as client:
            paired = client.post("/api/v1/auth/profile-access/pair", json={"pairing_code": code.raw_code},
                                 headers={"Origin": "https://trusted.example"})
            assert paired.status_code == 200
            response = client.post("/api/v1/auth/profile-access/logout", json={},
                                   headers={"Origin": "https://trusted.example"})

        assert response.status_code == 204
        assert response.content == b""
        assert response.headers["cache-control"] == "no-store"
        set_cookie = response.headers["set-cookie"].lower()
        assert "evogym_profile_access=\"\"" in set_cookie or "evogym_profile_access=;" in set_cookie
        assert "path=/api/v1/auth/profile-access" in set_cookie
        assert "max-age=0" in set_cookie
    finally:
        engine.dispose()


def test_cookie_post_requires_json_and_configured_exact_origin(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'origin-guard.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        admin_id = seed_admin(factory)
        staff_id, branch_id = _seed_employee(factory, "employee@example.invalid", "employee")
        profile_id = _add_profile(factory, staff_id, branch_id, "Employee")
        code = issue_device_pairing_code(factory, admin_id, staff_id)
        app = create_app(configured_settings(database_url, cors_allowed_origins="https://trusted.example"))
        with TestClient(app) as client:
            denied_origin = client.post("/api/v1/auth/profile-access/pair", json={"pairing_code": code.raw_code},
                                        headers={"Origin": "https://attacker.example"})
            missing_origin = client.post("/api/v1/auth/profile-access/pair", json={"pairing_code": code.raw_code})
            wrong_media = client.post("/api/v1/auth/profile-access/pair", data="pairing_code=123456",
                                      headers={"Origin": "https://trusted.example"})
            allowed = client.post("/api/v1/auth/profile-access/pair", json={"pairing_code": code.raw_code},
                                  headers={"Origin": "https://trusted.example"})
        assert denied_origin.status_code == 403
        assert missing_origin.status_code == 403
        assert wrong_media.status_code == 415
        assert allowed.status_code == 200
    finally:
        engine.dispose()


def test_cookie_post_fails_closed_when_origin_allowlist_is_empty(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'origin-empty-guard.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        app = create_app(configured_settings(database_url, cors_allowed_origins=None))
        with TestClient(app) as client:
            body = {"profile_id": str(uuid4()), "branch_id": str(uuid4()), "pin": "246810"}
            missing_origin = client.post("/api/v1/auth/profile-access/sessions", json=body)
            untrusted_origin = client.post(
                "/api/v1/auth/profile-access/sessions", json=body,
                headers={"Origin": "https://attacker.example"},
            )
        assert missing_origin.status_code == 403
        assert untrusted_origin.status_code == 403
    finally:
        engine.dispose()


def test_employee_session_logout_is_self_scoped_and_preserves_paired_proof(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'self-logout.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        admin_id = seed_admin(factory)
        staff_id = _seed_staff(factory, "employee@example.invalid")
        with factory() as session:
            branch_id = session.scalar(select(RoleGrant.branch_id).where(RoleGrant.staff_id == staff_id))
        profile_id = _add_profile(factory, staff_id, branch_id, "Employee")
        code = issue_device_pairing_code(factory, admin_id, staff_id)
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(database_url, cors_allowed_origins="https://trusted.example"), recovery_delivery=delivery)
        with TestClient(app) as client:
            paired = client.post("/api/v1/auth/profile-access/pair", json={"pairing_code": code.raw_code},
                                 headers={"Origin": "https://trusted.example"})
            proof = paired.cookies["evogym_profile_access"]
            entered = client.post("/api/v1/auth/profile-access/sessions", json={
                "profile_id": str(profile_id),
                "branch_id": str(branch_id), "pin": "246810",
            }, headers={"Origin": "https://trusted.example"})
            employee_token = entered.json()["access_token"]
            other_phone = issue_profile_session(factory, profile_id, branch_id, "246810", paired_credential=proof)
            admin_login = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password")
            admin_token = admin_login.json()["access_token"]
            reception = client.post("/api/v1/admin/profile-access/sessions", json={
                "profile_id": str(profile_id), "branch_id": str(branch_id), "pin": "246810",
            }, headers={"Origin": "https://trusted.example", "Authorization": f"Bearer {admin_token}"})
            reception_token = reception.json()["access_token"]
            rejected_admin = client.post("/api/v1/auth/profile-access/sessions/logout", json={},
                                         headers={"Authorization": f"Bearer {admin_token}"})
            revoked = client.post("/api/v1/auth/profile-access/sessions/logout", json={},
                                  headers={"Authorization": f"Bearer {employee_token}"})
            revoked_reception = client.post("/api/v1/auth/profile-access/sessions/logout", json={},
                                            headers={"Authorization": f"Bearer {reception_token}"})
            repeated = client.post("/api/v1/auth/profile-access/sessions/logout", json={},
                                   headers={"Authorization": f"Bearer {employee_token}"})
            choices = client.get("/api/v1/auth/profile-access/context")
        assert rejected_admin.status_code == 401
        assert revoked.status_code == revoked_reception.status_code == repeated.status_code == 204
        assert choices.status_code == 200 and choices.json()["identities"]
        assert client.cookies.get("evogym_profile_access") == proof
        with pytest.raises(AuthorizationDenied):
            validate_session(factory, employee_token, Permission.MEMBER_OPERATIONAL_READ)
        with pytest.raises(AuthorizationDenied):
            validate_session(factory, reception_token, Permission.MEMBER_OPERATIONAL_READ)
        validate_session(factory, other_phone.access_token, Permission.MEMBER_OPERATIONAL_READ)
    finally:
        engine.dispose()


def test_admin_can_enter_employee_only_through_trusted_computer_station_binding(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'admin-profile-entry.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        admin_id = seed_admin(factory, is_owner=True)
        with factory.begin() as session:
            session.add(OrganizationOwner(id=1, staff_id=admin_id))
        staff_id, branch_id = _seed_employee(factory, "employee@example.invalid", "employee")
        profile_id = _add_profile(factory, staff_id, branch_id, "Employee")
        with factory.begin() as session:
            unlinked_profile = StaffRosterProfile(branch_id=branch_id, staff_user_id=None,
                                                  full_name="Pending Employee", position="Reception")
            session.add(unlinked_profile)
            session.flush()
            unlinked_profile_id = unlinked_profile.id
        with factory.begin() as session:
            second_branch = Branch(code="employee-2", name="Second Branch")
            session.add(second_branch)
            session.flush()
            second_profile = StaffRosterProfile(branch_id=second_branch.id, staff_user_id=staff_id,
                                                 full_name="Employee", position="Reception")
            session.add_all([
                second_profile,
                RoleGrant(staff_id=staff_id, role="receptionist", scope_kind="branch", branch_id=second_branch.id),
            ])
            session.flush()
            second_profile_id = second_profile.id
        delivery = FakeRecoveryDelivery()
        app = create_app(
            configured_settings(database_url, cors_allowed_origins="https://trusted.example"),
            recovery_delivery=delivery,
        )

        with TestClient(app) as client:
            login = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password")
            assert login.status_code == 200
            admin_token = login.json()["access_token"]
            headers = {"Authorization": f"Bearer {admin_token}"}
            choices = client.get("/api/v1/admin/profile-access/choices", headers=headers)
            assert choices.status_code == 200
            identity_rows = choices.json()["identities"]
            own = next(item for item in identity_rows if item["id"] == str(admin_id))
            employee = next(item for item in identity_rows if item["id"] == str(staff_id))
            assert own["kind"] == "admin" and own["is_owner"] is True
            assert [item["profile_id"] for item in employee["branch_profiles"]] == [
                str(profile_id), str(second_profile_id),
            ]
            assert employee["can_manage_employees"] is False

            pending = next(item for item in identity_rows if item["id"] == str(unlinked_profile_id))
            assert pending["kind"] == "unlinked"
            assert pending["source"] == "roster_profile"
            assert pending["profile_id"] == str(unlinked_profile_id)
            assert pending["branch_profiles"] == [{
                "profile_id": str(unlinked_profile_id), "branch_id": str(branch_id), "branch_name": "Employee Branch",
            }]
            assert pending["is_owner"] is False and pending["can_manage_employees"] is False
            denied_unlinked = client.post("/api/v1/admin/profile-access/sessions", headers={
                **headers, "Origin": "https://trusted.example",
            }, json={
                "profile_id": str(unlinked_profile_id), "branch_id": str(branch_id), "pin": "246810",
            })
            assert denied_unlinked.status_code == 401

            pairing = issue_device_pairing_code(factory, admin_id, staff_id)
            binding = bind_profile_access(factory, pairing.raw_code)
            client.cookies.set("evogym_profile_access", binding.credential)
            paired_context = client.get("/api/v1/auth/profile-access/context")
            assert paired_context.status_code == 200
            assert [item["id"] for item in paired_context.json()["identities"]] == [str(staff_id)]
            assert all(item["kind"] != "unlinked" for item in paired_context.json()["identities"])

            entered = client.post("/api/v1/admin/profile-access/sessions", headers={
                **headers, "Origin": "https://trusted.example",
            }, json={
                "profile_id": str(profile_id), "branch_id": str(branch_id), "pin": "246810",
            })
            assert entered.status_code == 201
            payload = entered.json()
            assert payload["purpose"] == "reception"
            assert payload["identity"]["id"] == str(staff_id)
            assert "admin" not in payload["identity"]
            validate_session(factory, payload["access_token"], Permission.MEMBER_OPERATIONAL_READ)

        with factory.begin() as session:
            station = session.scalar(select(ReceptionStation).where(
                ReceptionStation.source_admin_device_id.is_not(None)
            ))
            assert station is not None
            device = session.get(AdminTrustedDevice, station.source_admin_device_id)
            device.revoked_at = datetime.now(timezone.utc)
        with pytest.raises(AuthorizationDenied):
            validate_session(factory, payload["access_token"], Permission.MEMBER_OPERATIONAL_READ)
    finally:
        engine.dispose()


def test_non_owner_admin_can_read_selector_without_employee_management_capability(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'non-owner-profile-choices.db').as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    try:
        owner_id = seed_admin(factory, "owner@example.invalid")
        manager_id = seed_admin(factory, "manager@example.invalid", "manager-password")
        with factory.begin() as session:
            session.add(OrganizationOwner(id=1, staff_id=owner_id))
        employee_id, branch_id = _seed_employee(factory, "employee@example.invalid", "employee")
        profile_id = _add_profile(factory, employee_id, branch_id, "Employee")
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(database_url), recovery_delivery=delivery)
        with TestClient(app) as client:
            login = complete_device_login(client, delivery, "manager@example.invalid", "manager-password")
            assert login.status_code == 200
            headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
            response = client.get("/api/v1/admin/profile-access/choices", headers=headers)
        assert response.status_code == 200
        rows = response.json()["identities"]
        manager = next(item for item in rows if item["id"] == str(manager_id))
        employee = next(item for item in rows if item["id"] == str(employee_id))
        assert manager["is_owner"] is False
        assert manager["can_manage_employees"] is False
        assert employee["branch_profiles"][0]["profile_id"] == str(profile_id)
    finally:
        engine.dispose()
