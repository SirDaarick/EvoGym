from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import sessionmaker

from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.hashing import hash_pin
from app.auth.sessions import issue_session, validate_session
from app.db.base import Base
from app.db.models import Branch, ReceptionStation, RoleGrant, StaffCredential, StaffRosterProfile, StaffSession, StaffUser


@pytest.fixture
def lifecycle_store(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'employee-session-lifecycle.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    now = datetime(2026, 10, 23, tzinfo=timezone.utc)
    with factory.begin() as session:
        branch = Branch(code="lifecycle", name="Lifecycle")
        staff = StaffUser(login_identifier="lifecycle@example.invalid")
        session.add_all([branch, staff]); session.flush()
        profile = StaffRosterProfile(branch_id=branch.id, staff_user_id=staff.id,
                                     full_name="Lifecycle Staff", position="Reception")
        station_secret = "s" * 43
        station = ReceptionStation(branch_id=branch.id, created_by=staff.id,
                                   credential_digest=hashlib.sha256(station_secret.encode()).hexdigest(),
                                   created_at=now, expires_at=now + timedelta(days=90))
        session.add_all([
            profile, station,
            RoleGrant(staff_id=staff.id, role="receptionist", scope_kind="branch", branch_id=branch.id),
            StaffCredential(staff_id=staff.id, method="pin", secret_hash=hash_pin("246810")),
        ]); session.flush()
        ids = {"staff": staff.id, "branch": branch.id, "profile": profile.id,
               "station": station.id, "station_secret": station_secret}
    yield factory, ids, now
    engine.dispose()


def test_phone_session_has_server_owned_ninety_day_absolute_limit(lifecycle_store):
    factory, ids, now = lifecycle_store
    issued = issue_session(factory, "lifecycle@example.invalid", "246810", ids["branch"],
                           now + timedelta(days=365), clock=lambda: now)
    with factory() as session:
        row = session.scalar(select(StaffSession).where(StaffSession.staff_id == ids["staff"]))
        assert row.employee_purpose == "phone"
        assert row.absolute_expires_at.replace(tzinfo=timezone.utc) == now + timedelta(days=90)
    with pytest.raises(AuthorizationDenied):
        validate_session(factory, issued.token, Permission.MEMBER_OPERATIONAL_READ,
                         clock=lambda: now + timedelta(days=30))


def test_authenticated_phone_activity_slides_idle_touch_without_extending_absolute_expiry(lifecycle_store):
    factory, ids, now = lifecycle_store
    issued = issue_session(factory, "lifecycle@example.invalid", "246810", ids["branch"],
                           now + timedelta(days=90), clock=lambda: now)
    first_touch = now + timedelta(days=29)
    assert validate_session(factory, issued.token, Permission.MEMBER_OPERATIONAL_READ,
                            clock=lambda: first_touch).staff_id == ids["staff"]
    with factory() as session:
        row = session.scalar(select(StaffSession).where(StaffSession.staff_id == ids["staff"]))
        fixed_absolute_expiry = row.absolute_expires_at
        assert row.last_seen_at.replace(tzinfo=timezone.utc) == first_touch

    second_touch = now + timedelta(days=58)
    assert validate_session(factory, issued.token, Permission.MEMBER_OPERATIONAL_READ,
                            clock=lambda: second_touch).staff_id == ids["staff"]
    with factory() as session:
        row = session.scalar(select(StaffSession).where(StaffSession.staff_id == ids["staff"]))
        assert row.last_seen_at.replace(tzinfo=timezone.utc) == second_touch
        assert row.absolute_expires_at == fixed_absolute_expiry
    with pytest.raises(AuthorizationDenied):
        validate_session(factory, issued.token, Permission.MEMBER_OPERATIONAL_READ,
                         clock=lambda: now + timedelta(days=90))


def test_reception_session_has_no_idle_cutoff_but_station_revocation_invalidates_it(lifecycle_store):
    factory, ids, now = lifecycle_store
    from app.auth.sessions import issue_reception_session
    issued = issue_reception_session(factory, ids["station_secret"], ids["profile"], "246810", clock=lambda: now)
    validate_session(factory, issued.token, Permission.MEMBER_OPERATIONAL_READ,
                     clock=lambda: now + timedelta(days=45))
    with factory.begin() as session:
        session.get(ReceptionStation, ids["station"]).revoked_at = now + timedelta(days=46)
    with pytest.raises(AuthorizationDenied):
        validate_session(factory, issued.token, Permission.MEMBER_OPERATIONAL_READ,
                         clock=lambda: now + timedelta(days=47))


def test_reception_session_cannot_select_profile_from_another_branch(lifecycle_store):
    factory, ids, now = lifecycle_store
    from app.auth.sessions import issue_reception_session
    with factory.begin() as session:
        other = Branch(code="other-lifecycle", name="Other")
        session.add(other); session.flush()
        profile = StaffRosterProfile(branch_id=other.id, full_name="Elsewhere", position="Coach")
        session.add(profile); session.flush()
        profile_id = profile.id
    with pytest.raises(AuthorizationDenied):
        issue_reception_session(factory, ids["station_secret"], profile_id, "246810", clock=lambda: now)


def test_reception_validation_reads_station_before_locking_session(lifecycle_store):
    factory, ids, now = lifecycle_store
    from app.auth.sessions import issue_reception_session

    issued = issue_reception_session(factory, ids["station_secret"], ids["profile"], "246810", clock=lambda: now)
    statements = []

    def record_select(_connection, _cursor, statement, _parameters, _context, _executemany):
        normalized = " ".join(statement.lower().split())
        if normalized.startswith("select") and ("from reception_stations" in normalized or "from staff_sessions" in normalized):
            statements.append(normalized)

    event.listen(factory.kw["bind"], "before_cursor_execute", record_select)
    try:
        validate_session(factory, issued.token, Permission.MEMBER_OPERATIONAL_READ, clock=lambda: now + timedelta(days=1))
    finally:
        event.remove(factory.kw["bind"], "before_cursor_execute", record_select)

    station_read = max(index for index, sql in enumerate(statements) if "from reception_stations" in sql)
    session_reads = [index for index, sql in enumerate(statements) if "from staff_sessions" in sql]
    assert len(session_reads) >= 2
    assert station_read < session_reads[-1]


def test_employee_session_migration_downgrade_refuses_reception_state(tmp_path, monkeypatch):
    migration_path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "0035_employee_session_purpose_reception_stations.py"
    spec = importlib.util.spec_from_file_location("employee_session_purpose_migration", migration_path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'employee-session-downgrade.db').as_posix()}")
    with engine.begin() as connection:
        connection.execute(text(
            "create table staff_sessions (scope_kind text, auth_method text, employee_purpose text, reception_station_id text)"
        ))
        connection.execute(text("create table reception_stations (id text primary key)"))
        connection.execute(text(
            "insert into staff_sessions values ('branch', 'pin', 'phone', null), ('branch', 'pin', 'reception', 'station-1')"
        ))
        connection.execute(text("insert into reception_stations values ('station-1')"))
    operations = []
    try:
        with engine.connect() as connection:
            fake_op = SimpleNamespace(
                get_bind=lambda: connection,
                drop_constraint=lambda *args, **kwargs: operations.append(("drop_constraint", args, kwargs)),
                drop_column=lambda *args, **kwargs: operations.append(("drop_column", args, kwargs)),
                drop_index=lambda *args, **kwargs: operations.append(("drop_index", args, kwargs)),
                drop_table=lambda *args, **kwargs: operations.append(("drop_table", args, kwargs)),
            )
            monkeypatch.setattr(migration, "op", fake_op)
            with pytest.raises(RuntimeError, match="Reception session or station state is retained"):
                migration.downgrade()
            assert operations == []
        with engine.connect() as connection:
            assert connection.execute(text("select count(*) from reception_stations")).scalar_one() == 1
    finally:
        engine.dispose()


