"""Tests for Admin-managed device enrollment, 6-digit pairing, and mobile binding (BK-060)."""
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
import hashlib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.auth.authorization import AuthorizationDenied
from app.auth.devices import (
    DevicePairingDenied,
    issue_device_pairing_code,
    list_paired_devices,
    pair_device,
    revoke_paired_device,
)
from app.db.base import Base
from app.db.models import AdminAuthEvent, Branch, OrganizationOwner, ReceptionStation, RoleGrant, StaffDevicePairingCode, StaffPairedDevice, StaffSession, StaffUser
from app.main import create_app
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings, seed_admin


def _setup_db(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'devices-test.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    return url, engine, factory


def _seed_staff(factory, login="receptionist@evogym.com") -> UUID:
    with factory.begin() as session:
        staff = StaffUser(login_identifier=login)
        branch = Branch(code="central", name="Central Branch")
        session.add_all([staff, branch])
        session.flush()
        session.add(RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch.id))
        return staff.id


def test_issue_6_digit_pairing_code_and_verify_metadata(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory)
        staff_id = _seed_staff(factory)

        issued = issue_device_pairing_code(factory, admin_id, staff_id, ttl_seconds=900)

        assert issued.raw_code
        assert len(issued.raw_code) == 6
        assert issued.raw_code.isdigit()
        assert issued.staff_id == staff_id

        # Raw 6-digit code is NOT stored plaintext; only SHA-256 hash is in DB
        expected_hash = hashlib.sha256(issued.raw_code.encode("ascii")).hexdigest()
        with factory() as session:
            row = session.scalar(select(StaffDevicePairingCode).where(StaffDevicePairingCode.id == issued.id))
            assert row is not None
            assert row.code_hash == expected_hash
            assert issued.raw_code != row.code_hash
            assert row.failed_attempts == 0
            assert row.used_at is None
            assert row.revoked_at is None

            # Verify audit event logged
            event = session.scalar(
                select(AdminAuthEvent).where(
                    AdminAuthEvent.action == "device_pairing_code_issued",
                    AdminAuthEvent.actor_id == admin_id,
                    AdminAuthEvent.subject_staff_id == staff_id,
                )
            )
            assert event is not None
    finally:
        engine.dispose()


def test_issue_pairing_code_revokes_prior_pending_codes_for_staff(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory)
        staff_id = _seed_staff(factory)

        first = issue_device_pairing_code(factory, admin_id, staff_id)
        second = issue_device_pairing_code(factory, admin_id, staff_id)

        with factory() as session:
            r1 = session.scalar(select(StaffDevicePairingCode).where(StaffDevicePairingCode.id == first.id))
            r2 = session.scalar(select(StaffDevicePairingCode).where(StaffDevicePairingCode.id == second.id))
            assert r1.revoked_at is not None
            assert r2.revoked_at is None
    finally:
        engine.dispose()


def test_pair_device_success_and_binding(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory)
        staff_id = _seed_staff(factory, "sheila@evogym.com")

        issued = issue_device_pairing_code(factory, admin_id, staff_id)
        device_id = pair_device(
            factory,
            login_identifier="sheila@evogym.com",
            pairing_code_str=issued.raw_code,
            device_identifier_str="hardware-uuid-12345",
            device_name="iPhone 14 de Sheila",
        )
        assert device_id is not None

        with factory() as session:
            # Pairing code must be marked as used
            code_row = session.scalar(select(StaffDevicePairingCode).where(StaffDevicePairingCode.id == issued.id))
            assert code_row.used_at is not None

            # Paired device record exists
            dev_row = session.scalar(select(StaffPairedDevice).where(StaffPairedDevice.id == device_id))
            assert dev_row is not None
            assert dev_row.device_name == "iPhone 14 de Sheila"
            assert dev_row.revoked_at is None

            # Audit event logged
            event = session.scalar(
                select(AdminAuthEvent).where(
                    AdminAuthEvent.action == "device_paired",
                    AdminAuthEvent.actor_id == staff_id,
                )
            )
            assert event is not None
    finally:
        engine.dispose()


