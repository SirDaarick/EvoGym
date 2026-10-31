"""Persist unresolved product sale intents per seller."""
from alembic import op
import sqlalchemy as sa

revision = "0043_product_sale_intents"
down_revision = "0042_product_sale_cancellation"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("product_sale_intents",
        sa.Column("seller_id", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("register_id", sa.Uuid(), sa.ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False))


def downgrade():
    if op.get_bind().execute(sa.text("SELECT 1 FROM product_sale_intents LIMIT 1")).first():
        raise RuntimeError("Cannot remove unresolved product sale intents.")
    op.drop_table("product_sale_intents")
