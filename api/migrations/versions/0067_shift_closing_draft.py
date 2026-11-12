"""Add closing_draft JSON column to shifts for progressive cash-cut persistence."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0067_shift_closing_draft"
down_revision: str | Sequence[str] | None = "0066_inventory_purchases"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("shifts", sa.Column("closing_draft", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("shifts", "closing_draft")
