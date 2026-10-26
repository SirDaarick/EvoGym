"""Opt-in readiness/audit proof for an explicitly supplied disposable PostgreSQL database."""
import os
from pathlib import Path
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import MetaData, Table, create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.audit import AuditAction, append_audit_event
from app.auth.sessions import SessionPrincipal
from app.db.models import SecurityEvent, StaffCredential
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
    engine = None
    factory = None
    schema_created = False
    suffix = uuid4().hex
    try:
        with admin_engine.begin() as connection:
            connection.execute(text(f"CREATE SCHEMA {schema}"))
        schema_created = True
        schema_url = base_url.update_query_dict({
            "options": f"-c search_path={schema} -c statement_timeout=15000 -c lock_timeout=5000",
        })
        monkeypatch.setenv("EVOGYM_ENV", "test")
        monkeypatch.setenv("EVOGYM_DEBUG", "false")
        monkeypatch.setenv("EVOGYM_DATABASE_URL", schema_url.render_as_string(hide_password=False))
        config = Config(str(API_DIR / "alembic.ini"))
        command.upgrade(config, "0003_authorization_sessions")
        engine = create_engine(
            schema_url,
            connect_args={"connect_timeout": 2},
        )
        factory = sessionmaker(engine)
        staff_id, branch_id = uuid4(), uuid4()
        grant_id, credential_id, security_event_id = uuid4(), uuid4(), uuid4()
        with factory.begin() as session:
            now = datetime.now(timezone.utc)
            metadata = MetaData()
            staff_users = Table("staff_users", metadata, autoload_with=session.connection())
            branches = Table("branches", metadata, autoload_with=session.connection())
            role_grants = Table("staff_role_grants", metadata, autoload_with=session.connection())
            credentials = Table("staff_credentials", metadata, autoload_with=session.connection())
            security_events = Table("security_events", metadata, autoload_with=session.connection())
            session.execute(staff_users.insert().values(
                id=staff_id,
                login_identifier=f"audit-{suffix}@example.invalid",
            ))
            session.execute(branches.insert().values(
                id=branch_id,
                code=f"audit-{suffix}",
                name="Synthetic",
                is_active=True,
            ))
            session.execute(role_grants.insert().values(
                id=grant_id,
                staff_id=staff_id,
                role="admin",
                scope_kind="organization",
                branch_id=None,
                is_active=True,
            ))
            session.execute(credentials.insert().values(
                id=credential_id,
                staff_id=staff_id,
                method="pin",
                secret_hash="$2b$12$" + "a" * 53,
                failed_attempts=0,
                locked_until=None,
            ))
            session.execute(security_events.insert().values(
                id=security_event_id,
                staff_id=staff_id,
                occurred_at=now,
                locked_until=now + timedelta(minutes=5),
            ))
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
        try:
            if engine is not None:
                engine.dispose()
        finally:
            try:
                if schema_created:
                    with admin_engine.begin() as connection:
                        connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))
            finally:
                admin_engine.dispose()
