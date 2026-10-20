"""Bind opening inventory acceptance to the newly opened shift.

Revision ID: 0014_opening_inventory_reviews
Revises: 0013_inventory_snapshots
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0014_opening_inventory_reviews"
down_revision = "0013_inventory_snapshots"
branch_labels = None
depends_on = None


def _uuid_type():
    return sa.Uuid(as_uuid=True).with_variant(postgresql.UUID(as_uuid=True), "postgresql")


def upgrade() -> None:
    op.create_table(
        "shift_inventory_reviews",
        sa.Column("id", _uuid_type(), nullable=False),
        sa.Column("shift_id", _uuid_type(), nullable=False),
        sa.Column("snapshot_id", _uuid_type(), nullable=False),
        sa.Column("confirmed_by", _uuid_type(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("mode", sa.String(length=32), nullable=False),
        sa.CheckConstraint("mode IN ('no_changes_declared', 'physical_counts_reported')", name="ck_shift_inventory_reviews_mode"),
        sa.ForeignKeyConstraint(["shift_id"], ["shifts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["snapshot_id"], ["register_inventory_snapshots.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["confirmed_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("shift_id", name="uq_shift_inventory_reviews_shift"),
        sa.UniqueConstraint("snapshot_id", name="uq_shift_inventory_reviews_snapshot"),
    )
    op.create_table(
        "shift_inventory_observations",
        sa.Column("id", _uuid_type(), nullable=False),
        sa.Column("review_id", _uuid_type(), nullable=False),
        sa.Column("snapshot_item_id", _uuid_type(), nullable=False),
        sa.Column("physical_quantity", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("physical_quantity IS NOT NULL AND physical_quantity >= 0", name="ck_shift_inventory_observations_quantity_nonnegative"),
        sa.ForeignKeyConstraint(["review_id"], ["shift_inventory_reviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["snapshot_item_id"], ["register_inventory_snapshot_items.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("review_id", "snapshot_item_id", name="uq_shift_inventory_observations_item"),
    )


def downgrade() -> None:
    op.drop_table("shift_inventory_observations")
    op.drop_table("shift_inventory_reviews")
