"""Opt-in readiness/audit proof for an explicitly supplied disposable PostgreSQL database."""
import os
from pathlib import Path
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.audit import AuditAction, append_audit_event
from app.auth.sessions import SessionPrincipal
from app.db.models import Branch, RoleGrant, SecurityEvent, StaffCredential, StaffUser
from app.db.models.audit import AuditEvent
from app.main import _readiness_probe

API_DIR = Path(__file__).resolve().parents[1]
POSTGRES_URL = os.environ.get("EVOGYM_TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not POSTGRES_URL, reason="requires explicit disposable EVOGYM_TEST_POSTGRES_URL")


def test_postgres_audit_commits_with_caller_and_probe_is_bounded(monkeypatch):
    assert POSTGRES_URL is not None
    base_url = make_url(POSTGRES_URL)
    assert base_url.drivername == "postgresql+psycopg" and base_url.host == "127.0.0.1" and base_url.database == "evogym_test"
    schema = "bk012_" + uuid4().hex
    admin_engine = create_engine(base_url, connect_args={"connect_timeout": 2})
    with admin_engine.begin() as connection:
        connection.execute(text(f"CREATE SCHEMA {schema}"))
    schema_url = base_url.update_query_dict({
        "options": f"-c search_path={schema} -c statement_timeout=15000 -c lock_timeout=5000",
    })
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", schema_url.render_as_string(hide_password=False))
    config = Config(str(API_DIR / "alembic.ini"))
    engine = None
    factory = None
    suffix = uuid4().hex
    staff_id = branch_id = event_id = None
    try:
        command.upgrade(config, "0003_authorization_sessions")
        engine = create_engine(
            schema_url,
            connect_args={"connect_timeout": 2},
        )
        factory = sessionmaker(engine)
        with factory.begin() as session:
            staff = StaffUser(login_identifier=f"audit-{suffix}@example.invalid")
            branch = Branch(code=f"audit-{suffix}", name="Synthetic")
            session.add_all((staff, branch))
            session.flush()
            now = datetime.now(timezone.utc)
            session.add_all((
                RoleGrant(staff_id=staff.id, role="admin", scope_kind="organization"),
                StaffCredential(staff_id=staff.id, method="pin", secret_hash="$2b$12$" + "a" * 53),
                SecurityEvent(staff_id=staff.id, occurred_at=now, locked_until=now + timedelta(minutes=5)),
            ))
            staff_id, branch_id = staff.id, branch.id
        command.upgrade(config, "head")
        with factory() as session:
            assert session.scalar(select(StaffCredential).where(StaffCredential.staff_id == staff_id)) is not None
            assert session.scalar(select(SecurityEvent).where(SecurityEvent.staff_id == staff_id)) is not None
        with factory.begin() as session:
            event = append_audit_event(
                session,
                SessionPrincipal(staff_id, branch_id),
                AuditAction.FINANCE_READ,
                branch_id,
                uuid4(),
            )
            session.flush()
            event_id = event.id
        with factory() as session:
            assert session.get(AuditEvent, event_id) is not None
        rolled_back_id = None
        with pytest.raises(RuntimeError):
            with factory.begin() as session:
                rolled_back = append_audit_event(
                    session,
                    SessionPrincipal(staff_id, branch_id),
                    AuditAction.FINANCE_READ,
                    branch_id,
                    uuid4(),
                )
                session.flush()
                rolled_back_id = rolled_back.id
                raise RuntimeError("synthetic rollback")
        with factory() as session:
            assert session.get(AuditEvent, rolled_back_id) is None
        assert _readiness_probe(engine) is True
    finally:
        if staff_id is not None and factory is not None:
            with factory.begin() as session:
                session.execute(select(AuditEvent).where(AuditEvent.actor_id == staff_id)).scalars().all()
                session.query(AuditEvent).filter(AuditEvent.actor_id == staff_id).delete(synchronize_session=False)
                session.query(RoleGrant).filter(RoleGrant.staff_id == staff_id).delete(synchronize_session=False)
                session.query(SecurityEvent).filter(SecurityEvent.staff_id == staff_id).delete(synchronize_session=False)
                session.query(StaffCredential).filter(StaffCredential.staff_id == staff_id).delete(synchronize_session=False)
                session.query(StaffUser).filter(StaffUser.id == staff_id).delete(synchronize_session=False)
                session.query(Branch).filter(Branch.id == branch_id).delete(synchronize_session=False)
        if engine is not None:
            engine.dispose()
        with admin_engine.begin() as connection:
            connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))
        admin_engine.dispose()
