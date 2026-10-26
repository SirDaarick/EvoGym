from sqlalchemy import create_engine, select, func
import pytest

from app.auth.owner import bootstrap_owner
from app.auth.passwords import verify_admin_password
from app.db.base import Base
from app.db.models import AdminPasswordCredential, OrganizationOwner, RoleGrant, StaffUser
from app.db.session import create_session_factory


def _store(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'owner-bootstrap.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with factory.begin() as session:
        session.add(OrganizationOwner(id=1, staff_id=None))
    return engine, factory


def test_bootstrap_claims_single_owner_and_creates_one_new_admin_identity(tmp_path):
    engine, factory = _store(tmp_path)
    try:
        staff_id = bootstrap_owner(factory, "Owner@Example.Test", "Recovery@Example.Test", "A-long-Owner!Password42")
        with factory() as session:
            owner = session.get(OrganizationOwner, 1)
            staff = session.get(StaffUser, staff_id)
            credential = session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == staff_id))
            grant = session.scalar(select(RoleGrant).where(RoleGrant.staff_id == staff_id))
            assert owner.staff_id == staff_id
            assert staff.login_identifier == "owner@example.test"
            assert credential.recovery_email == "recovery@example.test"
            assert credential.recovery_email_verified_at is None
            assert credential.is_owner is True
            assert verify_admin_password("A-long-Owner!Password42", credential.password_hash)
            assert grant.role == "admin" and grant.scope_kind == "organization"
    finally:
        engine.dispose()


def test_bootstrap_is_one_time_and_failure_leaves_no_second_identity(tmp_path):
    engine, factory = _store(tmp_path)
    try:
        first = bootstrap_owner(factory, "owner@example.test", "recovery@example.test", "A-long-Owner!Password42")
        with pytest.raises(RuntimeError, match="already been bootstrapped"):
            bootstrap_owner(factory, "second@example.test", "other@example.test", "Another-long!Password42")
        with factory() as session:
            assert session.scalar(select(func.count()).select_from(StaffUser)) == 1
            assert session.get(OrganizationOwner, 1).staff_id == first
    finally:
        engine.dispose()


def test_bootstrap_requires_migration_slot_and_secure_password(tmp_path):
    engine, factory = _store(tmp_path)
    try:
        with pytest.raises(ValueError, match="at least 14 characters"):
            bootstrap_owner(factory, "owner@example.test", "recovery@example.test", "weak")
        with factory.begin() as session:
            session.query(OrganizationOwner).delete()
        with pytest.raises(RuntimeError, match="migration"):
            bootstrap_owner(factory, "owner@example.test", "recovery@example.test", "A-long-Owner!Password42")
        with factory() as session:
            assert session.scalar(select(func.count()).select_from(StaffUser)) == 0
    finally:
        engine.dispose()
