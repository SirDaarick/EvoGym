"""Add occurrence-linked staff attendance, clock integrity, and corrections."""
from alembic import op
import sqlalchemy as sa

revision = "0038_staff_occurrence_attendance"
down_revision = "0037_paired_profile_access"
branch_labels = None
depends_on = None


def _append_only(table: str, name: str) -> None:
    connection = op.get_bind()
    if connection.dialect.name == "sqlite":
        op.execute(
            f"CREATE TRIGGER trg_{name}_no_update BEFORE UPDATE ON {table} BEGIN SELECT RAISE(ABORT, '{table} are append-only'); END"
        )
        op.execute(
            f"CREATE TRIGGER trg_{name}_no_delete BEFORE DELETE ON {table} BEGIN SELECT RAISE(ABORT, '{table} are append-only'); END"
        )
    elif connection.dialect.name == "postgresql":
        op.execute(
            f"CREATE FUNCTION reject_{name}_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '{table} are append-only'; END; $$ LANGUAGE plpgsql"
        )
        op.execute(
            f"CREATE TRIGGER trg_{name}_no_update_delete BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION reject_{name}_mutation()"
        )
    else:
        raise RuntimeError(f"{table} append-only guards require SQLite or PostgreSQL.")


def upgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "sqlite":
        op.execute("DROP TRIGGER IF EXISTS trg_staff_attendance_no_update")
        op.execute("DROP TRIGGER IF EXISTS trg_staff_attendance_no_delete")
    elif connection.dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS trg_staff_attendance_no_update_delete ON staff_attendance_records")

    with op.batch_alter_table("staff_attendance_records") as batch:
        batch.drop_constraint("uq_staff_attendance_branch_profile_date", type_="unique")
        batch.add_column(sa.Column("series_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("occurrence_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("device_captured_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(
            sa.Column("server_received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
        )
        batch.add_column(sa.Column("idempotency_key", sa.String(64), nullable=True))
        batch.add_column(sa.Column("scheduled_start_time", sa.Time(), nullable=True))
        batch.add_column(sa.Column("scheduled_end_time", sa.Time(), nullable=True))
        batch.add_column(sa.Column("clock_skew_seconds", sa.Integer(), nullable=True))
        batch.add_column(
            sa.Column("clock_validation_status", sa.String(32), server_default="trusted", nullable=False)
        )
        batch.add_column(sa.Column("review_required", sa.Boolean(), server_default=sa.text("false"), nullable=False))
        batch.add_column(sa.Column("schedule_conflict", sa.Boolean(), server_default=sa.text("false"), nullable=False))
        batch.create_foreign_key(
            "fk_staff_attendance_series", "staff_schedule_series", ["series_id"], ["id"], ondelete="RESTRICT"
        )
        batch.create_unique_constraint(
            "uq_staff_attendance_series_occurrence", ["branch_id", "profile_id", "series_id", "occurrence_date"]
        )
        batch.create_unique_constraint("uq_staff_attendance_idempotency", ["branch_id", "idempotency_key"])

    op.create_index(
        "ix_staff_attendance_branch_occurrence",
        "staff_attendance_records",
        ["branch_id", "occurrence_date", "profile_id"],
    )
    op.create_index(
        "ix_staff_attendance_records_idempotency_key", "staff_attendance_records", ["idempotency_key"]
    )
    _append_only("staff_attendance_records", "staff_attendance")

    op.create_table(
        "staff_attendance_corrections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("attendance_id", sa.Uuid(), nullable=False),
        sa.Column("corrected_by", sa.Uuid(), nullable=False),
        sa.Column("field_name", sa.String(32), nullable=False),
        sa.Column("original_value", sa.String(255), nullable=False),
        sa.Column("corrected_value", sa.String(255), nullable=False),
        sa.Column("reason", sa.String(255), nullable=False),
        sa.Column("corrected_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["attendance_id"],
            ["staff_attendance_records.id"],
            name="fk_staff_correction_attendance",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["corrected_by"], ["staff_users.id"], name="fk_staff_correction_recorder", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_staff_attendance_corrections_attendance_id", "staff_attendance_corrections", ["attendance_id"]
    )
    _append_only("staff_attendance_corrections", "staff_correction")


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT count(*) FROM staff_attendance_corrections")).scalar_one():
        raise RuntimeError("Cannot downgrade while staff attendance corrections exist.")
    if connection.execute(
        sa.text(
            "SELECT count(*) FROM staff_attendance_records "
            "WHERE series_id IS NOT NULL OR occurrence_date IS NOT NULL OR device_captured_at IS NOT NULL "
            "OR idempotency_key IS NOT NULL OR clock_skew_seconds IS NOT NULL OR review_required = 1 OR schedule_conflict = 1"
        )
    ).scalar_one():
        raise RuntimeError("Cannot downgrade while staff attendance records contain occurrence-linked data.")

    op.drop_index("ix_staff_attendance_corrections_attendance_id", table_name="staff_attendance_corrections")
    if connection.dialect.name == "sqlite":
        op.execute("DROP TRIGGER trg_staff_correction_no_delete")
        op.execute("DROP TRIGGER trg_staff_correction_no_update")
    elif connection.dialect.name == "postgresql":
        op.execute("DROP TRIGGER trg_staff_correction_no_update_delete ON staff_attendance_corrections")
        op.execute("DROP FUNCTION reject_staff_correction_mutation()")
    op.drop_table("staff_attendance_corrections")

    op.drop_index("ix_staff_attendance_records_idempotency_key", table_name="staff_attendance_records")
    op.drop_index("ix_staff_attendance_branch_occurrence", table_name="staff_attendance_records")

    if connection.dialect.name == "sqlite":
        op.execute("DROP TRIGGER trg_staff_attendance_no_update")
        op.execute("DROP TRIGGER trg_staff_attendance_no_delete")
    elif connection.dialect.name == "postgresql":
        op.execute("DROP TRIGGER trg_staff_attendance_no_update_delete ON staff_attendance_records")

    with op.batch_alter_table("staff_attendance_records") as batch:
        batch.drop_constraint("uq_staff_attendance_idempotency", type_="unique")
        batch.drop_constraint("uq_staff_attendance_series_occurrence", type_="unique")
        batch.drop_constraint("fk_staff_attendance_series", type_="foreignkey")
        batch.drop_column("schedule_conflict")
        batch.drop_column("review_required")
        batch.drop_column("clock_validation_status")
        batch.drop_column("clock_skew_seconds")
        batch.drop_column("scheduled_end_time")
        batch.drop_column("scheduled_start_time")
        batch.drop_column("idempotency_key")
        batch.drop_column("server_received_at")
        batch.drop_column("device_captured_at")
        batch.drop_column("occurrence_date")
        batch.drop_column("series_id")
        batch.create_unique_constraint(
            "uq_staff_attendance_branch_profile_date", ["branch_id", "profile_id", "business_date"]
        )

    _append_only("staff_attendance_records", "staff_attendance")
