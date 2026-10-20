from pathlib import Path
import shutil
from datetime import datetime, timezone
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text


API_DIR = Path(__file__).resolve().parents[1]


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
                "alembic_version", "staff_users", "staff_credentials", "security_events", "branches", "staff_role_grants", "staff_sessions"
            }
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0003_authorization_sessions"
            assert connection.execute(text("select id from staff_users where id=:id"), {"id": staff_id}).scalar_one() == staff_id
            assert connection.execute(text("select id from staff_credentials where id=:id"), {"id": credential_id}).scalar_one() == credential_id
            assert connection.execute(text("select id from security_events where id=:id"), {"id": event_id}).scalar_one() == event_id
            grant_indexes = {index["name"] for index in inspect(connection).get_indexes("staff_role_grants")}
            assert "uq_staff_role_grants_org_admin" in grant_indexes
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
    assert "0001_baseline" in generated_sql
    assert "CREATE TABLE staff_users" in generated_sql
    assert "CREATE TABLE staff_credentials" in generated_sql
    assert "CREATE TABLE security_events" in generated_sql
    assert "CREATE TABLE branches" in generated_sql
    assert "CREATE TABLE staff_role_grants" in generated_sql
    assert "CREATE TABLE staff_sessions" in generated_sql
    assert "uq_staff_role_grants_org_admin" in generated_sql
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
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0003_authorization_sessions"
    finally:
        engine.dispose()
