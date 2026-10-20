from pathlib import Path
import shutil
from datetime import datetime, timezone
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text


API_DIR = Path(__file__).resolve().parents[1]


def test_new_head_migration_revision_fits_alembic_version_column():
    config = Config(str(API_DIR / "alembic.ini"))
    scripts = ScriptDirectory.from_config(config)
    revisions = list(scripts.walk_revisions())

    assert max(len(revision.revision) for revision in revisions) == 35
    assert all(len(revision.revision) <= 128 for revision in revisions)
    assert scripts.get_revision("0010_registers_terminals_and_shifts").revision == "0010_registers_terminals_and_shifts"


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
            }
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0013_inventory_snapshots"
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
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0013_inventory_snapshots"
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
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0013_inventory_snapshots"
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
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0013_inventory_snapshots"
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
            assert connection.execute(text("select quantity from stock_initializations where id=:id"),
                                      {"id": initialization_id}).scalar_one() == 12
            assert connection.execute(text("select quantity from shift_denomination_counts where shift_id=:id"),
                                      {"id": shift_id}).scalar_one() == 5
    finally:
        engine.dispose()
