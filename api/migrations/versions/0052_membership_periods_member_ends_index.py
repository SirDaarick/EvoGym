"""Index membership periods by member_id and ends_on for status aggregation."""
from alembic import op

revision = "0052_membership_periods_member_ends_index"
down_revision = "0051_member_history_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_membership_periods_member_ends_on",
        "membership_periods",
        ["member_id", "ends_on"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_membership_periods_member_ends_on",
        table_name="membership_periods",
    )