def test_pairing_code_lockout_after_3_failed_attempts(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory)
        staff_id = _seed_staff(factory, "sheila@evogym.com")
        issued = issue_device_pairing_code(factory, admin_id, staff_id)

        # Attempt 1: wrong code
        try:
            pair_device(factory, "sheila@evogym.com", "000000", "dev-1", "Phone 1")
            assert False, "Expected DevicePairingDenied"
        except DevicePairingDenied:
            pass

        with factory() as session:
            row = session.scalar(select(StaffDevicePairingCode).where(StaffDevicePairingCode.id == issued.id))
            assert row.failed_attempts == 1
            assert row.revoked_at is None

        # Attempt 2: wrong code
        try:
            pair_device(factory, "sheila@evogym.com", "111111", "dev-1", "Phone 1")
            assert False, "Expected DevicePairingDenied"
        except DevicePairingDenied:
            pass

        with factory() as session:
            row = session.scalar(select(StaffDevicePairingCode).where(StaffDevicePairingCode.id == issued.id))
            assert row.failed_attempts == 2
            assert row.revoked_at is None

        # Attempt 3: wrong code -> locked out & revoked
        try:
            pair_device(factory, "sheila@evogym.com", "222222", "dev-1", "Phone 1")
            assert False, "Expected DevicePairingDenied"
        except DevicePairingDenied:
            pass

        with factory() as session:
            row = session.scalar(select(StaffDevicePairingCode).where(StaffDevicePairingCode.id == issued.id))
            assert row.failed_attempts == 3
            assert row.revoked_at is not None

        # Attempt 4: even with correct code, must be denied because code is locked
        try:
            pair_device(factory, "sheila@evogym.com", issued.raw_code, "dev-1", "Phone 1")
            assert False, "Expected DevicePairingDenied on locked code"
        except DevicePairingDenied:
            pass
        with factory() as session:
            row = session.get(StaffDevicePairingCode, issued.id)
            active_devices = session.scalars(select(StaffPairedDevice).where(
                StaffPairedDevice.staff_id == staff_id, StaffPairedDevice.revoked_at.is_(None),
            )).all()
            assert row.revoked_at is not None
            assert active_devices == []
    finally:
        engine.dispose()


def test_pairing_expired_code_fails(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory)
        staff_id = _seed_staff(factory, "sheila@evogym.com")

        now = datetime(2026, 10, 20, 10, 0, 0, tzinfo=timezone.utc)
        issued = issue_device_pairing_code(factory, admin_id, staff_id, ttl_seconds=600, clock=lambda: now)

        # Advance clock by 601s
        future = now + timedelta(seconds=601)
        try:
            pair_device(factory, "sheila@evogym.com", issued.raw_code, "dev-1", "Phone", clock=lambda: future)
            assert False, "Expected DevicePairingDenied for expired code"
        except DevicePairingDenied:
            pass
    finally:
        engine.dispose()


def test_enforce_one_active_device_limit_per_staff(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory)
        staff_id = _seed_staff(factory, "sheila@evogym.com")

        # Pair first device
        code1 = issue_device_pairing_code(factory, admin_id, staff_id)
        dev1_id = pair_device(factory, "sheila@evogym.com", code1.raw_code, "dev-1", "iPhone 13")

        with factory() as session:
            active_devices = session.scalars(
                select(StaffPairedDevice).where(
                    StaffPairedDevice.staff_id == staff_id,
                    StaffPairedDevice.revoked_at.is_(None),
                )
            ).all()
            assert len(active_devices) == 1
            assert active_devices[0].id == dev1_id

        # Pair second device -> first device must be automatically revoked
        code2 = issue_device_pairing_code(factory, admin_id, staff_id)
        dev2_id = pair_device(factory, "sheila@evogym.com", code2.raw_code, "dev-2", "iPhone 14")

        with factory() as session:
            all_devices = session.scalars(
                select(StaffPairedDevice).where(StaffPairedDevice.staff_id == staff_id)
            ).all()
            assert len(all_devices) == 2

            d1 = session.scalar(select(StaffPairedDevice).where(StaffPairedDevice.id == dev1_id))
            d2 = session.scalar(select(StaffPairedDevice).where(StaffPairedDevice.id == dev2_id))
            assert d1.revoked_at is not None
            assert d2.revoked_at is None

            # Enforcing exactly 1 active device in DB
            active = session.scalars(
                select(StaffPairedDevice).where(
                    StaffPairedDevice.staff_id == staff_id,
                    StaffPairedDevice.revoked_at.is_(None),
                )
            ).all()
            assert len(active) == 1
            assert active[0].id == dev2_id
    finally:
        engine.dispose()


