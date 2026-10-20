"""Opt-in PostgreSQL proof for authorization row locks and current grants."""
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.engine import make_url

from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.auth.credentials import AuthenticationStatus, authenticate_pin
from app.auth.sessions import issue_session, validate_session
from app.auth.hashing import hash_pin
from app.db.models import Branch, RoleGrant, StaffCredential, StaffUser, StaffSession
from app.db.session import create_session_factory

API_DIR = Path(__file__).resolve().parents[1]
POSTGRES_URL = os.environ.get("EVOGYM_TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not POSTGRES_URL, reason="requires explicit disposable EVOGYM_TEST_POSTGRES_URL")


def test_postgres_scoped_grant_changes_are_visible_on_next_authorization(monkeypatch):
    assert POSTGRES_URL is not None
    parsed = make_url(POSTGRES_URL)
    assert parsed.drivername == "postgresql+psycopg" and parsed.host == "127.0.0.1" and parsed.database == "evogym_test"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", POSTGRES_URL)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "head")
    engine = create_engine(POSTGRES_URL)
    factory = create_session_factory(engine)
    suffix = uuid4().hex
    try:
        with factory.begin() as session:
            branch = Branch(code=f"pg-{suffix}", name="Synthetic")
            staff = StaffUser(login_identifier=f"pg-{suffix}@example.invalid")
            session.add_all((branch, staff)); session.flush()
            grant = RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch.id)
            credential = StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin("2468"))
            session.add_all((grant, credential))
            session.flush()
            staff_id, branch_id, grant_id = staff.id, branch.id, grant.id
        with factory() as session:
            authorize(session, staff_id, Permission.MEMBER_OPERATIONAL_READ, branch_id)
        with factory.begin() as session:
            session.get(RoleGrant, grant_id).is_active = False
        with factory() as session, pytest.raises(AuthorizationDenied):
            authorize(session, staff_id, Permission.MEMBER_OPERATIONAL_READ, branch_id)
        result = authenticate_pin(factory, f"pg-{suffix}@example.invalid", "2468")
        assert result.status is AuthenticationStatus.AUTHENTICATED
    finally:
        with factory.begin() as session:
            session.query(StaffSession).filter(StaffSession.staff_id == locals().get("staff_id")).delete(synchronize_session=False)
            session.query(RoleGrant).filter(RoleGrant.staff_id == locals().get("staff_id")).delete(synchronize_session=False)
            session.query(StaffCredential).filter(StaffCredential.staff_id == locals().get("staff_id")).delete(synchronize_session=False)
            session.query(StaffUser).filter(StaffUser.id == locals().get("staff_id")).delete(synchronize_session=False)
            session.query(Branch).filter(Branch.id == locals().get("branch_id")).delete(synchronize_session=False)
        engine.dispose()


def test_postgres_session_rechecks_pin_and_refreshes_locked_authority(monkeypatch):
    import app.auth.sessions as session_service

    assert POSTGRES_URL is not None
    parsed = make_url(POSTGRES_URL)
    assert parsed.drivername == "postgresql+psycopg" and parsed.host == "127.0.0.1" and parsed.database == "evogym_test"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", POSTGRES_URL)
    command.upgrade(Config(str(API_DIR / "alembic.ini")), "head")
    engine = create_engine(POSTGRES_URL)
    factory = create_session_factory(engine)
    suffix = uuid4().hex
    now = datetime.now(timezone.utc)
    cached = None
    staff_id = admin_id = branch_id = grant_id = None
    try:
        with factory.begin() as session:
            branch = Branch(code=f"race-{suffix}", name="Synthetic")
            staff = StaffUser(login_identifier=f"race-{suffix}@example.invalid")
            admin = StaffUser(login_identifier=f"admin-{suffix}@example.invalid")
            session.add_all((branch, staff, admin)); session.flush()
            grant = RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch.id)
            session.add_all((grant, RoleGrant(staff_id=admin.id, role="admin", scope_kind="organization"),
                             StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin("2468"))))
            session.flush()
            staff_id, admin_id, branch_id, grant_id = staff.id, admin.id, branch.id, grant.id

        issued = issue_session(factory, f"race-{suffix}@example.invalid", "2468", branch_id,
                               now + timedelta(minutes=10), clock=lambda: now)
        cached = factory()
        cached_authority = (
            cached.get(StaffUser, staff_id),
            cached.get(Branch, branch_id),
            cached.get(RoleGrant, grant_id),
        )
        assert all(item is not None for item in cached_authority)

        original_authenticate = session_service.authenticate_pin

        def authenticate_then_rotate(session_factory, login_identifier, pin, *, clock):
            result = original_authenticate(session_factory, login_identifier, pin, clock=clock)
            with session_factory.begin() as session:
                credential = session.scalar(select(StaffCredential).where(StaffCredential.staff_id == staff_id).with_for_update())
                credential.secret_hash = hash_pin("9999")
                credential.failed_attempts = 5
                credential.locked_until = now + timedelta(minutes=5)
            return result

        monkeypatch.setattr(session_service, "authenticate_pin", authenticate_then_rotate)
        with pytest.raises(AuthorizationDenied):
            issue_session(factory, f"race-{suffix}@example.invalid", "2468", branch_id,
                          now + timedelta(minutes=10), clock=lambda: now)
        monkeypatch.setattr(session_service, "authenticate_pin", original_authenticate)

        duplicate = factory()
        try:
            duplicate.add(RoleGrant(staff_id=admin_id, role="admin", scope_kind="organization"))
            with pytest.raises(IntegrityError):
                duplicate.flush()
            duplicate.rollback()
        finally:
            duplicate.close()

        with factory.begin() as session:
            session.get(RoleGrant, grant_id).is_active = False
        with pytest.raises(AuthorizationDenied):
            authorize(cached, staff_id, Permission.MEMBER_OPERATIONAL_READ, branch_id)
        cached.rollback()  # Release FOR UPDATE locks before validating the issued session.
        with pytest.raises(AuthorizationDenied):
            validate_session(factory, issued.token, Permission.MEMBER_OPERATIONAL_READ, clock=lambda: now)
    finally:
        if cached is not None:
            cached.close()
        with factory.begin() as session:
            session.query(StaffSession).filter(StaffSession.staff_id == staff_id).delete(synchronize_session=False)
            session.query(RoleGrant).filter(RoleGrant.staff_id.in_([staff_id, admin_id])).delete(synchronize_session=False)
            session.query(StaffCredential).filter(StaffCredential.staff_id == staff_id).delete(synchronize_session=False)
            session.query(StaffUser).filter(StaffUser.id.in_([staff_id, admin_id])).delete(synchronize_session=False)
            session.query(Branch).filter(Branch.id == branch_id).delete(synchronize_session=False)
        engine.dispose()
