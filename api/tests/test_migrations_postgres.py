import os
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url


API_DIR = os.path.dirname(os.path.dirname(__file__))
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


@pytest.fixture
def postgres_migration_target(monkeypatch):
    """Use a private schema inside an explicitly supplied disposable PG target."""
    configured_url = os.getenv("EVOGYM_TEST_POSTGRES_URL")
    if not configured_url:
        pytest.skip("Set EVOGYM_TEST_POSTGRES_URL to a disposable local PostgreSQL instance.")

    base_url = make_url(configured_url)
    if not base_url.drivername.startswith("postgresql+") or base_url.host not in LOOPBACK_HOSTS:
        pytest.fail("PostgreSQL migration tests require a loopback-only disposable target.")

    schema = f"migration_proof_{uuid4().hex}"
    admin_engine = create_engine(base_url)
    try:
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))

        test_url = base_url.update_query_dict({"options": f"-csearch_path={schema}"})
        monkeypatch.setenv("EVOGYM_ENV", "test")
        monkeypatch.setenv("EVOGYM_DEBUG", "false")
        monkeypatch.setenv("EVOGYM_DATABASE_URL", test_url.render_as_string(hide_password=False))
        yield test_url, schema
    finally:
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin_engine.dispose()


def _config() -> Config:
    return Config(os.path.join(API_DIR, "alembic.ini"))


def _version_width(engine, schema: str) -> int:
    with engine.connect() as connection:
        return connection.execute(
            text(
                "select character_maximum_length from information_schema.columns "
                "where table_schema=:schema and table_name='alembic_version' "
                "and column_name='version_num'"
            ),
            {"schema": schema},
        ).scalar_one()


def test_postgresql_fresh_full_upgrade_and_repeated_head_preserve_inventory_rows(postgres_migration_target):
    url, schema = postgres_migration_target
    config = _config()

    command.upgrade(config, "head")
    engine = create_engine(url)
    branch_id, staff_id, product_id, initialization_id = (uuid4() for _ in range(4))
    try:
        with engine.begin() as connection:
            connection.execute(
                text("insert into branches (id, code, name) values (:id, 'proof', 'Proof Branch')"),
                {"id": branch_id},
            )
            connection.execute(
                text("insert into staff_users (id, login_identifier) values (:id, 'proof@example.invalid')"),
                {"id": staff_id},
            )
            connection.execute(
                text("insert into products (id, code, name, created_by) values (:id, 'proof', 'Proof Product', :staff)"),
                {"id": product_id, "staff": staff_id},
            )
            connection.execute(
                text("insert into stock_initializations (id, branch_id, product_id, quantity, initialized_by) values (:id, :branch, :product, 7, :staff)"),
                {"id": initialization_id, "branch": branch_id, "product": product_id, "staff": staff_id},
            )

        command.upgrade(config, "head")
        assert _version_width(engine, schema) == 128
        with engine.connect() as connection:
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0016_overtime_shift_close"
            assert connection.execute(
                text("select quantity from stock_initializations where id=:id"), {"id": initialization_id}
            ).scalar_one() == 7
    finally:
        engine.dispose()


def test_postgresql_existing_varchar32_version_table_widens_before_revision_update(postgres_migration_target):
    url, schema = postgres_migration_target
    config = _config()

    command.upgrade(config, "0007_members")
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(32)")
        assert _version_width(engine, schema) == 32

        command.upgrade(config, "head")

        assert _version_width(engine, schema) == 128
        with engine.connect() as connection:
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0016_overtime_shift_close"
            assert "products" in inspect(connection).get_table_names()
    finally:
        engine.dispose()


