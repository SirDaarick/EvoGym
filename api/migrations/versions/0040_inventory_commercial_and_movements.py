"""Inventory commercial metadata and stock movement ledger."""
from alembic import op
import sqlalchemy as sa

revision = "0040_inv_commercial_and_movements"
down_revision = "0039_shift_inv_obs_reason"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Commercial metadata on products
    op.add_column(
        "products",
        sa.Column("category", sa.String(length=64), nullable=False, server_default="General"),
    )
    op.add_column(
        "products",
        sa.Column("price_minor", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.add_column(
        "products",
        sa.Column("cost_minor", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.add_column(
        "products",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )

    # 2. Append-only stock movements ledger
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("product_id", sa.Uuid(), sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("quantity", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.String(length=240), nullable=True),
        sa.Column("recorded_by", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('restock', 'waste')", name="ck_stock_movements_kind"),
        sa.CheckConstraint("quantity > 0", name="ck_stock_movements_quantity_positive"),
        sa.CheckConstraint(
            "kind != 'waste' OR (reason IS NOT NULL AND length(trim(reason)) > 0)",
            name="ck_stock_movements_waste_reason",
        ),
        sa.UniqueConstraint("branch_id", "idempotency_key", name="uq_stock_movements_branch_idempotency"),
    )


def downgrade() -> None:
    op.drop_table("stock_movements")
    op.drop_column("products", "is_active")
    op.drop_column("products", "cost_minor")
    op.drop_column("products", "price_minor")
    op.drop_column("products", "category")
