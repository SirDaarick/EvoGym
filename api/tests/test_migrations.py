from pathlib import Path
import importlib.util
import shutil
from types import SimpleNamespace
from datetime import datetime, timezone
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
import pytest


API_DIR = Path(__file__).resolve().parents[1]


def test_staff_schedule_downgrade_refuses_to_drop_attendance_snapshots(tmp_path, monkeypatch):
    migration_path = API_DIR / "migrations" / "versions" / "0023_staff_attendance_schedule_checkout.py"
    spec = importlib.util.spec_from_file_location("staff_schedule_migration", migration_path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'staff-schedule-downgrade.db').as_posix()}")
    with engine.begin() as connection:
        connection.execute(text(
            "create table staff_attendance_records "
            "(id text primary key, status text, expected_entry_time text, grace_tolerance_minutes integer)"
        ))
        connection.execute(text("create table staff_attendance_checkouts (id text primary key)"))
        connection.execute(text(
            "insert into staff_attendance_records (id, status, expected_entry_time, grace_tolerance_minutes) "
            "values ('attendance-1', 'late', '09:00:00', 15)"
        ))
    with engine.connect() as connection:
        monkeypatch.setattr(migration, "op", SimpleNamespace(get_bind=lambda: connection))
        with pytest.raises(RuntimeError, match="staff attendance records contain schedule snapshots"):
            migration.downgrade()
        assert {"status", "expected_entry_time", "grace_tolerance_minutes"}.issubset(
            {column["name"] for column in inspect(connection).get_columns("staff_attendance_records")}
        )
    engine.dispose()


def test_new_head_migration_revision_fits_alembic_version_column():
    config = Config(str(API_DIR / "alembic.ini"))
    scripts = ScriptDirectory.from_config(config)
    revisions = list(scripts.walk_revisions())

    assert max(len(revision.revision) for revision in revisions) == 35
    assert all(len(revision.revision) <= 128 for revision in revisions)
    assert scripts.get_revision("0010_registers_terminals_and_shifts").revision == "0010_registers_terminals_and_shifts"


