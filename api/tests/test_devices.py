"""Tests for Admin-managed device enrollment, 6-digit pairing, and mobile binding (BK-060)."""
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
import hashlib

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
from app.db.models import AdminAuthEvent, Branch, RoleGrant, StaffDevicePairingCode, StaffPairedDevice, StaffUser
from app.main import create_app
from test_admin_auth import configured_settings, seed_admin


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

        # Revoke device
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
    finally:
        engine.dispose()


def test_device_pairing_api_endpoints(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory, "owner@example.invalid", "synthetic-admin-password")
        staff_id = _seed_staff(factory, "sheila@evogym.com")
        app = create_app(configured_settings(url))

        with TestClient(app) as client:
            # 1. Admin login
            login_res = client.post(
                "/api/v1/auth/sessions",
                json={"login_identifier": "owner@example.invalid", "password": "synthetic-admin-password"},
            )
            assert login_res.status_code == 201
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
