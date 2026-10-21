from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError

from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session, revoke_session, validate_session
from app.db.base import Base
from app.db.models import Branch, RoleGrant, StaffCredential, StaffUser, StaffSession
from app.db.session import create_session_factory


@pytest.fixture
def authorization_store(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'authorization.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with factory.begin() as session:
        admin = StaffUser(login_identifier="admin@example.test")
        receptionist = StaffUser(login_identifier="desk@example.test")
        inactive = StaffUser(login_identifier="inactive@example.test", is_active=False)
        branch_a, branch_b = Branch(code="a", name="A"), Branch(code="b", name="B")
        session.add_all([admin, receptionist, inactive, branch_a, branch_b])
        session.flush()
        session.add(StaffCredential(staff_id=receptionist.id, method="pin", secret_hash=hash_pin("2468")))
        session.add_all([
            RoleGrant(staff_id=admin.id, role="admin", scope_kind="organization"),
            RoleGrant(staff_id=receptionist.id, role="receptionist", scope_kind="branch", branch_id=branch_a.id),
            RoleGrant(staff_id=inactive.id, role="admin", scope_kind="organization"),
        ])
        session.flush()
        ids = {"admin": admin.id, "receptionist": receptionist.id, "inactive": inactive.id,
               "a": branch_a.id, "b": branch_b.id}
    yield factory, ids
    engine.dispose()


def test_receptionist_is_branch_scoped_and_admin_finance_is_explicit(authorization_store):
    factory, ids = authorization_store
    with factory() as session:
        authorize(session, ids["receptionist"], Permission.MEMBER_OPERATIONAL_READ, ids["a"])


def test_membership_access_management_is_admin_only_and_branch_scoped(authorization_store):
    factory, ids = authorization_store
    with factory() as session:
        authorize(session, ids["admin"], Permission.MEMBERSHIP_ACCESS_MANAGE, ids["a"])
        with pytest.raises(AuthorizationDenied):
            authorize(session, ids["receptionist"], Permission.MEMBERSHIP_ACCESS_MANAGE, ids["a"])
        for branch_id in (ids["b"], None):
            with pytest.raises(AuthorizationDenied):
                authorize(session, ids["receptionist"], Permission.MEMBER_OPERATIONAL_READ, branch_id)
        for restricted in (
            Permission.FINANCE_READ, Permission.STAFF_COMPENSATION_READ,
            Permission.ADMIN_AUDIT_READ, Permission.TRANSFER_REVIEW,
        ):
            with pytest.raises(AuthorizationDenied):
                authorize(session, ids["receptionist"], restricted, ids["a"])
        with pytest.raises(AuthorizationDenied):
            authorize(session, ids["receptionist"], "unknown_permission", ids["a"])
        authorize(session, ids["admin"], Permission.FINANCE_READ, ids["b"])
        authorize(session, ids["admin"], Permission.TRANSFER_REVIEW, ids["b"])
        with pytest.raises(AuthorizationDenied):
            authorize(session, ids["inactive"], Permission.MEMBER_OPERATIONAL_READ, ids["a"])


def test_removed_grant_and_deactivated_branch_deny_immediately(authorization_store):
    factory, ids = authorization_store
    with factory.begin() as session:
        grant = session.query(RoleGrant).filter_by(staff_id=ids["receptionist"]).one()
        grant.is_active = False
    with factory() as session, pytest.raises(AuthorizationDenied):
        authorize(session, ids["receptionist"], Permission.MEMBER_OPERATIONAL_READ, ids["a"])
    with factory.begin() as session:
        grant = session.query(RoleGrant).filter_by(staff_id=ids["receptionist"]).one()
        grant.is_active = True
        session.get(Branch, ids["a"]).is_active = False
    with factory() as session, pytest.raises(AuthorizationDenied):
        authorize(session, ids["receptionist"], Permission.MEMBER_OPERATIONAL_READ, ids["a"])


def test_session_token_is_opaque_and_session_revocation_is_immediate(authorization_store):
    factory, ids = authorization_store
    now = datetime(2026, 10, 19, tzinfo=timezone.utc)
    issued = issue_session(factory, "desk@example.test", "2468", ids["a"], now + timedelta(minutes=10), clock=lambda: now)
    assert issued.token not in repr(issued)
    assert len(issued.token) >= 40
    with factory() as session:
        row = session.query(StaffSession).one()
        assert issued.token not in repr(row)
        assert row.token_digest != issued.token
        assert validate_session(factory, issued.token, Permission.MEMBER_OPERATIONAL_READ, clock=lambda: now).staff_id == ids["receptionist"]
    assert revoke_session(factory, issued.token, clock=lambda: now)
    assert not revoke_session(factory, issued.token, clock=lambda: now)
    with pytest.raises(AuthorizationDenied):
        validate_session(factory, issued.token, Permission.MEMBER_OPERATIONAL_READ, clock=lambda: now)
    with pytest.raises(AuthorizationDenied):
        validate_session(factory, "malformed", Permission.MEMBER_OPERATIONAL_READ, clock=lambda: now)


def test_sessions_require_pin_and_future_aware_expiry(authorization_store):
    factory, ids = authorization_store
    now = datetime(2026, 10, 19, tzinfo=timezone.utc)
    with pytest.raises(AuthorizationDenied):
        issue_session(factory, "desk@example.test", "wrong", ids["a"], now + timedelta(minutes=1), clock=lambda: now)
    with pytest.raises(ValueError):
        issue_session(factory, "desk@example.test", "2468", ids["a"], now.replace(tzinfo=None), clock=lambda: now)
    with pytest.raises(ValueError):
        issue_session(factory, "desk@example.test", "2468", ids["a"], now, clock=lambda: now)
    with pytest.raises(AuthorizationDenied):
        issue_session(factory, "desk@example.test", "2468", ids["b"], now + timedelta(minutes=1), clock=lambda: now)

def test_session_expiration_is_checked_at_exact_boundary(authorization_store):
    factory, ids = authorization_store
    now = datetime(2026, 10, 19, tzinfo=timezone.utc)
    issued = issue_session(factory, "desk@example.test", "2468", ids["a"],
                           now + timedelta(seconds=30), clock=lambda: now)
    with pytest.raises(AuthorizationDenied):
        validate_session(factory, issued.token, Permission.MEMBER_OPERATIONAL_READ, clock=lambda: now + timedelta(seconds=30))



def test_session_expiry_clock_is_sampled_after_authorization_locks(authorization_store, monkeypatch):
    import app.auth.sessions as session_service

    factory, ids = authorization_store
    start = datetime(2026, 10, 19, tzinfo=timezone.utc)
    expiry = start + timedelta(seconds=30)
    issued = issue_session(factory, "desk@example.test", "2468", ids["a"], expiry, clock=lambda: start)
    current = [start]
    original = session_service._lock_authority

    def delayed_authority(*args, **kwargs):
        current[0] = expiry
        return original(*args, **kwargs)

    monkeypatch.setattr(session_service, "_lock_authority", delayed_authority)
    with pytest.raises(AuthorizationDenied):
        validate_session(factory, issued.token, Permission.MEMBER_OPERATIONAL_READ, clock=lambda: current[0])




def test_session_token_is_not_returned_when_persistence_fails(authorization_store):
    from sqlalchemy import event

    factory, ids = authorization_store
    now = datetime(2026, 10, 19, tzinfo=timezone.utc)

    def fail_before_insert(_mapper, _connection, _target):
        raise RuntimeError("synthetic persistence failure")

    event.listen(StaffSession, "before_insert", fail_before_insert)
    try:
        with pytest.raises(RuntimeError, match="synthetic persistence failure"):
            issue_session(factory, "desk@example.test", "2468", ids["a"], now + timedelta(minutes=1), clock=lambda: now)
    finally:
        event.remove(StaffSession, "before_insert", fail_before_insert)
    with factory() as session:
        assert session.query(StaffSession).count() == 0


def test_reused_session_refreshes_preloaded_staff_branch_and_grant(authorization_store):
    factory, ids = authorization_store
    session = factory()
    try:
        staff = session.get(StaffUser, ids["receptionist"])
        branch = session.get(Branch, ids["a"])
        grant = session.query(RoleGrant).filter_by(staff_id=ids["receptionist"]).one()
        assert staff.is_active and branch.is_active and grant.is_active
        with factory.begin() as updater:
            updater.get(StaffUser, ids["receptionist"]).is_active = False
            updater.get(Branch, ids["a"]).is_active = False
            updater.get(RoleGrant, grant.id).is_active = False
        with pytest.raises(AuthorizationDenied):
            authorize(session, ids["receptionist"], Permission.MEMBER_OPERATIONAL_READ, ids["a"])
    finally:
        session.close()


def test_duplicate_organization_admin_grant_is_rejected(authorization_store):
    factory, ids = authorization_store
    session = factory()
    try:
        session.add(RoleGrant(staff_id=ids["admin"], role="admin", scope_kind="organization"))
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()
    finally:
        session.close()


def test_receptionist_may_have_independent_explicit_branch_grants(authorization_store):
    factory, ids = authorization_store
    with factory.begin() as session:
        session.add(RoleGrant(staff_id=ids["receptionist"], role="receptionist", scope_kind="branch", branch_id=ids["b"]))
    with factory() as session:
        authorize(session, ids["receptionist"], Permission.MEMBER_OPERATIONAL_READ, ids["a"])
        authorize(session, ids["receptionist"], Permission.MEMBER_OPERATIONAL_READ, ids["b"])
