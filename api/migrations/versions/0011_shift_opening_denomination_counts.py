"""Retain physical bill and coin counts on shift opening.

Revision ID: 0011_shift_opening_counts
Revises: 0010_registers_terminals_and_shifts
"""
from alembic import op
import sqlalchemy as sa

revision = "0011_shift_opening_counts"
down_revision = "0010_registers_terminals_and_shifts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shift_denomination_counts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("shift_id", sa.Uuid(), nullable=False),
        sa.Column("denomination_minor", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("denomination_minor > 0", name="ck_shift_denomination_counts_denomination_positive"),
        sa.CheckConstraint("quantity >= 0", name="ck_shift_denomination_counts_quantity_nonnegative"),
        sa.ForeignKeyConstraint(["shift_id"], ["shifts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("shift_id", "denomination_minor", name="uq_shift_denomination_counts_shift_denomination"),
    )


def downgrade() -> None:
    op.drop_table("shift_denomination_counts")
