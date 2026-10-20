"""Create a piece-counted product catalog and explicit branch baselines."""
from alembic import op
import sqlalchemy as sa

revision = "0012_inventory_foundation"
down_revision = "0011_shift_opening_counts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "products",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("unit", sa.String(length=16), server_default="piece", nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("length(code) BETWEEN 1 AND 64 AND code = lower(trim(code))", name="ck_products_code_normalized"),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 160 AND name = trim(name)", name="ck_products_name_normalized"),
        sa.CheckConstraint("unit = 'piece'", name="ck_products_unit_piece"),
        sa.ForeignKeyConstraint(["created_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_products_code"),
    )
    op.create_table(
        "stock_initializations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.BigInteger(), nullable=False),
        sa.Column("initialized_by", sa.Uuid(), nullable=False),
        sa.Column("initialized_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("quantity >= 0", name="ck_stock_initializations_quantity_nonnegative"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["initialized_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "product_id", name="uq_stock_initializations_branch_product"),
    )


def downgrade() -> None:
    op.drop_table("stock_initializations")
    op.drop_table("products")
