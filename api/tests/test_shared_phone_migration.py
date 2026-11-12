import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

API_DIR = Path(__file__).resolve().parents[1]


def test_phone_key_backfill_accepts_existing_shared_numbers(tmp_path):
    path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "0062_member_phone_key.py"
    spec = importlib.util.spec_from_file_location("phone_key_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine(f"sqlite:///{tmp_path / 'members.sqlite'}")
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE members (id INTEGER PRIMARY KEY, member_number VARCHAR(32), phone VARCHAR(32))"))
            connection.execute(text("INSERT INTO members VALUES (1, 'A', '555-123'), (2, 'B', '555123')"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            assert connection.execute(text("SELECT COUNT(*) FROM members WHERE phone_key='555123'")).scalar_one() == 2
            assert not inspect(connection).get_indexes("members")[0]["unique"]
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    ("filename", "table_sql", "insert_sql", "message"),
    [
        ("0063_member_credit_nonnegative.py", "CREATE TABLE members (credit_balance_minor INTEGER)", "INSERT INTO members VALUES (-5000)", "negative credit balance"),
        ("0064_unique_card_intent.py", "CREATE TABLE payments (mp_payment_intent_id VARCHAR(32))", "INSERT INTO payments VALUES ('same'), ('same')", "sharing a card intent"),
    ],
)
def test_migration_guards_reject_invalid_data_without_changing_rows(tmp_path, filename, table_sql, insert_sql, message):
    path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / filename
    spec = importlib.util.spec_from_file_location("guard_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine(f"sqlite:///{tmp_path / 'guard.sqlite'}")
    try:
        with engine.begin() as connection:
            connection.execute(text(table_sql))
            connection.execute(text(insert_sql))
            table = "members" if filename.startswith("0063") else "payments"
            before = connection.execute(text(f"SELECT * FROM {table}")).all()
            with Operations.context(MigrationContext.configure(connection)), pytest.raises(RuntimeError, match=message):
                migration.upgrade()
            assert connection.execute(text(f"SELECT * FROM {table}")).all() == before
    finally:
        engine.dispose()


@pytest.mark.parametrize("legacy_unique", [False, True])
def test_shared_phone_migration_preserves_members_and_removes_uniqueness(tmp_path, legacy_unique):
    path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "0065_shared_member_phones.py"
    spec = importlib.util.spec_from_file_location("shared_phone_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine(f"sqlite:///{tmp_path / 'members.sqlite'}")
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE members (id INTEGER PRIMARY KEY, phone_key VARCHAR(32))"))
            index = "ux_members_phone_key" if legacy_unique else "ix_members_phone_key"
            unique = "UNIQUE " if legacy_unique else ""
            connection.execute(text(f"CREATE {unique}INDEX {index} ON members (phone_key)"))
            connection.execute(text("INSERT INTO members (id, phone_key) VALUES (1, '555123')"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            connection.execute(text("INSERT INTO members (id, phone_key) VALUES (2, '555123')"))
            assert connection.execute(text("SELECT COUNT(*) FROM members WHERE phone_key='555123'")).scalar_one() == 2
            indexes = {item["name"]: item for item in inspect(connection).get_indexes("members")}
            assert not indexes["ix_members_phone_key"]["unique"]
            assert "ux_members_phone_key" not in indexes
    finally:
        engine.dispose()


def test_flow_b_migrations_offline_sql(tmp_path, capsys, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("EVOGYM_ENV", "production")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv(
        "EVOGYM_DATABASE_URL",
        "postgresql+psycopg://synthetic:offline-only@localhost/evogym_test",
    )
    monkeypatch.setenv(
        "EVOGYM_ADMIN_RECOVERY_BASE_URL",
        "https://app.evogym.test/admin/recover",
    )
    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0061_rental_receipt_credit:0065_shared_member_phones", sql=True)
    captured = capsys.readouterr()
    sql = captured.out

    assert "ALTER TABLE members ADD COLUMN phone_key VARCHAR(32)" in sql
    assert "UPDATE members SET phone_key = NULLIF(RIGHT(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 32), '')" in sql
    assert "CREATE INDEX ix_members_phone_key ON members (phone_key)" in sql
    assert "Fix members with a negative credit balance before migrating." in sql
    assert "ALTER TABLE members ADD CONSTRAINT ck_members_credit_balance_nonnegative CHECK (credit_balance_minor >= 0)" in sql
    assert "Resolve payments sharing a card intent before migrating." in sql
    assert "CREATE UNIQUE INDEX ux_payments_mp_payment_intent_id ON payments (mp_payment_intent_id) WHERE mp_payment_intent_id IS NOT NULL" in sql
    assert "DROP INDEX IF EXISTS ux_members_phone_key" in sql


def test_flow_b_migrations_full_lifecycle_sqlite(tmp_path, monkeypatch):
    db_path = tmp_path / "lifecycle.db"
    url = f"sqlite+pysqlite:///{db_path.as_posix()}"
    monkeypatch.setenv("EVOGYM_ENV", "test")
    monkeypatch.setenv("EVOGYM_DEBUG", "false")
    monkeypatch.setenv("EVOGYM_DATABASE_URL", url)

    from app.settings import get_settings
    if hasattr(get_settings, "cache_clear"):
        get_settings.cache_clear()

    config = Config(str(API_DIR / "alembic.ini"))
    command.upgrade(config, "0061_rental_receipt_credit")
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO members (id, member_number, full_name, phone, credit_balance_minor) "
                "VALUES ('m1', 'MEM-1', 'Name 1', '555-1234', 100), "
                "       ('m2', 'MEM-2', 'Name 2', '555 1234', 200)"
            ))

        command.upgrade(config, "0065_shared_member_phones")

        with engine.begin() as conn:
            rows = conn.execute(text("SELECT id, phone, phone_key FROM members ORDER BY member_number")).all()
            assert rows[0][2] == "5551234"
            assert rows[1][2] == "5551234"

            # Shared phone insert succeeds after 0065
            conn.execute(text(
                "INSERT INTO members (id, member_number, full_name, phone, phone_key, credit_balance_minor) "
                "VALUES ('m3', 'MEM-3', 'Name 3', '5551234', '5551234', 50)"
            ))

            # Negative credit balance rejected after 0063
            with pytest.raises(IntegrityError):
                conn.execute(text(
                    "INSERT INTO members (id, member_number, full_name, phone, phone_key, credit_balance_minor) "
                    "VALUES ('m4', 'MEM-4', 'Name 4', '5551234', '5551234', -50)"
                ))

            # Card intent uniqueness rejected after 0064
            fp = "a" * 64
            conn.execute(text("INSERT INTO branches (id, code, name) VALUES ('b1', 'b1', 'Branch 1')"))
            conn.execute(text("INSERT INTO staff_users (id, login_identifier) VALUES ('s1', 's1@example.com')"))
            conn.execute(text("INSERT INTO cash_registers (id, branch_id, code, name) VALUES ('r1', 'b1', 'r1', 'Reg 1')"))
            conn.execute(text("INSERT INTO shifts (id, cash_register_id, opened_by, opening_cash_minor) VALUES ('sh1', 'r1', 's1', 0)"))
            conn.execute(text(
                "INSERT INTO orders (id, branch_id, register_id, shift_id, member_id, seller_id, idempotency_key, request_fingerprint, total_minor) "
                "VALUES ('o1', 'b1', 'r1', 'sh1', 'm1', 's1', 'k1', :fp, 100), "
                "       ('o2', 'b1', 'r1', 'sh1', 'm1', 's1', 'k2', :fp, 100)"
            ), {"fp": fp})
            conn.execute(text(
                "INSERT INTO payments (id, order_id, register_id, shift_id, received_by, method, status, amount_minor, idempotency_key, request_fingerprint, mp_payment_intent_id) "
                "VALUES ('p1', 'o1', 'r1', 'sh1', 's1', 'card', 'confirmed', 100, 'pk1', :fp, 'intent_123')"
            ), {"fp": fp})
            with pytest.raises(IntegrityError):
                conn.execute(text(
                    "INSERT INTO payments (id, order_id, register_id, shift_id, received_by, method, status, amount_minor, idempotency_key, request_fingerprint, mp_payment_intent_id) "
                    "VALUES ('p2', 'o2', 'r1', 'sh1', 's1', 'card', 'confirmed', 100, 'pk2', :fp, 'intent_123')"
                ), {"fp": fp})

            # Multiple NULL card intents are allowed
            conn.execute(text(
                "INSERT INTO orders (id, branch_id, register_id, shift_id, member_id, seller_id, idempotency_key, request_fingerprint, total_minor) "
                "VALUES ('o3', 'b1', 'r1', 'sh1', 'm1', 's1', 'k3', :fp, 100), "
                "       ('o4', 'b1', 'r1', 'sh1', 'm1', 's1', 'k4', :fp, 100)"
            ), {"fp": fp})
            conn.execute(text(
                "INSERT INTO payments (id, order_id, register_id, shift_id, received_by, method, status, amount_minor, idempotency_key, request_fingerprint, mp_payment_intent_id) "
                "VALUES ('p3', 'o3', 'r1', 'sh1', 's1', 'cash', 'confirmed', 100, 'pk3', :fp, NULL), "
                "       ('p4', 'o4', 'r1', 'sh1', 's1', 'cash', 'confirmed', 100, 'pk4', :fp, NULL)"
            ), {"fp": fp})

        # Downgrade 0065 -> 0064
        command.downgrade(config, "0064_unique_card_intent")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0064_unique_card_intent"

        # Upgrade 0064 -> 0065
        command.upgrade(config, "0065_shared_member_phones")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0065_shared_member_phones"
    finally:
        engine.dispose()


def test_flow_b_migrations_full_lifecycle_postgres(monkeypatch):
    pg_host = os.getenv("EVOGYM_POSTGRES_HOST", "127.0.0.1")
    pg_port = os.getenv("EVOGYM_POSTGRES_PORT", "5433")
    base_admin_url = f"postgresql://evogym:evogym_dev_password@{pg_host}:{pg_port}"

    try:
        import psycopg
        test_conn = psycopg.connect(f"{base_admin_url}/postgres", connect_timeout=2)
        test_conn.close()
    except Exception:
        pytest.skip("Local PostgreSQL container not reachable on port 5433")

    test_db = f"evogym_test_mig_{uuid4().hex[:8]}"
    admin_conn = psycopg.connect(f"{base_admin_url}/postgres", autocommit=True)
    admin_conn.execute(f"CREATE DATABASE {test_db}")
    admin_conn.close()

    try:
        url = f"postgresql+psycopg://evogym:evogym_dev_password@{pg_host}:{pg_port}/{test_db}"
        monkeypatch.setenv("EVOGYM_ENV", "test")
        monkeypatch.setenv("EVOGYM_DEBUG", "false")
        monkeypatch.setenv("EVOGYM_DATABASE_URL", url)

        from app.settings import get_settings
        if hasattr(get_settings, "cache_clear"):
            get_settings.cache_clear()

        config = Config(str(API_DIR / "alembic.ini"))
        command.upgrade(config, "0061_rental_receipt_credit")

        engine = create_engine(url)
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO members (id, member_number, full_name, phone, credit_balance_minor) "
                "VALUES ('00000000-0000-0000-0000-000000000001', 'MEM-1', 'Name 1', '555-1234', 100), "
                "       ('00000000-0000-0000-0000-000000000002', 'MEM-2', 'Name 2', '555 1234', 200)"
            ))

        command.upgrade(config, "0065_shared_member_phones")

        with engine.begin() as conn:
            rows = conn.execute(text("SELECT id, phone, phone_key FROM members ORDER BY member_number")).all()
            assert rows[0][2] == "5551234"
            assert rows[1][2] == "5551234"

            # Shared phone insert succeeds after 0065
            conn.execute(text(
                "INSERT INTO members (id, member_number, full_name, phone, phone_key, credit_balance_minor) "
                "VALUES ('00000000-0000-0000-0000-000000000003', 'MEM-3', 'Name 3', '5551234', '5551234', 50)"
            ))

        # Negative credit balance rejected by PostgreSQL check constraint
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(text(
                    "INSERT INTO members (id, member_number, full_name, phone, phone_key, credit_balance_minor) "
                    "VALUES ('00000000-0000-0000-0000-000000000004', 'MEM-4', 'Name 4', '5551234', '5551234', -50)"
                ))

        fp = "a" * 64
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO branches (id, code, name) VALUES ('00000000-0000-0000-0000-000000000010', 'b1', 'Branch 1')"))
            conn.execute(text("INSERT INTO staff_users (id, login_identifier) VALUES ('00000000-0000-0000-0000-000000000020', 's1@example.com')"))
            conn.execute(text("INSERT INTO cash_registers (id, branch_id, code, name) VALUES ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000010', 'r1', 'Reg 1')"))
            conn.execute(text("INSERT INTO shifts (id, cash_register_id, opened_by, opening_cash_minor) VALUES ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000020', 0)"))
            conn.execute(text(
                "INSERT INTO orders (id, branch_id, register_id, shift_id, member_id, seller_id, idempotency_key, request_fingerprint, total_minor) "
                "VALUES ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000020', 'k1', :fp, 100), "
                "       ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000020', 'k2', :fp, 100)"
            ), {"fp": fp})
            conn.execute(text(
                "INSERT INTO payments (id, order_id, register_id, shift_id, received_by, method, status, amount_minor, idempotency_key, request_fingerprint, mp_payment_intent_id) "
                "VALUES ('00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000020', 'card', 'confirmed', 100, 'pk1', :fp, 'intent_123')"
            ), {"fp": fp})

        # Duplicate card intent rejected by PostgreSQL partial unique index
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(text(
                    "INSERT INTO payments (id, order_id, register_id, shift_id, received_by, method, status, amount_minor, idempotency_key, request_fingerprint, mp_payment_intent_id) "
                    "VALUES ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000020', 'card', 'confirmed', 100, 'pk2', :fp, 'intent_123')"
                ), {"fp": fp})

        # Multiple NULL card intents are allowed
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO orders (id, branch_id, register_id, shift_id, member_id, seller_id, idempotency_key, request_fingerprint, total_minor) "
                "VALUES ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000020', 'k3', :fp, 100), "
                "       ('00000000-0000-0000-0000-000000000053', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000020', 'k4', :fp, 100)"
            ), {"fp": fp})
            conn.execute(text(
                "INSERT INTO payments (id, order_id, register_id, shift_id, received_by, method, status, amount_minor, idempotency_key, request_fingerprint, mp_payment_intent_id) "
                "VALUES ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000020', 'cash', 'confirmed', 100, 'pk3', :fp, NULL), "
                "       ('00000000-0000-0000-0000-000000000063', '00000000-0000-0000-0000-000000000053', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000020', 'cash', 'confirmed', 100, 'pk4', :fp, NULL)"
            ), {"fp": fp})

        # Downgrade 0065 -> 0064
        command.downgrade(config, "0064_unique_card_intent")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0064_unique_card_intent"

        # Upgrade 0064 -> 0065
        command.upgrade(config, "0065_shared_member_phones")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0065_shared_member_phones"

        engine.dispose()
    finally:
        admin_conn = psycopg.connect(f"{base_admin_url}/postgres", autocommit=True)
        admin_conn.execute(f"DROP DATABASE IF EXISTS {test_db} (FORCE)")
        admin_conn.close()
