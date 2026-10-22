"""Add weekly staff schedule series and occurrence exceptions."""
from alembic import op
import sqlalchemy as sa

revision = "0030_staff_schedules"
down_revision = "0029_class_sample_check_ins"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "staff_schedule_series",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("weekdays", sa.JSON(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("occurrence_count", sa.Integer(), nullable=True),
        sa.Column("cancelled_from", sa.Date(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("timezone_rules_digest", sa.String(length=64), server_default="unknown", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("json_array_length(weekdays) > 0", name="ck_staff_schedule_weekdays_present"),
        sa.CheckConstraint("(end_date IS NULL) OR end_date >= start_date", name="ck_staff_schedule_date_order"),
        sa.CheckConstraint("(occurrence_count IS NULL) OR occurrence_count > 0", name="ck_staff_schedule_count_positive"),
        sa.CheckConstraint("NOT (end_date IS NOT NULL AND occurrence_count IS NOT NULL)", name="ck_staff_schedule_one_termination"),
        sa.ForeignKeyConstraint(["profile_id", "branch_id"], ["staff_roster_profiles.id", "staff_roster_profiles.branch_id"],
                                name="fk_staff_schedule_profile_branch", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_staff_schedule_profile_branch", "staff_schedule_series", ["profile_id", "branch_id", "start_date"])
    op.create_index("ix_staff_schedule_branch_dates", "staff_schedule_series", ["branch_id", "start_date", "end_date"])
    op.create_table(
        "staff_schedule_exceptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("series_id", sa.Uuid(), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("original_start_time", sa.Time(), nullable=False),
        sa.Column("original_end_time", sa.Time(), nullable=False),
        sa.Column("override_start_time", sa.Time(), nullable=True),
        sa.Column("override_end_time", sa.Time(), nullable=True),
        sa.Column("recorded_by", sa.Uuid(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("action IN ('skip', 'override')", name="ck_staff_schedule_exception_action"),
        sa.CheckConstraint("(action = 'skip') OR (override_start_time IS NOT NULL AND override_end_time IS NOT NULL)",
                           name="ck_staff_schedule_exception_override_times"),
        sa.ForeignKeyConstraint(["series_id"], ["staff_schedule_series.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["recorded_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("series_id", "local_date", name="uq_staff_schedule_exception_occurrence"),
    )
    op.create_index("ix_staff_schedule_exception_series_date", "staff_schedule_exceptions", ["series_id", "local_date"])


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("select count(*) from staff_schedule_exceptions")).scalar_one():
        raise RuntimeError("staff schedule exceptions contain retained edits")
    if connection.execute(sa.text("select count(*) from staff_schedule_series")).scalar_one():
        raise RuntimeError("staff schedule series contain schedule history")
    op.drop_index("ix_staff_schedule_exception_series_date", table_name="staff_schedule_exceptions")
    op.drop_table("staff_schedule_exceptions")
    op.drop_index("ix_staff_schedule_branch_dates", table_name="staff_schedule_series")
    op.drop_index("ix_staff_schedule_profile_branch", table_name="staff_schedule_series")
    op.drop_table("staff_schedule_series")
