"""Tests for employee enrollment codes (BK-059)."""
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
import hashlib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.auth.authorization import AuthorizationDenied
from app.auth.enrollment import issue_enrollment_code, list_enrollment_codes, revoke_enrollment_code
from app.db.base import Base
from app.db.models import AdminAuthEvent, Branch, OrganizationOwner, RoleGrant, StaffEnrollmentCode, StaffUser
from app.main import create_app
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings, seed_admin


def _setup_db(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'enrollment-test.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    return url, engine, factory


def _seed_branch(factory, code="central", name="Central Branch") -> UUID:
    with factory.begin() as session:
        b = Branch(code=code, name=name)
        session.add(b)
        session.flush()
        return b.id


def test_issue_enrollment_code_by_admin_and_verify_metadata(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory)
        branch_id = _seed_branch(factory)

        issued = issue_enrollment_code(
            factory,
            admin_id=admin_id,
            login_identifier="sheila@evogym.com",
            role="receptionist",
            branch_id=branch_id,
            ttl_seconds=86400,
        )

        assert issued.raw_code
        assert len(issued.raw_code) >= 32
        assert issued.login_identifier == "sheila@evogym.com"
        assert issued.role == "receptionist"
        assert issued.branch_id == branch_id

        # Verify raw code is NOT stored in the database, only sha256 hash
        expected_hash = hashlib.sha256(issued.raw_code.encode("ascii")).hexdigest()
        with factory() as session:
            row = session.scalar(select(StaffEnrollmentCode).where(StaffEnrollmentCode.id == issued.id))
            assert row is not None
            assert row.code_hash == expected_hash
            assert issued.raw_code != row.code_hash
            assert row.used_at is None
            assert row.revoked_at is None

            # Verify audit event logged
            event = session.scalar(
                select(AdminAuthEvent).where(
                    AdminAuthEvent.action == "enrollment_code_issued",
                    AdminAuthEvent.actor_id == admin_id,
                )
            )
            assert event is not None
    finally:
        engine.dispose()


def test_issue_enrollment_code_validation_errors(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory)
        branch_id = _seed_branch(factory)

        # Receptionist requires branch_id
        try:
            issue_enrollment_code(factory, admin_id, "test@evogym.com", "receptionist", branch_id=None)
            assert False, "Expected ValueError for missing branch_id"
        except ValueError as exc:
            assert "branch_id is required" in str(exc)

        # Invalid role
        try:
            issue_enrollment_code(factory, admin_id, "test@evogym.com", "trainer", branch_id=branch_id)
            assert False, "Expected ValueError for invalid role"
        except ValueError as exc:
            assert "Invalid role" in str(exc)

        # Non-existent branch
        fake_branch = uuid4()
        try:
            issue_enrollment_code(factory, admin_id, "test@evogym.com", "receptionist", branch_id=fake_branch)
            assert False, "Expected ValueError for non-existent branch"
        except ValueError as exc:
            assert "branch does not exist" in str(exc)

        # Non-admin actor cannot issue
        fake_actor = uuid4()
        try:
            issue_enrollment_code(factory, fake_actor, "test@evogym.com", "admin")
            assert False, "Expected AuthorizationDenied for non-admin"
        except AuthorizationDenied:
            pass
    finally:
        engine.dispose()


def test_list_enrollment_codes_never_returns_secret_and_tracks_statuses(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory)
        branch_id = _seed_branch(factory)

        now = datetime(2026, 10, 20, 10, 0, 0, tzinfo=timezone.utc)
        clock = lambda: now

        c1 = issue_enrollment_code(factory, admin_id, "pending@evogym.com", "receptionist", branch_id, 3600, clock=clock)
        c2 = issue_enrollment_code(factory, admin_id, "expired@evogym.com", "admin", None, 1800, clock=clock)
        c3 = issue_enrollment_code(factory, admin_id, "revoked@evogym.com", "admin", None, 3600, clock=clock)

        revoke_enrollment_code(factory, admin_id, c3.id, clock=clock)

        # Advance clock by 2000s so c2 expires
        clock_advanced = lambda: now + timedelta(seconds=2000)

        records = list_enrollment_codes(factory, admin_id, clock=clock_advanced)
        assert len(records) == 3

        record_map = {r.id: r for r in records}
        assert record_map[c1.id].status == "pending"
        assert record_map[c2.id].status == "expired"
        assert record_map[c3.id].status == "revoked"

        # Check raw codes or hashes are never exposed in EnrollmentCodeRecord
        for r in records:
            assert not hasattr(r, "raw_code")
            assert not hasattr(r, "code_hash")
    finally:
        engine.dispose()


def test_revoke_enrollment_code_idempotent_and_audited(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory)
        c = issue_enrollment_code(factory, admin_id, "staff@evogym.com", "admin")

        # First revocation
        assert revoke_enrollment_code(factory, admin_id, c.id) is True
        with factory() as session:
            events = session.scalars(
                select(AdminAuthEvent).where(
                    AdminAuthEvent.action == "enrollment_code_revoked",
                )
            ).all()
            assert len(events) == 1

        # Second revocation (idempotent, does not add duplicate event)
        assert revoke_enrollment_code(factory, admin_id, c.id) is True
        with factory() as session:
            events = session.scalars(
                select(AdminAuthEvent).where(
                    AdminAuthEvent.action == "enrollment_code_revoked",
                )
            ).all()
            assert len(events) == 1

        # Non-existent code returns False
        assert revoke_enrollment_code(factory, admin_id, uuid4()) is False
    finally:
        engine.dispose()


def test_issue_replaces_prior_pending_code_for_same_login(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory)
        first = issue_enrollment_code(factory, admin_id, "staff@evogym.com", "admin")
        second = issue_enrollment_code(factory, admin_id, "staff@evogym.com", "admin")

        records = list_enrollment_codes(factory, admin_id)
        record_map = {r.id: r for r in records}
        assert record_map[first.id].status == "revoked"
        assert record_map[second.id].status == "pending"
    finally:
        engine.dispose()


def test_enrollment_grants_require_the_claimed_owner_after_bootstrap(tmp_path):
    _url, engine, factory = _setup_db(tmp_path)
    try:
        owner_id = seed_admin(factory, "owner@example.invalid")
        nonowner_id = seed_admin(factory, "manager@example.invalid")
        with factory.begin() as session:
            session.add(OrganizationOwner(id=1, staff_id=owner_id))
        with pytest.raises(AuthorizationDenied):
            issue_enrollment_code(factory, nonowner_id, "new@example.invalid", "admin")
        issued = issue_enrollment_code(factory, owner_id, "new@example.invalid", "admin")
        assert issued.login_identifier == "new@example.invalid"
    finally:
        engine.dispose()


def test_admin_enrollment_api_endpoints(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        admin_id = seed_admin(factory, "owner@example.invalid", "synthetic-admin-password")
        branch_id = _seed_branch(factory)
        delivery = FakeRecoveryDelivery()
        app = create_app(configured_settings(url), recovery_delivery=delivery)

        with TestClient(app) as client:
            # Login as Admin
            login_res = complete_device_login(client, delivery, "owner@example.invalid", "synthetic-admin-password")
            assert login_res.status_code == 200
            token = login_res.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}

            # 1. POST /api/v1/admin/enrollment-codes (Success)
            issue_res = client.post(
                "/api/v1/admin/enrollment-codes",
                headers=headers,
                json={
                    "login_identifier": "receptionist1@evogym.com",
                    "role": "receptionist",
                    "branch_id": str(branch_id),
                    "ttl_seconds": 86400,
                },
            )
            assert issue_res.status_code == 200
            data = issue_res.json()
            code_id = data["id"]
            raw_code = data["code"]
            assert raw_code
            assert data["login_identifier"] == "receptionist1@evogym.com"
            assert data["role"] == "receptionist"

            # 2. POST /api/v1/admin/enrollment-codes (Validation error - missing branch for receptionist)
            bad_res = client.post(
                "/api/v1/admin/enrollment-codes",
                headers=headers,
                json={"login_identifier": "bad@evogym.com", "role": "receptionist"},
            )
            assert bad_res.status_code == 400

            # 3. GET /api/v1/admin/enrollment-codes
            list_res = client.get("/api/v1/admin/enrollment-codes", headers=headers)
            assert list_res.status_code == 200
            codes = list_res.json()["enrollment_codes"]
            assert len(codes) >= 1
            assert codes[0]["id"] == code_id
            assert raw_code not in str(codes)  # Raw code NEVER leaked in listing
            assert "hash" not in str(codes).lower()

            # 4. POST /api/v1/admin/enrollment-codes/{code_id}/revoke
            revoke_res = client.post(f"/api/v1/admin/enrollment-codes/{code_id}/revoke", headers=headers)
            assert revoke_res.status_code == 200
            assert revoke_res.json() == {"revoked": True}

            # Listing now shows revoked
            list_res2 = client.get("/api/v1/admin/enrollment-codes", headers=headers)
            assert list_res2.json()["enrollment_codes"][0]["status"] == "revoked"

            # 5. Revoke 404 for unknown code
            fake_id = str(uuid4())
            not_found = client.post(f"/api/v1/admin/enrollment-codes/{fake_id}/revoke", headers=headers)
            assert not_found.status_code == 404

            # 6. Unauthenticated request denied
            no_auth = client.get("/api/v1/admin/enrollment-codes")
            assert no_auth.status_code == 401
    finally:
        engine.dispose()
