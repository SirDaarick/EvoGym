"""Add roster schedules, immutable entry snapshots, and checkout events."""
from alembic import op
import sqlalchemy as sa

revision = "0023_staff_sched_checkout"
down_revision = "0022_staff_attendance"
branch_labels = None
depends_on = None


def _append_only(table: str, name: str) -> None:
    connection = op.get_bind()
    if connection.dialect.name == "sqlite":
        op.execute(f"CREATE TRIGGER trg_{name}_no_update BEFORE UPDATE ON {table} BEGIN SELECT RAISE(ABORT, '{table} are append-only'); END")
        op.execute(f"CREATE TRIGGER trg_{name}_no_delete BEFORE DELETE ON {table} BEGIN SELECT RAISE(ABORT, '{table} are append-only'); END")
    elif connection.dialect.name == "postgresql":
        op.execute(f"CREATE FUNCTION reject_{name}_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '{table} are append-only'; END; $$ LANGUAGE plpgsql")
        op.execute(f"CREATE TRIGGER trg_{name}_no_update_delete BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION reject_{name}_mutation()")
    else:
        raise RuntimeError("Staff attendance append-only guards require SQLite or PostgreSQL.")


def upgrade() -> None:
    with op.batch_alter_table("staff_roster_profiles") as batch:
        batch.add_column(sa.Column("expected_entry_time", sa.Time(), nullable=True))
        batch.add_column(sa.Column("grace_tolerance_minutes", sa.Integer(), nullable=True))
        batch.create_check_constraint("ck_staff_roster_schedule_complete", "(expected_entry_time IS NULL) = (grace_tolerance_minutes IS NULL)")
        batch.create_check_constraint("ck_staff_roster_tolerance_range", "grace_tolerance_minutes IS NULL OR grace_tolerance_minutes BETWEEN 0 AND 1440")
    with op.batch_alter_table("staff_attendance_records") as batch:
        batch.add_column(sa.Column("status", sa.String(16), nullable=True))
        batch.add_column(sa.Column("expected_entry_time", sa.Time(), nullable=True))
        batch.add_column(sa.Column("grace_tolerance_minutes", sa.Integer(), nullable=True))
        batch.create_check_constraint("ck_staff_attendance_status", "status IS NULL OR status IN ('present', 'late')")
    if op.get_bind().dialect.name == "sqlite":
        op.execute("CREATE TRIGGER trg_staff_attendance_no_update BEFORE UPDATE ON staff_attendance_records BEGIN SELECT RAISE(ABORT, 'staff attendance records are append-only'); END")
        op.execute("CREATE TRIGGER trg_staff_attendance_no_delete BEFORE DELETE ON staff_attendance_records BEGIN SELECT RAISE(ABORT, 'staff attendance records are append-only'); END")
    op.create_table(
        "staff_attendance_checkouts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("attendance_id", sa.Uuid(), nullable=False),
        sa.Column("recorded_by", sa.Uuid(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["attendance_id"], ["staff_attendance_records.id"], name="fk_staff_checkout_entry", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["recorded_by"], ["staff_users.id"], name="fk_staff_checkout_recorder", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("attendance_id", name="uq_staff_attendance_checkout_entry"),
    )
    _append_only("staff_attendance_checkouts", "staff_checkout")


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT count(*) FROM staff_attendance_checkouts")).scalar_one():
        raise RuntimeError("Cannot downgrade while staff attendance checkouts exist.")
    if connection.execute(sa.text(
        "SELECT count(*) FROM staff_attendance_records "
        "WHERE status IS NOT NULL OR expected_entry_time IS NOT NULL OR grace_tolerance_minutes IS NOT NULL"
    )).scalar_one():
        raise RuntimeError("Cannot downgrade while staff attendance records contain schedule snapshots.")
    if connection.dialect.name == "sqlite":
        op.execute("DROP TRIGGER trg_staff_checkout_no_delete")
        op.execute("DROP TRIGGER trg_staff_checkout_no_update")
    else:
        op.execute("DROP TRIGGER trg_staff_checkout_no_update_delete ON staff_attendance_checkouts")
        op.execute("DROP FUNCTION reject_staff_checkout_mutation()")
    op.drop_table("staff_attendance_checkouts")
    with op.batch_alter_table("staff_attendance_records") as batch:
        batch.drop_constraint("ck_staff_attendance_status", type_="check")
        batch.drop_column("grace_tolerance_minutes")
        batch.drop_column("expected_entry_time")
        batch.drop_column("status")
    if op.get_bind().dialect.name == "sqlite":
        op.execute("CREATE TRIGGER trg_staff_attendance_no_update BEFORE UPDATE ON staff_attendance_records BEGIN SELECT RAISE(ABORT, 'staff attendance records are append-only'); END")
        op.execute("CREATE TRIGGER trg_staff_attendance_no_delete BEFORE DELETE ON staff_attendance_records BEGIN SELECT RAISE(ABORT, 'staff attendance records are append-only'); END")
    with op.batch_alter_table("staff_roster_profiles") as batch:
        batch.drop_constraint("ck_staff_roster_tolerance_range", type_="check")
        batch.drop_constraint("ck_staff_roster_schedule_complete", type_="check")
        batch.drop_column("grace_tolerance_minutes")
        batch.drop_column("expected_entry_time")
    if op.get_bind().dialect.name == "sqlite":
        op.execute("CREATE UNIQUE INDEX uq_staff_roster_branch_name ON staff_roster_profiles (branch_id, lower(full_name))")