def test_pairing_replacement_revokes_only_phone_sessions_and_consumes_code_atomically(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory)
        staff_id = _seed_staff(factory, "sheila@evogym.com")
        first_code = issue_device_pairing_code(factory, admin_id, staff_id)
        first_device_id = pair_device(factory, "sheila@evogym.com", first_code.raw_code, "old", "Old phone")
        now = datetime(2026, 10, 24, tzinfo=timezone.utc)
        phone = StaffSession(staff_id=staff_id, branch_id=_branch_for_staff(factory, staff_id),
                             scope_kind="branch", auth_method="pin", token_digest="p" * 64,
                             issued_at=now, expires_at=now + timedelta(days=1),
                             employee_purpose="phone")
        legacy_phone = StaffSession(staff_id=staff_id, branch_id=phone.branch_id,
                                    scope_kind="branch", auth_method="pin", token_digest="l" * 64,
                                    issued_at=now, expires_at=now + timedelta(days=1),
                                    employee_purpose=None)
        with factory.begin() as session:
            branch = session.get(Branch, phone.branch_id)
            station = ReceptionStation(branch_id=branch.id, created_by=staff_id,
                                       credential_digest="s" * 64, created_at=now,
                                       expires_at=now + timedelta(days=90))
            session.add(station)
            session.flush()
            reception = StaffSession(staff_id=staff_id, branch_id=branch.id,
                                     scope_kind="branch", auth_method="pin", token_digest="r" * 64,
                                     issued_at=now, expires_at=now + timedelta(days=1),
                                     employee_purpose="reception", reception_station_id=station.id)
            admin = StaffSession(staff_id=admin_id, branch_id=None,
                                 scope_kind="organization", auth_method="admin_password",
                                 token_digest="a" * 64, issued_at=now,
                                 expires_at=now + timedelta(days=1))
            session.add_all([phone, legacy_phone, reception, admin])

        replacement_code = issue_device_pairing_code(factory, admin_id, staff_id)
        replacement_id = pair_device(factory, "sheila@evogym.com", replacement_code.raw_code, "new", "New phone")

        with factory() as session:
            stored = {row.token_digest: row for row in session.scalars(select(StaffSession)).all()}
            assert stored["p" * 64].revoked_at is not None
            assert stored["l" * 64].revoked_at is not None
            assert stored["r" * 64].revoked_at is None
            assert stored["a" * 64].revoked_at is None
            assert session.get(StaffPairedDevice, first_device_id).revoked_at is not None
            assert session.get(StaffPairedDevice, replacement_id).revoked_at is None
            assert session.get(StaffDevicePairingCode, replacement_code.id).used_at is not None
    finally:
        engine.dispose()


def _branch_for_staff(factory, staff_id: UUID) -> UUID:
    with factory() as session:
        grant = session.scalar(select(RoleGrant).where(RoleGrant.staff_id == staff_id))
        return grant.branch_id


