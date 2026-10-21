"""Add branch-scoped staff roster independent of authentication accounts."""
from alembic import op
import sqlalchemy as sa


revision = "0021_staff_roster"
down_revision = "0020_membership_debt_payments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "staff_roster_profiles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("full_name", sa.String(length=160), nullable=False),
        sa.Column("position", sa.String(length=80), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("length(full_name) > 0 AND full_name = trim(full_name)", name="ck_staff_roster_full_name"),
        sa.CheckConstraint("length(position) > 0 AND position = trim(position)", name="ck_staff_roster_position"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_staff_roster_branch_name", "staff_roster_profiles", ["branch_id", sa.text("lower(full_name)")], unique=True)
    op.create_index("ix_staff_roster_branch_active_name", "staff_roster_profiles", ["branch_id", "is_active", "full_name"])


def downgrade() -> None:
    connection = op.get_bind()
    count = connection.execute(sa.text("SELECT count(*) FROM staff_roster_profiles")).scalar_one()
    if count:
        raise RuntimeError("Cannot downgrade while staff roster profiles exist.")
    op.drop_index("ix_staff_roster_branch_active_name", table_name="staff_roster_profiles")
    op.drop_index("uq_staff_roster_branch_name", table_name="staff_roster_profiles")
    op.drop_table("staff_roster_profiles")
