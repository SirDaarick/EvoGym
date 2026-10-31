"""Record compensating product line refunds and update stock movement constraints."""
from alembic import op
import sqlalchemy as sa

revision = "0045_product_refunds"
down_revision = "0044_product_sale_resolutions"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "product_refunds",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("order_item_id", sa.Uuid(), sa.ForeignKey("order_items.id", ondelete="RESTRICT"), nullable=False, unique=True),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("register_id", sa.Uuid(), sa.ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("shift_id", sa.Uuid(), sa.ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("financial_shift_id", sa.Uuid(), sa.ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("reason", sa.String(240), nullable=False),
        sa.Column("disposition", sa.String(16), nullable=False),
        sa.Column("payout_method", sa.String(16), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.BigInteger(), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("length(trim(reason)) > 0", name="ck_product_refunds_reason_nonempty"),
        sa.CheckConstraint("disposition IN ('restock', 'waste')", name="ck_product_refunds_disposition"),
        sa.CheckConstraint("payout_method IN ('cash', 'card')", name="ck_product_refunds_payout_method"),
        sa.CheckConstraint("amount_minor > 0", name="ck_product_refunds_amount_positive"),
        sa.CheckConstraint("quantity > 0", name="ck_product_refunds_quantity_positive"),
        sa.CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_product_refunds_idempotency_key_length"),
        sa.CheckConstraint("length(request_fingerprint) = 64", name="ck_product_refunds_fingerprint_length"),
        sa.UniqueConstraint("actor_id", "branch_id", "idempotency_key", name="uq_product_refunds_actor_branch_idempotency"),
    )

    with op.batch_alter_table("stock_movements") as batch:
        batch.drop_constraint("ck_stock_movements_sale_link", type_="check")
        batch.drop_constraint("ck_stock_movements_kind", type_="check")
        batch.create_check_constraint("ck_stock_movements_kind", "kind IN ('restock', 'waste', 'sale', 'return')")
        batch.create_check_constraint(
            "ck_stock_movements_sale_link",
            "(kind = 'sale' AND order_item_id IS NOT NULL) OR (kind IN ('restock', 'waste', 'return') AND order_item_id IS NULL)",
        )


def downgrade():
    connection = op.get_bind()
    if (connection.execute(sa.text("SELECT 1 FROM product_refunds LIMIT 1")).first()
            or connection.execute(sa.text("SELECT 1 FROM stock_movements WHERE kind = 'return' LIMIT 1")).first()):
        raise RuntimeError("Cannot remove product refund records.")

    with op.batch_alter_table("stock_movements") as batch:
        batch.drop_constraint("ck_stock_movements_sale_link", type_="check")
        batch.drop_constraint("ck_stock_movements_kind", type_="check")
        batch.create_check_constraint("ck_stock_movements_kind", "kind IN ('restock', 'waste', 'sale')")
        batch.create_check_constraint(
            "ck_stock_movements_sale_link",
            "(kind = 'sale' AND order_item_id IS NOT NULL) OR (kind IN ('restock', 'waste') AND order_item_id IS NULL)",
        )

    op.drop_table("product_refunds")