def test_admin_list_and_revoke_devices(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory)
        staff_id = _seed_staff(factory, "sheila@evogym.com")

        code = issue_device_pairing_code(factory, admin_id, staff_id)
        dev_id = pair_device(factory, "sheila@evogym.com", code.raw_code, "dev-1", "iPhone 14")

        devices = list_paired_devices(factory, admin_id)
        assert len(devices) == 1
        assert devices[0].id == dev_id
        assert devices[0].staff_login == "sheila@evogym.com"
        assert devices[0].device_name == "iPhone 14"
        assert devices[0].revoked is False
        assert not hasattr(devices[0], "device_identifier_hash")

        # A lost phone revocation also consumes any still-pending authorization to pair it.
        pending = issue_device_pairing_code(factory, admin_id, staff_id)
        assert revoke_paired_device(factory, admin_id, dev_id) is True

        devices_after = list_paired_devices(factory, admin_id)
        assert len(devices_after) == 1
        assert devices_after[0].revoked is True

        with factory() as session:
            event = session.scalar(
                select(AdminAuthEvent).where(
                    AdminAuthEvent.action == "device_revoked",
                    AdminAuthEvent.actor_id == admin_id,
                )
            )
            assert event is not None
            pending_row = session.get(StaffDevicePairingCode, pending.id)
            assert pending_row.revoked_at is not None
        with pytest.raises(DevicePairingDenied):
            pair_device(factory, "sheila@evogym.com", pending.raw_code, "lost", "Lost phone")
    finally:
        engine.dispose()


def test_device_management_requires_live_employee_permission_after_owner_claim(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        owner_id = seed_admin(factory, "owner@example.invalid")
        nonowner_id = seed_admin(factory, "manager@example.invalid")
        target_id = _seed_staff(factory)
        with factory.begin() as session:
            session.add(OrganizationOwner(id=1, staff_id=owner_id))
        with pytest.raises(AuthorizationDenied):
            issue_device_pairing_code(factory, nonowner_id, target_id)
        issued = issue_device_pairing_code(factory, owner_id, target_id)
        assert issued.staff_id == target_id
    finally:
        engine.dispose()


def test_device_pairing_api_endpoints(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory, "owner@example.invalid", "synthetic-admin-password")
        staff_id = _seed_staff(factory, "sheila@evogym.com")
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        with TestClient(app) as client:
            # 1. Admin login
            login_res = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password")
            assert login_res.status_code == 200
            token = login_res.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}

            # 2. Admin issues 6-digit pairing code
            code_res = client.post(f"/api/v1/admin/staff/{staff_id}/device-pairing", headers=headers)
            assert code_res.status_code == 200
            data = code_res.json()
            pairing_code = data["pairing_code"]
            assert len(pairing_code) == 6
            assert pairing_code.isdigit()

            # 3. Public device pairing with wrong code -> 401
            bad_pair = client.post(
                "/api/v1/auth/devices/pair",
                json={
                    "login_identifier": "sheila@evogym.com",
                    "pairing_code": "000000",
                    "device_identifier": "hardware-xyz",
                    "device_name": "Sheila Phone",
                },
            )
            assert bad_pair.status_code == 401

            # 4. Public device pairing with correct code -> 200
            good_pair = client.post(
                "/api/v1/auth/devices/pair",
                json={
                    "login_identifier": "sheila@evogym.com",
                    "pairing_code": pairing_code,
                    "device_identifier": "hardware-xyz",
                    "device_name": "Sheila Phone",
                },
            )
            assert good_pair.status_code == 200
            device_id = good_pair.json()["device_id"]
            assert good_pair.json()["status"] == "paired"

            # 5. Admin lists devices
            list_res = client.get("/api/v1/admin/devices", headers=headers)
            assert list_res.status_code == 200
            devs = list_res.json()["devices"]
            assert len(devs) == 1
            assert devs[0]["id"] == device_id
            assert devs[0]["staff_login"] == "sheila@evogym.com"
            assert devs[0]["revoked"] is False

            # 6. Admin revokes device
            revoke_res = client.post(f"/api/v1/admin/devices/{device_id}/revoke", headers=headers)
            assert revoke_res.status_code == 200
            assert revoke_res.json() == {"revoked": True}

            # 7. Device now listed as revoked
            list_res2 = client.get("/api/v1/admin/devices", headers=headers)
            assert list_res2.json()["devices"][0]["revoked"] is True
    finally:
        engine.dispose()