def test_employee_session_migration_downgrade_allows_legacy_phone_rows(tmp_path, monkeypatch):
    migration_path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "0035_employee_session_purpose_reception_stations.py"
    spec = importlib.util.spec_from_file_location("employee_session_purpose_migration_phone", migration_path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'employee-phone-downgrade.db').as_posix()}")
    with engine.begin() as connection:
        connection.execute(text(
            "create table staff_sessions (scope_kind text, auth_method text, employee_purpose text, reception_station_id text)"
        ))
        connection.execute(text("create table reception_stations (id text primary key)"))
        connection.execute(text("insert into staff_sessions values ('branch', 'pin', 'phone', null)"))
    operations = []
    try:
        with engine.connect() as connection:
            class BatchOperations:
                def __enter__(self):
                    return SimpleNamespace(
                        drop_constraint=lambda *args, **kwargs: operations.append(("drop_constraint", args, kwargs)),
                        drop_column=lambda *args, **kwargs: operations.append(("drop_column", args, kwargs)),
                    )

                def __exit__(self, *_args):
                    return False

            fake_op = SimpleNamespace(
                get_bind=lambda: connection,
                batch_alter_table=lambda *_args, **_kwargs: BatchOperations(),
                drop_index=lambda *args, **kwargs: operations.append(("drop_index", args, kwargs)),
                drop_table=lambda *args, **kwargs: operations.append(("drop_table", args, kwargs)),
            )
            monkeypatch.setattr(migration, "op", fake_op)
            migration.downgrade()
            assert ("drop_table", ("reception_stations",), {}) in operations
    finally:
        engine.dispose()