def test_access_decision_order_migration_backfills_populated_append_only_rows(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'populated-access-decisions.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0024_member_access_decisions")
    engine = create_engine(database_url)
    period_id, actor_id = uuid4().hex, uuid4().hex
    decision_ids = ["00000000000000000000000000000001", "00000000000000000000000000000002"]
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.commit()
            with connection.begin():
                for decision_id, action in zip(decision_ids, ("restrict", "restore")):
                    connection.execute(text(
                        "INSERT INTO member_access_decisions "
                        "(id, period_id, actor_id, action, reason, idempotency_key, request_fingerprint, created_at) "
                        "VALUES (:id, :period, :actor, :action, 'legacy', :key, :fingerprint, :created)"
                    ), {"id": decision_id, "period": period_id, "actor": actor_id, "action": action,
                        "key": decision_id, "fingerprint": "a" * 64, "created": "2026-10-21 12:00:00"})
        command.upgrade(config, "head")
        with engine.connect() as connection:
            rows = connection.execute(text(
                "SELECT id, action, decision_order, lifted_access_decision_id, lifted_payment_review_id "
                "FROM member_access_decisions ORDER BY decision_order"
            )).mappings().all()
            assert [row["id"] for row in rows] == decision_ids
            assert [row["decision_order"] for row in rows] == [1, 2]
            assert [row["action"] for row in rows] == ["restrict", "restore"]
            assert rows[0]["lifted_access_decision_id"] is None
            assert rows[1]["lifted_access_decision_id"] is None
            assert all(row["lifted_payment_review_id"] is None for row in rows)
        with engine.begin() as connection:
            with pytest.raises(IntegrityError):
                connection.execute(text("UPDATE member_access_decisions SET reason='tampered' WHERE id=:id"),
                                   {"id": decision_ids[0]})
            with pytest.raises(IntegrityError):
                connection.execute(text("DELETE FROM member_access_decisions WHERE id=:id"),
                                   {"id": decision_ids[0]})
    finally:
        engine.dispose()


def test_inventory_revision_fits_alembic_version_column():
    config = Config(str(API_DIR / "alembic.ini"))
    scripts = ScriptDirectory.from_config(config)
    revision = scripts.get_revision("0012_inventory_foundation")
    assert len(revision.revision) <= 128
    assert revision.down_revision == "0011_shift_opening_counts"


def test_snapshot_revision_fits_and_follows_inventory_foundation():
    config = Config(str(API_DIR / "alembic.ini"))
    scripts = ScriptDirectory.from_config(config)
    revision = scripts.get_revision("0013_inventory_snapshots")
    assert len(revision.revision) <= 32
    assert revision.down_revision == "0012_inventory_foundation"


def test_opening_inventory_review_revision_fits_and_follows_snapshots():
    config = Config(str(API_DIR / "alembic.ini"))
    scripts = ScriptDirectory.from_config(config)
    revision = scripts.get_revision("0014_opening_inventory_reviews")
    assert len(revision.revision) <= 32
    assert revision.down_revision == "0013_inventory_snapshots"


def test_membership_sales_revision_fits_and_follows_inventory_snapshots():
    config = Config(str(API_DIR / "alembic.ini"))
    scripts = ScriptDirectory.from_config(config)
    revision = scripts.get_revision("0015_membership_sales")
    assert len(revision.revision) <= 32
    assert revision.down_revision == "0014_opening_inventory_reviews"


def test_overtime_closing_revision_fits_and_follows_membership_sales():
    config = Config(str(API_DIR / "alembic.ini"))
    scripts = ScriptDirectory.from_config(config)
    revision = scripts.get_revision("0016_overtime_shift_close")
    assert len(revision.revision) <= 32
    assert revision.down_revision == "0015_membership_sales"


def test_pending_transfer_revision_fits_and_follows_overtime_close():
    config = Config(str(API_DIR / "alembic.ini"))
    revision = ScriptDirectory.from_config(config).get_revision("0017_membership_transfer_pending")
    assert len(revision.revision) <= 32
    assert revision.down_revision == "0016_overtime_shift_close"


def test_transfer_review_revision_fits_and_follows_pending_transfer():
    config = Config(str(API_DIR / "alembic.ini"))
    revision = ScriptDirectory.from_config(config).get_revision("0018_transfer_review_activation")
    assert len(revision.revision) <= 32
    assert revision.down_revision == "0017_membership_transfer_pending"


def test_membership_debt_revision_fits_and_follows_transfer_reviews():
    config = Config(str(API_DIR / "alembic.ini"))
    revision = ScriptDirectory.from_config(config).get_revision("0019_membership_debt_records")
    assert len(revision.revision) <= 32
    assert revision.down_revision == "0018_transfer_review_activation"


def test_membership_debt_payment_revision_fits_and_follows_initial_debts():
    config = Config(str(API_DIR / "alembic.ini"))
    revision = ScriptDirectory.from_config(config).get_revision("0020_membership_debt_payments")
    assert len(revision.revision) <= 32
    assert revision.down_revision == "0019_membership_debt_records"


def test_membership_access_decisions_revision_fits_and_follows_schedule_checkout():
    config = Config(str(API_DIR / "alembic.ini"))
    revision = ScriptDirectory.from_config(config).get_revision("0024_member_access_decisions")
    assert len(revision.revision) <= 32
    assert revision.down_revision == "0023_staff_sched_checkout"


def test_fresh_and_repeated_upgrade_create_only_staff_auth_tables(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'fresh.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))

    command.upgrade(config, "0002_staff_credentials")
    engine = create_engine(database_url)
    staff_id, credential_id, event_id = str(uuid4()), str(uuid4()), str(uuid4())
    try:
        with engine.begin() as connection:
            connection.execute(text("insert into staff_users (id, login_identifier) values (:id, :login)"),
                               {"id": staff_id, "login": "migration@example.invalid"})
            connection.execute(text("insert into staff_credentials (id, staff_id, method, secret_hash) values (:id, :staff, 'pin', :hash)"),
                               {"id": credential_id, "staff": staff_id, "hash": "$2b$12$" + "a" * 53})
            connection.execute(text("insert into security_events (id, staff_id, occurred_at, locked_until) values (:id, :staff, :occurred, :until)"),
                               {"id": event_id, "staff": staff_id, "occurred": datetime(2026, 10, 19, tzinfo=timezone.utc).isoformat(),
                                "until": datetime(2026, 10, 19, 0, 5, tzinfo=timezone.utc).isoformat()})
        command.upgrade(config, "head")
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert set(inspect(connection).get_table_names()) == {
                "alembic_version", "staff_users", "staff_credentials", "security_events", "branches", "staff_role_grants", "staff_sessions", "audit_events",
                "admin_password_credentials", "admin_recovery_tokens", "admin_auth_events",
                "staff_enrollment_codes", "staff_device_pairing_codes", "staff_paired_devices", "members",
                "member_notes", "member_eligibility_records",
                "services", "plans", "plan_versions", "plan_version_services",
                "payment_terminals", "cash_registers", "shifts", "shift_denomination_counts",
                "products", "stock_initializations",
                "register_inventory_snapshots", "register_inventory_snapshot_items",
                "shift_inventory_reviews", "shift_inventory_observations",
                    "orders", "order_items", "payments", "payment_review_events", "membership_periods", "membership_debts", "membership_debt_payments", "member_access_decisions",
                "staff_roster_profiles", "staff_attendance_records", "staff_attendance_checkouts",
                "shift_closing_denomination_counts",
                "member_check_ins",
                "member_check_in_visits",
            }
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0027_member_checkin_visits"
            checkin_triggers = {
                row[0]
                for row in connection.execute(
                    text("select name from sqlite_master where type='trigger' and tbl_name='member_check_ins'")
                )
            }
            assert checkin_triggers == {
                "trg_member_check_ins_no_update",
                "trg_member_check_ins_no_delete",
            }
            visit_triggers = {
                row[0]
                for row in connection.execute(
                    text("select name from sqlite_master where type='trigger' and tbl_name='member_check_in_visits'")
                )
            }
            assert visit_triggers == {
                "trg_member_check_in_visits_no_update",
                "trg_member_check_in_visits_no_delete",
            }
            assert "visit_id" in {column["name"] for column in inspect(connection).get_columns("member_check_ins")}
            version_column = next(column for column in inspect(connection).get_columns("alembic_version") if column["name"] == "version_num")
            assert version_column["type"].length == 128
            assert connection.execute(text("select id from staff_users where id=:id"), {"id": staff_id}).scalar_one() == staff_id
            assert connection.execute(text("select id from staff_credentials where id=:id"), {"id": credential_id}).scalar_one() == credential_id
            assert connection.execute(text("select id from security_events where id=:id"), {"id": event_id}).scalar_one() == event_id
            grant_indexes = {index["name"] for index in inspect(connection).get_indexes("staff_role_grants")}
            assert "uq_staff_role_grants_org_admin" in grant_indexes
            paired_indexes = {index["name"] for index in inspect(connection).get_indexes("staff_paired_devices")}
            assert "uq_staff_active_paired_device" in paired_indexes
            member_indexes = {index["name"] for index in inspect(connection).get_indexes("members")}
            assert "ix_members_member_number" in member_indexes
            shift_indexes = {index["name"] for index in inspect(connection).get_indexes("shifts")}
            assert "uq_shifts_active_per_register" in shift_indexes
    finally:
        engine.dispose()

def test_existing_sqlite_varchar32_version_table_upgrades_without_rebuild(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'legacy-version-width.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))

    command.upgrade(config, "0007_members")
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(text("alter table alembic_version rename to alembic_version_wide"))
            connection.execute(text("create table alembic_version (version_num varchar(32) not null primary key)"))
            connection.execute(text("insert into alembic_version select version_num from alembic_version_wide"))
            connection.execute(text("drop table alembic_version_wide"))

        command.upgrade(config, "head")

        with engine.connect() as connection:
            version_column = next(column for column in inspect(connection).get_columns("alembic_version") if column["name"] == "version_num")
            assert version_column["type"].length == 32
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0027_member_checkin_visits"
    finally:
        engine.dispose()


def test_postgresql_offline_upgrade_emits_sql_without_connecting(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("EVOGYM_ENV", "production")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv(
        "EVOGYM_DATABASE_URL",
        "postgresql+psycopg://synthetic:offline-only@localhost/evogym_test",
    )
    config = Config(str(API_DIR / "alembic.ini"))

    command.upgrade(config, "head", sql=True)

    captured = capsys.readouterr()
    generated_sql = captured.out
    assert "CREATE TABLE alembic_version" in generated_sql
    assert "version_num VARCHAR(128)" in generated_sql
    assert "ALTER TABLE IF EXISTS alembic_version ALTER COLUMN version_num TYPE VARCHAR(128)" in generated_sql
    assert "0001_baseline" in generated_sql
    assert "CREATE TABLE staff_users" in generated_sql
    assert "CREATE TABLE staff_credentials" in generated_sql
    assert "ALTER TABLE member_access_decisions DISABLE TRIGGER trg_member_access_decisions_no_update_delete" in generated_sql
    assert "ALTER TABLE member_access_decisions ENABLE TRIGGER trg_member_access_decisions_no_update_delete" in generated_sql
    assert "CREATE TABLE security_events" in generated_sql
    assert "CREATE TABLE branches" in generated_sql
    assert "CREATE TABLE staff_role_grants" in generated_sql
    assert "CREATE TABLE staff_sessions" in generated_sql
    assert "CREATE TABLE audit_events" in generated_sql
    assert "CREATE TABLE admin_password_credentials" in generated_sql
    assert "CREATE TABLE admin_recovery_tokens" in generated_sql
    assert "CREATE TABLE admin_auth_events" in generated_sql
    assert "CREATE TABLE staff_enrollment_codes" in generated_sql
    assert "CREATE TABLE staff_device_pairing_codes" in generated_sql
    assert "CREATE TABLE staff_paired_devices" in generated_sql
    assert "CREATE TABLE members" in generated_sql
    assert "CREATE TABLE member_notes" in generated_sql
    assert "CREATE TABLE member_eligibility_records" in generated_sql
    assert "CREATE TABLE services" in generated_sql
    assert "CREATE TABLE plans" in generated_sql
    assert "CREATE TABLE plan_versions" in generated_sql
    assert "CREATE TABLE plan_version_services" in generated_sql
    assert "CREATE TABLE payment_terminals" in generated_sql
    assert "CREATE TABLE cash_registers" in generated_sql
    assert "CREATE TABLE shifts" in generated_sql
    assert "CREATE TABLE shift_denomination_counts" in generated_sql
    assert "CREATE TABLE shift_closing_denomination_counts" in generated_sql
    assert "uq_staff_role_grants_org_admin" in generated_sql
    assert "uq_staff_active_paired_device" in generated_sql
    assert "uq_shifts_active_per_register" in generated_sql
    assert "ix_members_member_number" in generated_sql
    assert "WHERE role = 'admin' AND scope_kind = 'organization'" in generated_sql
    assert "offline-only" not in captured.out + captured.err


def test_empty_baseline_upgrades_a_test_only_predecessor_without_dropping_data(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    migration_directory = tmp_path / "migrations"
    shutil.copytree(API_DIR / "migrations", migration_directory)
    baseline_path = migration_directory / "versions" / "0001_baseline.py"
    baseline_source = baseline_path.read_text(encoding="utf-8")
    baseline_path.write_text(
        baseline_source.replace('down_revision = None', 'down_revision = "test_predecessor"', 1),
        encoding="utf-8",
    )
    (migration_directory / "versions" / "0000_test_predecessor.py").write_text(
        '''from alembic import op\nfrom sqlalchemy import text\n\nrevision = "test_predecessor"\ndown_revision = None\nbranch_labels = None\ndepends_on = None\n\ndef upgrade():\n    op.execute(text("create table test_only_predecessor_data (value text not null)"))\n    op.execute(text("insert into test_only_predecessor_data values ('preserved')"))\n\ndef downgrade():\n    op.execute(text("drop table test_only_predecessor_data"))\n''',
        encoding="utf-8",
    )
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'upgrade.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(migration_directory).replace("%", "%%"))

    command.upgrade(config, "test_predecessor")
    command.upgrade(config, "head")

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            assert connection.execute(text("select value from test_only_predecessor_data")).scalar_one() == "preserved"
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0027_member_checkin_visits"
    finally:
        engine.dispose()


def test_shift_denomination_migration_preserves_historical_shifts_without_fabricating_counts(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'historical-shift.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0010_registers_terminals_and_shifts")
    engine = create_engine(database_url)
    branch_id, staff_id, register_id, shift_id = (uuid4().hex for _ in range(4))
    try:
        with engine.begin() as connection:
            connection.execute(text("insert into branches (id, code, name) values (:id, 'old', 'Old Branch')"), {"id": branch_id})
            connection.execute(text("insert into staff_users (id, login_identifier) values (:id, 'old@example.invalid')"), {"id": staff_id})
            connection.execute(text("insert into cash_registers (id, branch_id, code, name) values (:id, :branch, 'old-register', 'Old Register')"), {"id": register_id, "branch": branch_id})
            connection.execute(text("insert into shifts (id, cash_register_id, opened_by, opening_cash_minor) values (:id, :register, :staff, 25000)"), {"id": shift_id, "register": register_id, "staff": staff_id})

        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.execute(text("select opening_cash_minor from shifts where id=:id"), {"id": shift_id}).scalar_one() == 25000
            assert connection.execute(text("select count(*) from shift_denomination_counts where shift_id=:id"), {"id": shift_id}).scalar_one() == 0
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0027_member_checkin_visits"
    finally:
        engine.dispose()


def test_snapshot_migration_preserves_existing_inventory_and_shift_data(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'snapshot-preservation.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0012_inventory_foundation")
    engine = create_engine(database_url)
    branch_id, staff_id, register_id, shift_id, product_id, initialization_id = (
        uuid4().hex for _ in range(6)
    )
    try:
        with engine.begin() as connection:
            connection.execute(text("insert into branches (id, code, name) values (:id, 'central', 'Central')"),
                               {"id": branch_id})
            connection.execute(text("insert into staff_users (id, login_identifier) values (:id, 'snapshot@example.invalid')"),
                               {"id": staff_id})
            connection.execute(text("insert into cash_registers (id, branch_id, code, name) values (:id, :branch, 'front', 'Front')"),
                               {"id": register_id, "branch": branch_id})
            connection.execute(text("insert into shifts (id, cash_register_id, opened_by, opening_cash_minor) values (:id, :register, :staff, 25000)"),
                               {"id": shift_id, "register": register_id, "staff": staff_id})
            connection.execute(text("insert into shift_denomination_counts (id, shift_id, denomination_minor, quantity) values (:id, :shift, 5000, 5)"),
                               {"id": uuid4().hex, "shift": shift_id})
            connection.execute(text("insert into products (id, code, name, created_by) values (:id, 'bands', 'Bands', :staff)"),
                               {"id": product_id, "staff": staff_id})
            connection.execute(text("insert into stock_initializations (id, branch_id, product_id, quantity, initialized_by) values (:id, :branch, :product, 12, :staff)"),
                               {"id": initialization_id, "branch": branch_id, "product": product_id, "staff": staff_id})

        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.execute(text("select quantity from stock_initializations where id=:id"),
                                      {"id": initialization_id}).scalar_one() == 12
            assert connection.execute(text("select quantity from shift_denomination_counts where shift_id=:id"),
                                      {"id": shift_id}).scalar_one() == 5
            assert connection.execute(text("select count(*) from register_inventory_snapshots")).scalar_one() == 0

        command.downgrade(config, "0012_inventory_foundation")
        with engine.connect() as connection:
            table_names = set(inspect(connection).get_table_names())
            assert "register_inventory_snapshots" not in table_names
            assert "register_inventory_snapshot_items" not in table_names
            assert "shift_inventory_reviews" not in table_names
            assert "shift_inventory_observations" not in table_names
            assert connection.execute(text("select quantity from stock_initializations where id=:id"),
                                      {"id": initialization_id}).scalar_one() == 12
            assert connection.execute(text("select quantity from shift_denomination_counts where shift_id=:id"),
                                      {"id": shift_id}).scalar_one() == 5
    finally:
        engine.dispose()


def test_opening_review_migration_preserves_populated_snapshot_and_historical_shift(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'opening-review-preservation.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0013_inventory_snapshots")
    engine = create_engine(database_url)
    branch_id, staff_id, register_id, product_id, snapshot_id, item_id, shift_id = (
        uuid4().hex for _ in range(7)
    )
    try:
        with engine.begin() as connection:
            connection.execute(text("insert into branches (id, code, name) values (:id, 'proof', 'Proof')"), {"id": branch_id})
            connection.execute(text("insert into staff_users (id, login_identifier) values (:id, 'proof@example.invalid')"), {"id": staff_id})
            connection.execute(text("insert into cash_registers (id, branch_id, code, name) values (:id, :branch, 'front', 'Front')"), {"id": register_id, "branch": branch_id})
            connection.execute(text("insert into products (id, code, name, created_by) values (:id, 'bands', 'Bands', :staff)"), {"id": product_id, "staff": staff_id})
            connection.execute(text("insert into register_inventory_snapshots (id, register_id, branch_id, captured_by, item_count, missing_count, source_state) values (:id, :register, :branch, :staff, 1, 1, 'missing_initializations')"), {"id": snapshot_id, "register": register_id, "branch": branch_id, "staff": staff_id})
            connection.execute(text("insert into register_inventory_snapshot_items (id, snapshot_id, product_id, code, name, unit, initialized, expected_quantity) values (:id, :snapshot, :product, 'bands', 'Bands', 'piece', false, null)"), {"id": item_id, "snapshot": snapshot_id, "product": product_id})
            connection.execute(text("insert into shifts (id, cash_register_id, opened_by, opening_cash_minor) values (:id, :register, :staff, 0)"), {"id": shift_id, "register": register_id, "staff": staff_id})

        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.execute(text("select count(*) from register_inventory_snapshot_items where id=:id"), {"id": item_id}).scalar_one() == 1
            assert connection.execute(text("select count(*) from shift_inventory_reviews")).scalar_one() == 0
            assert connection.execute(text("select count(*) from shifts where id=:id"), {"id": shift_id}).scalar_one() == 1
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0027_member_checkin_visits"

        command.downgrade(config, "0013_inventory_snapshots")
        with engine.connect() as connection:
            assert "shift_inventory_reviews" not in inspect(connection).get_table_names()
            assert connection.execute(text("select count(*) from register_inventory_snapshots where id=:id"), {"id": snapshot_id}).scalar_one() == 1
    finally:
        engine.dispose()


def test_membership_sales_migration_preserves_branch_rows_and_is_reversible(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'membership-sales-migration.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0014_opening_inventory_reviews")
    engine = create_engine(database_url)
    branch_id = uuid4().hex
    try:
        with engine.begin() as connection:
            connection.execute(
                text("insert into branches (id, code, name) values (:id, 'cash-proof', 'Cash Proof')"),
                {"id": branch_id},
            )

        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.execute(text("select name, timezone from branches where id=:id"), {"id": branch_id}).one() == (
                "Cash Proof", "America/Mexico_City"
            )
            assert connection.execute(text("select count(*) from orders")).scalar_one() == 0
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0027_member_checkin_visits"

        command.downgrade(config, "0014_opening_inventory_reviews")
        with engine.connect() as connection:
            assert "orders" not in inspect(connection).get_table_names()
            assert "timezone" not in {column["name"] for column in inspect(connection).get_columns("branches")}
            assert connection.execute(text("select name from branches where id=:id"), {"id": branch_id}).scalar_one() == "Cash Proof"

        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.execute(text("select timezone from branches where id=:id"), {"id": branch_id}).scalar_one() == "America/Mexico_City"
    finally:
        engine.dispose()


def test_overtime_closing_migration_backfills_cash_orders_and_is_reversible(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'overtime-migration.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0015_membership_sales")
    engine = create_engine(database_url)
    branch_id, staff_id, register_id, shift_id, member_id, order_id, payment_id = (uuid4().hex for _ in range(7))
    try:
        with engine.begin() as connection:
            connection.execute(
                text("insert into branches (id, code, name) values (:id, 'overtime', 'Overtime Branch')"),
                {"id": branch_id},
            )
            connection.execute(
                text("insert into staff_users (id, login_identifier) values (:id, 'overtime@example.invalid')"),
                {"id": staff_id},
            )
            connection.execute(
                text("insert into cash_registers (id, branch_id, code, name) values (:id, :branch, 'front', 'Front')"),
                {"id": register_id, "branch": branch_id},
            )
            connection.execute(
                text("insert into shifts (id, cash_register_id, opened_by, opening_cash_minor) values (:id, :register, :staff, 500)"),
                {"id": shift_id, "register": register_id, "staff": staff_id},
            )
            connection.execute(
                text("insert into members (id, member_number, full_name, phone) values (:id, 'M-OT', 'Overtime Member', '5550100')"),
                {"id": member_id},
            )
            connection.execute(
                text("insert into orders (id, branch_id, register_id, shift_id, member_id, seller_id, idempotency_key, request_fingerprint, total_minor) values (:id, :branch, :register, :shift, :member, :staff, 'migration-key', :fingerprint, 125000)"),
                {
                    "id": order_id,
                    "branch": branch_id,
                    "register": register_id,
                    "shift": shift_id,
                    "member": member_id,
                    "staff": staff_id,
                    "fingerprint": "a" * 64,
                },
            )
            connection.execute(
                text("insert into payments (id, order_id, amount_minor, received_by) values (:id, :order, 125000, :staff)"),
                {"id": payment_id, "order": order_id, "staff": staff_id},
            )

        command.upgrade(config, "head")
        with engine.connect() as connection:
            row = connection.execute(
                text("select shift_id, financial_shift_id, is_overtime, cash_included_in_opening from orders where id=:id"),
                {"id": order_id},
            ).one()
            assert row == (shift_id, shift_id, 0, 0)
            assert "shift_closing_denomination_counts" in inspect(connection).get_table_names()
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0027_member_checkin_visits"
            assert connection.execute(
                text("select method, status, amount_minor from payments where id=:id"), {"id": payment_id}
            ).one() == ("cash", "confirmed", 125000)

            pending_order_id = uuid4().hex
            pending_payment_id = uuid4().hex
            connection.close()
        with engine.begin() as connection:
            connection.execute(
                text("insert into orders (id, branch_id, register_id, shift_id, member_id, seller_id, idempotency_key, request_fingerprint, total_minor) values (:id, :branch, :register, :shift, :member, :staff, 'pending-migration-key', :fingerprint, 125000)"),
                {"id": pending_order_id, "branch": branch_id, "register": register_id, "shift": shift_id,
                 "member": member_id, "staff": staff_id, "fingerprint": "b" * 64},
            )
            connection.execute(
                text("insert into payments (id, order_id, method, status, amount_minor, received_by) values (:id, :order, 'transfer', 'pending', 125000, :staff)"),
                {"id": pending_payment_id, "order": pending_order_id, "staff": staff_id},
            )

        with pytest.raises(RuntimeError, match="pending transfer payments exist"):
            command.downgrade(config, "0016_overtime_shift_close")
        with engine.begin() as connection:
            connection.execute(text("delete from payments where id=:id"), {"id": pending_payment_id})
            connection.execute(text("delete from orders where id=:id"), {"id": pending_order_id})

        command.downgrade(config, "0015_membership_sales")
        with engine.connect() as connection:
            assert "shift_closing_denomination_counts" not in inspect(connection).get_table_names()
            assert connection.execute(text("select count(*) from orders where id=:id"), {"id": order_id}).scalar_one() == 1
            assert connection.execute(
                text("select method, status, amount_minor from payments where id=:id"), {"id": payment_id}
            ).one() == ("cash", "confirmed", 125000)

        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.execute(
                text("select financial_shift_id from orders where id=:id"), {"id": order_id}
            ).scalar_one() == shift_id
    finally:
        engine.dispose()


def test_transfer_review_migration_preserves_legacy_pending_and_guards_review_history_downgrade(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'transfer-review-migration.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0017_membership_transfer_pending")
    engine = create_engine(database_url)
    branch_id, staff_id, register_id, shift_id, member_id, order_id, payment_id = (
        uuid4().hex for _ in range(7)
    )
    try:
        with engine.begin() as connection:
            connection.execute(text(
                "insert into branches (id, code, name) values (:id, 'legacy', 'Legacy')"
            ), {"id": branch_id})
            connection.execute(text(
                "insert into staff_users (id, login_identifier) values (:id, 'legacy@example.invalid')"
            ), {"id": staff_id})
            connection.execute(text(
                "insert into cash_registers (id, branch_id, code, name) values (:id, :branch, 'legacy', 'Legacy')"
            ), {"id": register_id, "branch": branch_id})
            connection.execute(text(
                "insert into shifts (id, cash_register_id, opened_by, opening_cash_minor) "
                "values (:id, :register, :staff, 0)"
            ), {"id": shift_id, "register": register_id, "staff": staff_id})
            connection.execute(text(
                "insert into members (id, member_number, full_name, phone) "
                "values (:id, 'LEGACY-01', 'Legacy Member', '5550100')"
            ), {"id": member_id})
            connection.execute(text(
                "insert into orders (id, branch_id, register_id, shift_id, member_id, seller_id, "
                "idempotency_key, request_fingerprint, total_minor) "
                "values (:id, :branch, :register, :shift, :member, :staff, 'legacy-transfer', :fingerprint, 1000)"
            ), {"id": order_id, "branch": branch_id, "register": register_id, "shift": shift_id,
                "member": member_id, "staff": staff_id, "fingerprint": "c" * 64})
            connection.execute(text(
                "insert into payments (id, order_id, method, status, amount_minor, received_by) "
                "values (:id, :order, 'transfer', 'pending', 1000, :staff)"
            ), {"id": payment_id, "order": order_id, "staff": staff_id})

        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.execute(text(
                "select method, status, amount_minor from payments where id=:id"
            ), {"id": payment_id}).one() == ("transfer", "pending", 1000)
            assert "payment_review_events" in inspect(connection).get_table_names()
            assert "membership_debts" in inspect(connection).get_table_names()
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0027_member_checkin_visits"

        cash_order_id = uuid4().hex
        with engine.begin() as connection:
            connection.execute(text(
                "insert into orders (id, branch_id, register_id, shift_id, member_id, seller_id, "
                "idempotency_key, request_fingerprint, total_minor) "
                "values (:id, :branch, :register, :shift, :member, :staff, 'partial-cash-debt', :fingerprint, 1000)"
            ), {"id": cash_order_id, "branch": branch_id, "register": register_id, "shift": shift_id,
                "member": member_id, "staff": staff_id, "fingerprint": "e" * 64})
            connection.execute(text(
                "insert into membership_debts (id, order_id, member_id, initial_outstanding_minor) "
                "values (:id, :order, :member, 500)"
            ), {"id": uuid4().hex, "order": cash_order_id, "member": member_id})
        with pytest.raises(RuntimeError, match="membership debt records exist"):
            command.downgrade(config, "0018_transfer_review_activation")
        with engine.connect() as connection:
            assert connection.execute(text("select count(*) from membership_debts")).scalar_one() == 1
            assert connection.execute(text("select status from payments where id=:id"), {"id": payment_id}).scalar_one() == "pending"
        with engine.begin() as connection:
            connection.execute(text("delete from membership_debts where order_id=:id"), {"id": cash_order_id})
        command.downgrade(config, "0018_transfer_review_activation")

        event_id = uuid4().hex
        with engine.begin() as connection:
            connection.execute(text("update payments set status='under_review' where id=:id"), {"id": payment_id})
            connection.execute(text(
                "insert into payment_review_events "
                "(id, payment_id, actor_id, from_status, to_status, request_fingerprint) "
                "values (:id, :payment, :actor, null, 'under_review', :fingerprint)"
            ), {"id": event_id, "payment": payment_id, "actor": staff_id, "fingerprint": "d" * 64})
        with pytest.raises(RuntimeError, match="voucher review history"):
            command.downgrade(config, "0017_membership_transfer_pending")

        with engine.begin() as connection:
            connection.execute(text("delete from payment_review_events where id=:id"), {"id": event_id})
            connection.execute(text("update payments set status='pending' where id=:id"), {"id": payment_id})
        command.downgrade(config, "0017_membership_transfer_pending")
        with engine.connect() as connection:
            assert "payment_review_events" not in inspect(connection).get_table_names()
            assert connection.execute(text("select status from payments where id=:id"), {"id": payment_id}).scalar_one() == "pending"
    finally:
        engine.dispose()


def test_membership_debt_payment_migration_preserves_debt_and_guards_downgrade(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'debt-payment-migration.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0019_membership_debt_records")
    engine = create_engine(database_url)
    branch_id, staff_id, register_id, shift_id, member_id, order_id, debt_id = (
        uuid4().hex for _ in range(7)
    )
    try:
        with engine.begin() as connection:
            connection.execute(text("insert into branches (id, code, name) values (:id, 'repay', 'Repay')"),
                               {"id": branch_id})
            connection.execute(text("insert into staff_users (id, login_identifier) values (:id, 'repay@example.invalid')"),
                               {"id": staff_id})
            connection.execute(text("insert into cash_registers (id, branch_id, code, name) values (:id, :branch, 'repay', 'Repay')"),
                               {"id": register_id, "branch": branch_id})
            connection.execute(text("insert into shifts (id, cash_register_id, opened_by, opening_cash_minor) values (:id, :register, :staff, 0)"),
                               {"id": shift_id, "register": register_id, "staff": staff_id})
            connection.execute(text("insert into members (id, member_number, full_name, phone) values (:id, 'REPAY-01', 'Repay Member', '5550100')"),
                               {"id": member_id})
            connection.execute(text(
                "insert into orders (id, branch_id, register_id, shift_id, member_id, seller_id, idempotency_key, request_fingerprint, currency, total_minor) "
                "values (:id, :branch, :register, :shift, :member, :staff, 'partial-before-0020', :fingerprint, 'MXN', 10000)"
            ), {"id": order_id, "branch": branch_id, "register": register_id, "shift": shift_id,
                "member": member_id, "staff": staff_id, "fingerprint": "a" * 64})
            connection.execute(text(
                "insert into membership_debts (id, order_id, member_id, initial_outstanding_minor) "
                "values (:id, :order, :member, 6000)"
            ), {"id": debt_id, "order": order_id, "member": member_id})

        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.execute(text("select initial_outstanding_minor from membership_debts where id=:id"),
                                      {"id": debt_id}).scalar_one() == 6000
            assert "membership_debt_payments" in inspect(connection).get_table_names()
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0027_member_checkin_visits"

        receipt_id = uuid4().hex
        with engine.begin() as connection:
            connection.execute(text(
                "insert into membership_debt_payments "
                "(id, debt_id, order_id, member_id, branch_id, register_id, shift_id, amount_minor, remaining_after_minor, received_by, idempotency_key, request_fingerprint) "
                "values (:id, :debt, :order, :member, :branch, :register, :shift, 2500, 3500, :staff, 'repayment-before-downgrade', :fingerprint)"
            ), {"id": receipt_id, "debt": debt_id, "order": order_id, "member": member_id,
                "branch": branch_id, "register": register_id, "shift": shift_id, "staff": staff_id,
                "fingerprint": "b" * 64})

        with pytest.raises(RuntimeError, match="membership debt payment receipts exist"):
            command.downgrade(config, "0019_membership_debt_records")
        with engine.connect() as connection:
            assert connection.execute(text("select count(*) from membership_debt_payments where id=:id"),
                                      {"id": receipt_id}).scalar_one() == 1
            assert connection.execute(text("select initial_outstanding_minor from membership_debts where id=:id"),
                                      {"id": debt_id}).scalar_one() == 6000
        with engine.begin() as connection:
            connection.execute(text("delete from membership_debt_payments where id=:id"), {"id": receipt_id})
        command.downgrade(config, "0019_membership_debt_records")
        with engine.connect() as connection:
            assert "membership_debt_payments" not in inspect(connection).get_table_names()
            assert connection.execute(text("select initial_outstanding_minor from membership_debts where id=:id"),
                                      {"id": debt_id}).scalar_one() == 6000
    finally:
        engine.dispose()


def test_staff_roster_migration_is_branch_scoped_and_blocks_data_loss(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'roster.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0020_membership_debt_payments")
    engine = create_engine(database_url)
    branch_id = uuid4().hex
    profile_id = uuid4().hex
    try:
        command.upgrade(config, "head")
        with engine.begin() as connection:
            assert "staff_roster_profiles" in inspect(connection).get_table_names()
            connection.execute(text("insert into branches (id, code, name) values (:id, 'roster-migration', 'Roster')"),
                               {"id": branch_id})
            connection.execute(text(
                "insert into staff_roster_profiles (id, branch_id, full_name, position) "
                "values (:id, :branch, 'Cleaning Staff', 'Cleaning')"
            ), {"id": profile_id, "branch": branch_id})
        with pytest.raises(RuntimeError, match="staff roster profiles exist"):
            command.downgrade(config, "0020_membership_debt_payments")
        with engine.connect() as connection:
            assert connection.execute(text("select count(*) from staff_roster_profiles where id=:id"),
                                      {"id": profile_id}).scalar_one() == 1
    finally:
        engine.dispose()


def test_staff_attendance_migration_enforces_branch_date_uniqueness_and_append_only(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'attendance.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0021_staff_roster")
    engine = create_engine(database_url)
    branch_id, profile_id, actor_id, record_id = (uuid4().hex for _ in range(4))
    try:
        with engine.begin() as connection:
            connection.execute(text("insert into branches (id, code, name) values (:id, 'attendance-migration', 'Attendance')"),
                               {"id": branch_id})
            connection.execute(text("insert into staff_users (id, login_identifier) values (:id, 'attendance@example.invalid')"),
                               {"id": actor_id})
            connection.execute(text(
                "insert into staff_roster_profiles (id, branch_id, full_name, position) "
                "values (:id, :branch, 'Attendance Profile', 'Cleaning')"
            ), {"id": profile_id, "branch": branch_id})
        command.upgrade(config, "head")
        with engine.begin() as connection:
            assert "staff_attendance_records" in inspect(connection).get_table_names()
            values = {"id": record_id, "branch": branch_id, "profile": profile_id, "actor": actor_id}
            connection.execute(text(
                "insert into staff_attendance_records (id, branch_id, profile_id, recorded_by, occurred_at, business_date) "
                "values (:id, :branch, :profile, :actor, '2026-10-21T02:30:00+00:00', '2026-10-20')"
            ), values)
        with engine.begin() as connection:
            with pytest.raises(IntegrityError):
                connection.execute(text(
                    "insert into staff_attendance_records (id, branch_id, profile_id, recorded_by, occurred_at, business_date) "
                    "values (:id, :branch, :profile, :actor, '2026-10-21T03:00:00+00:00', '2026-10-20')"
                ), {**values, "id": uuid4().hex})
            with pytest.raises(IntegrityError):
                connection.execute(text("update staff_attendance_records set business_date='2026-10-21' where id=:id"),
                                   {"id": record_id})
            with pytest.raises(IntegrityError):
                connection.execute(text("delete from staff_attendance_records where id=:id"), {"id": record_id})
        with pytest.raises(RuntimeError, match="staff attendance records exist"):
            command.downgrade(config, "0021_staff_roster")
        with engine.connect() as connection:
            assert connection.execute(text("select count(*) from staff_attendance_records where id=:id"),
                                      {"id": record_id}).scalar_one() == 1
    finally:
        engine.dispose()


def test_staff_checkout_migration_guards_checkout_rows_as_append_only(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'checkout.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "head")
    engine = create_engine(database_url)
    branch_id, profile_id, actor_id, attendance_id, checkout_id = (uuid4().hex for _ in range(5))
    try:
        with engine.begin() as connection:
            connection.execute(text("insert into branches (id, code, name) values (:id, 'checkout-migration', 'Checkout')"), {"id": branch_id})
            connection.execute(text("insert into staff_users (id, login_identifier) values (:id, 'checkout@example.invalid')"), {"id": actor_id})
            connection.execute(text("insert into staff_roster_profiles (id, branch_id, full_name, position) values (:id, :branch, 'Checkout Profile', 'Cleaning')"), {"id": profile_id, "branch": branch_id})
            connection.execute(text("insert into staff_attendance_records (id, branch_id, profile_id, recorded_by, occurred_at, business_date) values (:id, :branch, :profile, :actor, '2026-10-21T02:30:00+00:00', '2026-10-20')"), {"id": attendance_id, "branch": branch_id, "profile": profile_id, "actor": actor_id})
            values = {"id": checkout_id, "attendance": attendance_id, "actor": actor_id}
            connection.execute(text("insert into staff_attendance_checkouts (id, attendance_id, recorded_by, occurred_at) values (:id, :attendance, :actor, '2026-10-21T03:00:00+00:00')"), values)
        with engine.begin() as connection:
            with pytest.raises(IntegrityError):
                connection.execute(text("update staff_attendance_checkouts set occurred_at='2026-10-21T04:00:00+00:00' where id=:id"), {"id": checkout_id})
            with pytest.raises(IntegrityError):
                connection.execute(text("delete from staff_attendance_checkouts where id=:id"), {"id": checkout_id})
    finally:
        engine.dispose()
