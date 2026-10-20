from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select

from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session, validate_session
from app.db.base import Base
from app.db.models import Branch, RoleGrant, StaffCredential, StaffUser
from app.db.session import create_session_factory


def test_expiry_and_authorization_inputs_are_required_and_current(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'sessions.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    now = datetime(2026, 10, 19, tzinfo=timezone.utc)
    with factory.begin() as session:
        staff = StaffUser(login_identifier="desk@example.test")
        branch = Branch(code="desk", name="Reception")
        session.add_all([staff, branch]); session.flush()
        session.add(RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch.id))
        session.add(StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin("2468")))
        staff_id, branch_id = staff.id, branch.id
    issued = issue_session(factory, "desk@example.test", "2468", branch_id,
                           now + timedelta(minutes=1), clock=lambda: now)
    with factory.begin() as session:
        session.get(StaffUser, staff_id).is_active = False
    with pytest.raises(AuthorizationDenied):
        validate_session(factory, issued.token, Permission.MEMBER_OPERATIONAL_READ, clock=lambda: now)
    engine.dispose()


def test_session_issue_rechecks_pin_after_intervening_credential_rotation(tmp_path, monkeypatch):
    import app.auth.sessions as session_service

    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'credential-race.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    now = datetime(2026, 10, 19, tzinfo=timezone.utc)
    with factory.begin() as session:
        staff = StaffUser(login_identifier="race@example.test")
        branch = Branch(code="race", name="Race")
        session.add_all([staff, branch]); session.flush()
        session.add_all([
            RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch.id),
            StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin("2468")),
        ])
        staff_id, branch_id = staff.id, branch.id

    original_authenticate = session_service.authenticate_pin

    def authenticate_then_rotate(session_factory, login_identifier, pin, *, clock):
        result = original_authenticate(session_factory, login_identifier, pin, clock=clock)
        with session_factory.begin() as session:
            credential = session.scalar(select(StaffCredential).where(StaffCredential.staff_id == staff_id))
            credential.secret_hash = hash_pin("9999")
            credential.failed_attempts = 5
            credential.locked_until = now + timedelta(minutes=5)
        return result

    monkeypatch.setattr(session_service, "authenticate_pin", authenticate_then_rotate)
    with pytest.raises(AuthorizationDenied):
        issue_session(factory, "race@example.test", "2468", branch_id, now + timedelta(minutes=10), clock=lambda: now)
    engine.dispose()
