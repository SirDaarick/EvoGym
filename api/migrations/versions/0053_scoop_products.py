"""Allow scoop products with a configured container size."""
from alembic import op
import sqlalchemy as sa

revision = "0053_scoop_products"
down_revision = "0052_membership_periods_member_ends_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("products") as batch:
        batch.add_column(sa.Column("servings_per_container", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("container_product_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key("fk_products_container_product_id", "products", ["container_product_id"], ["id"], ondelete="RESTRICT")
        batch.drop_constraint("ck_products_unit_piece", type_="check")
        batch.create_check_constraint("ck_products_unit_servings", "(unit = 'piece' AND servings_per_container IS NULL) OR (unit = 'scoop' AND servings_per_container IS NOT NULL AND servings_per_container > 0)")
    with op.batch_alter_table("stock_movements") as batch:
        batch.drop_constraint("ck_stock_movements_kind", type_="check")
        batch.drop_constraint("ck_stock_movements_sale_link", type_="check")
        batch.create_check_constraint("ck_stock_movements_kind", "kind IN ('restock', 'waste', 'sale', 'return', 'open_in', 'open_out')")
        batch.create_check_constraint("ck_stock_movements_sale_link", "(kind = 'sale' AND order_item_id IS NOT NULL) OR (kind IN ('restock', 'waste', 'return', 'open_in', 'open_out') AND order_item_id IS NULL)")


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM products WHERE unit = 'scoop' LIMIT 1")).first() or connection.execute(sa.text("SELECT 1 FROM stock_movements WHERE kind IN ('open_in', 'open_out') LIMIT 1")).first():
        raise RuntimeError("Cannot downgrade while scoop products or container-opening movements exist.")
    with op.batch_alter_table("stock_movements") as batch:
        batch.drop_constraint("ck_stock_movements_kind", type_="check")
        batch.drop_constraint("ck_stock_movements_sale_link", type_="check")
        batch.create_check_constraint("ck_stock_movements_kind", "kind IN ('restock', 'waste', 'sale', 'return')")
        batch.create_check_constraint("ck_stock_movements_sale_link", "(kind = 'sale' AND order_item_id IS NOT NULL) OR (kind IN ('restock', 'waste', 'return') AND order_item_id IS NULL)")
    with op.batch_alter_table("products") as batch:
        batch.drop_constraint("ck_products_unit_servings", type_="check")
        batch.create_check_constraint("ck_products_unit_piece", "unit = 'piece'")
        batch.drop_column("servings_per_container")
        batch.drop_constraint("fk_products_container_product_id", type_="foreignkey")
        batch.drop_column("container_product_id")
