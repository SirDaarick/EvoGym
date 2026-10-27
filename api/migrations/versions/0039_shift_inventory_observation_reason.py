"""Persist reasons for opening inventory discrepancies."""
from alembic import op
import sqlalchemy as sa


revision = "0039_shift_inv_obs_reason"
down_revision = "0038_staff_occurrence_attendance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shift_inventory_observations",
        sa.Column("reason", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("shift_inventory_observations", "reason")
