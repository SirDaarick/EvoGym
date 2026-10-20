from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.audit import AuditAction, append_audit_event
from app.auth.authorization import AuthorizationDenied
from app.auth.sessions import SessionPrincipal
from app.db.base import Base
from app.db.models import Branch, RoleGrant, StaffUser
from app.db.models.audit import AuditEvent


@pytest.fixture
def database(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'audit.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    staff, branch = StaffUser(login_identifier="admin@example.invalid"), Branch(code="main", name="Main")
    with factory.begin() as session:
        session.add_all([staff, branch])
        session.flush()
        staff_id, branch_id = staff.id, branch.id
        session.add(RoleGrant(staff_id=staff.id, role="admin", scope_kind="organization"))
    yield factory, staff_id, branch_id
    engine.dispose()


def test_audit_is_minimal_authorized_and_caller_transaction_owned(database):
    factory, staff_id, branch_id = database
    principal = SessionPrincipal(staff_id, branch_id)
    with factory.begin() as session:
        event = append_audit_event(session, principal, AuditAction.MEMBER_READ, branch_id, uuid4())
        assert event.occurred_at.tzinfo is not None
        session.flush()
        event_id = event.id
    with factory() as session:
        row = session.get(AuditEvent, event_id)
        assert row is not None and row.action == AuditAction.MEMBER_READ.value
        assert row.actor_id == staff_id and row.branch_id == branch_id
        assert not hasattr(row, "payload")
        row.action = AuditAction.MEMBER_WRITE.value
        with pytest.raises(ValueError, match="append-only"):
            session.flush()
        session.rollback()
    with pytest.raises(RuntimeError):
        with factory.begin() as session:
            append_audit_event(session, principal, AuditAction.MEMBER_READ, branch_id, uuid4())
            raise RuntimeError("rollback")
    with factory() as session:
        assert len(session.scalars(select(AuditEvent)).all()) == 1


def test_audit_rechecks_current_grant_and_denies_forged_identity(database):
    factory, staff_id, branch_id = database
    principal = SessionPrincipal(staff_id, branch_id)
    with factory.begin() as session:
        session.query(RoleGrant).filter_by(staff_id=staff_id).update({"is_active": False})
    with factory.begin() as session:
        with pytest.raises(AuthorizationDenied):
            append_audit_event(session, principal, AuditAction.MEMBER_READ, branch_id, uuid4())
        with pytest.raises(AuthorizationDenied):
            append_audit_event(session, {"staff_id": staff_id}, AuditAction.MEMBER_READ, branch_id, uuid4())


@pytest.mark.parametrize("action", [AuditAction.MEMBER_WRITE, AuditAction.SHIFT_POST, AuditAction.STAFF_AUTHORIZATION_CHANGED])
def test_unsupported_mutating_actions_are_denied_even_to_broad_read_roles(database, action):
    factory, staff_id, branch_id = database
    with factory.begin() as session:
        with pytest.raises(AuthorizationDenied):
            append_audit_event(session, SessionPrincipal(staff_id, branch_id), action, branch_id, uuid4())
