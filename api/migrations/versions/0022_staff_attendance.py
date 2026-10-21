"""Add immutable branch-scoped staff attendance marks."""
from alembic import op
import sqlalchemy as sa


revision = "0022_staff_attendance"
down_revision = "0021_staff_roster"
branch_labels = None
depends_on = None



def upgrade() -> None:
    op.create_index("uq_staff_roster_id_branch", "staff_roster_profiles", ["id", "branch_id"], unique=True)
    op.create_table(
        "staff_attendance_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("recorded_by", sa.Uuid(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("business_date", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], name="fk_staff_attendance_branch", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["profile_id", "branch_id"], ["staff_roster_profiles.id", "staff_roster_profiles.branch_id"],
                                name="fk_staff_attendance_profile_branch", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["recorded_by"], ["staff_users.id"], name="fk_staff_attendance_recorder", ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "profile_id", "business_date", name="uq_staff_attendance_branch_profile_date"),
    )
    op.create_index("ix_staff_attendance_branch_date", "staff_attendance_records", ["branch_id", "business_date", "occurred_at"])
    connection = op.get_bind()
    if connection.dialect.name == "sqlite":
        op.execute("""
            CREATE TRIGGER trg_staff_attendance_no_update
            BEFORE UPDATE ON staff_attendance_records
            BEGIN SELECT RAISE(ABORT, 'staff attendance records are append-only'); END
        """)
        op.execute("""
            CREATE TRIGGER trg_staff_attendance_no_delete
            BEFORE DELETE ON staff_attendance_records
            BEGIN SELECT RAISE(ABORT, 'staff attendance records are append-only'); END
        """)
    elif connection.dialect.name == "postgresql":
        op.execute("""
            CREATE FUNCTION reject_staff_attendance_mutation() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'staff attendance records are append-only';
            END;
            $$ LANGUAGE plpgsql
        """)
        op.execute("""
            CREATE TRIGGER trg_staff_attendance_no_update_delete
            BEFORE UPDATE OR DELETE ON staff_attendance_records
            FOR EACH ROW EXECUTE FUNCTION reject_staff_attendance_mutation()
        """)
    else:
        raise RuntimeError("Staff attendance append-only guards require SQLite or PostgreSQL.")


def downgrade() -> None:
    connection = op.get_bind()
    count = connection.execute(sa.text("SELECT count(*) FROM staff_attendance_records")).scalar_one()
    if count:
        raise RuntimeError("Cannot downgrade while staff attendance records exist.")
    if connection.dialect.name == "sqlite":
        op.execute("DROP TRIGGER trg_staff_attendance_no_delete")
        op.execute("DROP TRIGGER trg_staff_attendance_no_update")
    elif connection.dialect.name == "postgresql":
        op.execute("DROP TRIGGER trg_staff_attendance_no_update_delete ON staff_attendance_records")
        op.execute("DROP FUNCTION reject_staff_attendance_mutation()")
    op.drop_index("ix_staff_attendance_branch_date", table_name="staff_attendance_records")
    op.drop_table("staff_attendance_records")
    op.drop_index("uq_staff_roster_id_branch", table_name="staff_roster_profiles")
