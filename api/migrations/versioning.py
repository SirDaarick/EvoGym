"""Keep Alembic's version table wide enough for published revision IDs."""

from sqlalchemy import String, inspect


VERSION_TABLE_WIDTH = 128


def prepare_version_table(context, *, offline: bool) -> None:
    """Set a supported revision width before Alembic creates or updates its table.

    Alembic 1.14+ exposes ``DefaultImpl.version_table_impl`` as a dialect
    extension hook, but ``EnvironmentContext.configure`` does not accept a
    version-column type. Widen its generated version-table column model here;
    for PostgreSQL, also widen an already-created table before any revision
    update. Existing values are preserved by PostgreSQL's type widening.
    """
    migration_context = context.get_context()
    version_table = migration_context.version_table
    version_schema = migration_context.version_table_schema

    # Alembic's generated version table otherwise uses VARCHAR(32), which is
    # too narrow for existing published revisions in this repository.
    migration_context._version.c.version_num.type = String(VERSION_TABLE_WIDTH)

    if migration_context.dialect.name != "postgresql":
        return

    preparer = migration_context.dialect.identifier_preparer
    table_name = preparer.quote(version_table)
    if version_schema is not None:
        table_name = f"{preparer.quote_schema(version_schema)}.{table_name}"
    column_name = preparer.quote("version_num")
    alter_sql = (
        f"ALTER TABLE {table_name} ALTER COLUMN {column_name} "
        f"TYPE VARCHAR({VERSION_TABLE_WIDTH})"
    )

    if offline:
        # IF EXISTS makes the preamble safe both for an empty database (where
        # Alembic creates the table immediately afterward) and for an upgrade.
        context.execute(alter_sql.replace("ALTER TABLE ", "ALTER TABLE IF EXISTS ", 1))
        return

    connection = migration_context.connection
    if connection is None:
        raise RuntimeError("Online Alembic migration has no database connection.")

    inspector = inspect(connection)
    if not inspector.has_table(version_table, schema=version_schema):
        return

    version_column = next(
        column
        for column in inspector.get_columns(version_table, schema=version_schema)
        if column["name"] == "version_num"
    )
    current_width = getattr(version_column["type"], "length", None)
    if current_width is not None and current_width < VERSION_TABLE_WIDTH:
        connection.exec_driver_sql(alter_sql)
        # Alembic starts its migration transaction after env.py configuration.
        # Commit only this non-destructive compatibility change before that.
        connection.commit()
