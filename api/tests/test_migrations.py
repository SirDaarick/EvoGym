from pathlib import Path
import shutil

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text


API_DIR = Path(__file__).resolve().parents[1]


def test_fresh_and_repeated_baseline_upgrade_use_only_alembic_version(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'fresh.db').as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", database_url)
    config = Config(str(API_DIR / "alembic.ini"))

    command.upgrade(config, "head")
    command.upgrade(config, "head")

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            assert inspect(connection).get_table_names() == ["alembic_version"]
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0001_baseline"
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
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0001_baseline"
    finally:
        engine.dispose()