def test_postgresql_predecessor_upgrade_and_scoped_downgrade_keep_shift_counts(postgres_migration_target):
    url, _schema = postgres_migration_target
    config = _config()
    command.upgrade(config, "0011_shift_opening_counts")
    engine = create_engine(url)
    branch_id, staff_id, register_id, shift_id, count_id = (uuid4() for _ in range(5))
    try:
        with engine.begin() as connection:
            connection.execute(
                text("insert into branches (id, code, name) values (:id, 'proof', 'Proof Branch')"),
                {"id": branch_id},
            )
            connection.execute(
                text("insert into staff_users (id, login_identifier) values (:id, 'proof@example.invalid')"),
                {"id": staff_id},
            )
            connection.execute(
                text("insert into cash_registers (id, branch_id, code, name) values (:id, :branch, 'proof', 'Proof Register')"),
                {"id": register_id, "branch": branch_id},
            )
            connection.execute(
                text("insert into shifts (id, cash_register_id, opened_by, opening_cash_minor) values (:id, :register, :staff, 25500)"),
                {"id": shift_id, "register": register_id, "staff": staff_id},
            )
            connection.execute(
                text("insert into shift_denomination_counts (id, shift_id, denomination_minor, quantity) values (:id, :shift, 500, 3)"),
                {"id": count_id, "shift": shift_id},
            )

        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.execute(text("select opening_cash_minor from shifts where id=:id"), {"id": shift_id}).scalar_one() == 25500
            assert connection.execute(text("select quantity from shift_denomination_counts where id=:id"), {"id": count_id}).scalar_one() == 3

        command.downgrade(config, "0011_shift_opening_counts")
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.execute(text("select opening_cash_minor from shifts where id=:id"), {"id": shift_id}).scalar_one() == 25500
            assert connection.execute(text("select quantity from shift_denomination_counts where id=:id"), {"id": count_id}).scalar_one() == 3
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0016_overtime_shift_close"
    finally:
        engine.dispose()


def test_postgresql_cash_shift_migration_backfills_and_reverses_only_new_fields(postgres_migration_target):
    url, schema = postgres_migration_target
    config = _config()
    command.upgrade(config, "0015_membership_sales")
    engine = create_engine(url)
    branch_id, staff_id, register_id, shift_id, member_id, order_id = (uuid4() for _ in range(6))
    try:
        with engine.begin() as connection:
            connection.execute(
                text("insert into branches (id, code, name) values (:id, 'cash-proof', 'Cash Proof')"),
                {"id": branch_id},
            )
            connection.execute(
                text("insert into staff_users (id, login_identifier) values (:id, 'cash-proof@example.invalid')"),
                {"id": staff_id},
            )
            connection.execute(
                text("insert into members (id, member_number, full_name, phone) values (:id, 'SOC-PG-PROOF', 'PG Proof', '5550101')"),
                {"id": member_id},
            )
            connection.execute(
                text("insert into cash_registers (id, branch_id, code, name) values (:id, :branch, 'cash-proof', 'Cash Proof')"),
                {"id": register_id, "branch": branch_id},
            )
            connection.execute(
                text("insert into shifts (id, cash_register_id, opened_by, opening_cash_minor) values (:id, :register, :staff, 1000)"),
                {"id": shift_id, "register": register_id, "staff": staff_id},
            )
            connection.execute(
                text("insert into orders (id, branch_id, register_id, shift_id, member_id, seller_id, idempotency_key, request_fingerprint, currency, total_minor) values (:id, :branch, :register, :shift, :member, :staff, 'cash-proof', :fingerprint, 'MXN', 9500)"),
                {
                    "id": order_id, "branch": branch_id, "register": register_id, "shift": shift_id,
                    "member": member_id, "staff": staff_id, "fingerprint": "a" * 64,
                },
            )

        command.upgrade(config, "head")
        with engine.connect() as connection:
            migrated = connection.execute(
                text("select financial_shift_id, is_overtime, cash_included_in_opening from orders where id=:id"),
                {"id": order_id},
            ).one()
            assert migrated == (shift_id, False, False)
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == "0016_overtime_shift_close"

        command.downgrade(config, "0015_membership_sales")
        assert "financial_shift_id" not in {column["name"] for column in inspect(engine).get_columns("orders", schema=schema)}
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.execute(
                text("select financial_shift_id from orders where id=:id"), {"id": order_id}
            ).scalar_one() == shift_id
    finally:
        engine.dispose()
