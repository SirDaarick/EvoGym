from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool

from app.db.engine import create_engine_from_settings
from app.db.base import Base
from app.db import models as _models
from app.settings import get_settings
from migrations.versioning import prepare_version_table


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    database_url = get_settings().require_database_url()
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    prepare_version_table(context, offline=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine_from_settings(get_settings(), poolclass=pool.NullPool)
    try:
        with engine.connect() as connection:
            context.configure(connection=connection, target_metadata=target_metadata)
            prepare_version_table(context, offline=False)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
