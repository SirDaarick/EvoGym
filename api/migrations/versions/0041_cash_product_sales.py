"""Add canonical cash product order lines and stock movements."""
from alembic import op
import sqlalchemy as sa

revision = "0041_cash_product_sales"
down_revision = "0040_inv_commercial_and_movements"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("orders") as batch:
        batch.add_column(sa.Column("order_kind", sa.String(24), nullable=False, server_default="membership"))
        batch.alter_column("member_id", existing_type=sa.Uuid(), nullable=True)
        batch.create_check_constraint("ck_orders_kind_member", "(order_kind = 'membership' AND member_id IS NOT NULL) OR order_kind = 'product'")
    with op.batch_alter_table("order_items") as batch:
        for name in ("ck_order_items_membership_kind", "ck_order_items_quantity_one", "ck_order_items_amounts_nonnegative", "ck_order_items_duration", "ck_order_items_entitlement_mode"):
            batch.drop_constraint(name, type_="check")
        batch.add_column(sa.Column("product_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key("fk_order_items_product_id_products", "products", ["product_id"], ["id"], ondelete="RESTRICT")
        batch.alter_column("plan_version_id", existing_type=sa.Uuid(), nullable=True)
        batch.alter_column("entitlement_mode", existing_type=sa.String(24), nullable=True)
        batch.create_check_constraint("ck_order_items_kind_fields", "(item_kind = 'membership' AND plan_version_id IS NOT NULL AND product_id IS NULL AND quantity = 1 AND entitlement_mode IS NOT NULL) OR (item_kind = 'product' AND product_id IS NOT NULL AND plan_version_id IS NULL AND quantity > 0 AND entitlement_mode IS NULL AND duration_value IS NULL AND duration_unit IS NULL)")
        # The predecessor allowed unequal membership snapshots; preserve existing rows.
        batch.create_check_constraint("ck_order_items_amounts_match", "unit_amount_minor >= 0 AND line_total_minor >= 0 AND (item_kind = 'membership' OR line_total_minor = unit_amount_minor * quantity)")
        batch.create_check_constraint("ck_order_items_duration", "item_kind = 'product' OR (entitlement_mode = 'period' AND duration_value IS NOT NULL AND duration_value > 0 AND duration_unit IS NOT NULL AND duration_unit IN ('day', 'month', 'year')) OR (entitlement_mode = 'single_entry' AND duration_value IS NULL AND duration_unit IS NULL)")
        batch.create_check_constraint("ck_order_items_entitlement_mode", "item_kind = 'product' OR entitlement_mode IN ('period', 'single_entry')")
    with op.batch_alter_table("stock_movements") as batch:
        batch.drop_constraint("ck_stock_movements_kind", type_="check")
        batch.add_column(sa.Column("order_item_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key("fk_stock_movements_order_item_id", "order_items", ["order_item_id"], ["id"], ondelete="RESTRICT")
        batch.create_unique_constraint("uq_stock_movements_order_item_id", ["order_item_id"])
        batch.create_check_constraint("ck_stock_movements_kind", "kind IN ('restock', 'waste', 'sale')")
        batch.create_check_constraint("ck_stock_movements_sale_link", "(kind = 'sale' AND order_item_id IS NOT NULL) OR (kind IN ('restock', 'waste') AND order_item_id IS NULL)")


def downgrade():
    connection = op.get_bind()
    if (connection.execute(sa.text("SELECT 1 FROM orders WHERE order_kind = 'product' LIMIT 1")).first()
            or connection.execute(sa.text("SELECT 1 FROM stock_movements WHERE kind = 'sale' LIMIT 1")).first()):
        raise RuntimeError("Cash product sales cannot be downgraded without losing product transactions.")
    with op.batch_alter_table("stock_movements") as batch:
        batch.drop_constraint("ck_stock_movements_sale_link", type_="check")
        batch.drop_constraint("ck_stock_movements_kind", type_="check")
        batch.drop_constraint("uq_stock_movements_order_item_id", type_="unique")
        batch.drop_constraint("fk_stock_movements_order_item_id", type_="foreignkey")
        batch.drop_column("order_item_id")
        batch.create_check_constraint("ck_stock_movements_kind", "kind IN ('restock', 'waste')")
    with op.batch_alter_table("order_items") as batch:
        for name in ("ck_order_items_kind_fields", "ck_order_items_amounts_match", "ck_order_items_duration", "ck_order_items_entitlement_mode"):
            batch.drop_constraint(name, type_="check")
        batch.drop_constraint("fk_order_items_product_id_products", type_="foreignkey")
        batch.drop_column("product_id")
        batch.alter_column("plan_version_id", existing_type=sa.Uuid(), nullable=False)
        batch.alter_column("entitlement_mode", existing_type=sa.String(24), nullable=False)
        batch.create_check_constraint("ck_order_items_membership_kind", "item_kind = 'membership'")
        batch.create_check_constraint("ck_order_items_quantity_one", "quantity = 1")
        batch.create_check_constraint("ck_order_items_amounts_nonnegative", "unit_amount_minor >= 0 AND line_total_minor >= 0")
        batch.create_check_constraint("ck_order_items_duration", "(entitlement_mode = 'period' AND duration_value IS NOT NULL AND duration_value > 0 AND duration_unit IS NOT NULL AND duration_unit IN ('day', 'month', 'year')) OR (entitlement_mode = 'single_entry' AND duration_value IS NULL AND duration_unit IS NULL)")
        batch.create_check_constraint("ck_order_items_entitlement_mode", "entitlement_mode IN ('period', 'single_entry')")
    with op.batch_alter_table("orders") as batch:
        batch.drop_constraint("ck_orders_kind_member", type_="check")
        batch.alter_column("member_id", existing_type=sa.Uuid(), nullable=False)
        batch.drop_column("order_kind")
