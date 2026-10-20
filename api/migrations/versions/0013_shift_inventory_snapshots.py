"""Persist immutable register-scoped inventory observations.

Revision ID: 0013_inventory_snapshots
Revises: 0012_inventory_foundation
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0013_inventory_snapshots"
down_revision = "0012_inventory_foundation"
branch_labels = None
depends_on = None


def _uuid_type():
    return sa.Uuid(as_uuid=True).with_variant(postgresql.UUID(as_uuid=True), "postgresql")


def upgrade() -> None:
    op.create_table(
        "register_inventory_snapshots",
        sa.Column("id", _uuid_type(), nullable=False),
        sa.Column("register_id", _uuid_type(), nullable=False),
        sa.Column("branch_id", _uuid_type(), nullable=False),
        sa.Column("captured_by", _uuid_type(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("item_count", sa.BigInteger(), nullable=False),
        sa.Column("missing_count", sa.BigInteger(), nullable=False),
        sa.Column("source_state", sa.String(length=32), nullable=False),
        sa.CheckConstraint("item_count >= 0", name="ck_register_inventory_snapshots_item_count"),
        sa.CheckConstraint(
            "missing_count >= 0 AND missing_count <= item_count",
            name="ck_register_inventory_snapshots_missing_count",
        ),
        sa.CheckConstraint(
            "(source_state = 'empty_catalog' AND item_count = 0 AND missing_count = 0) OR "
            "(source_state = 'missing_initializations' AND item_count > 0 AND missing_count > 0) OR "
            "(source_state = 'all_initialized' AND item_count > 0 AND missing_count = 0)",
            name="ck_register_inventory_snapshots_source_state",
        ),
        sa.ForeignKeyConstraint(["register_id"], ["cash_registers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["captured_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_register_inventory_snapshots_register_captured",
        "register_inventory_snapshots",
        ["register_id", "captured_at", "id"],
    )

    op.create_table(
        "register_inventory_snapshot_items",
        sa.Column("id", _uuid_type(), nullable=False),
        sa.Column("snapshot_id", _uuid_type(), nullable=False),
        # Product IDs are copied as opaque identity; no product FK preserves the captured record if catalog policy changes later.
        sa.Column("product_id", _uuid_type(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("unit", sa.String(length=16), nullable=False),
        sa.Column("initialized", sa.Boolean(), nullable=False),
        sa.Column("expected_quantity", sa.BigInteger(), nullable=True),
        sa.Column("initialization_id", _uuid_type(), nullable=True),
        sa.Column("initialized_by", _uuid_type(), nullable=True),
        sa.Column("initialized_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(initialized = false AND expected_quantity IS NULL AND initialization_id IS NULL "
            "AND initialized_by IS NULL AND initialized_at IS NULL) OR "
            "(initialized = true AND expected_quantity IS NOT NULL AND expected_quantity >= 0 AND initialization_id IS NOT NULL "
            "AND initialized_by IS NOT NULL AND initialized_at IS NOT NULL)",
            name="ck_register_inventory_snapshot_items_initialization_state",
        ),
        sa.ForeignKeyConstraint(["snapshot_id"], ["register_inventory_snapshots.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("snapshot_id", "product_id", name="uq_register_inventory_snapshot_items_product"),
    )


def downgrade() -> None:
    op.drop_table("register_inventory_snapshot_items")
    op.drop_index(
        "ix_register_inventory_snapshots_register_captured",
        table_name="register_inventory_snapshots",
    )
    op.drop_table("register_inventory_snapshots")
