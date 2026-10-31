"""Persist cancelled product sale intents."""
from alembic import op
import sqlalchemy as sa

revision = "0042_product_sale_cancellation"
down_revision = "0041_cash_product_sales"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("product_sale_cancellations",
        sa.Column("seller_id", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("idempotency_key", sa.String(128), primary_key=True),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))


def downgrade():
    if op.get_bind().execute(sa.text("SELECT 1 FROM product_sale_cancellations LIMIT 1")).first():
        raise RuntimeError("Cannot remove durable product sale cancellations.")
    op.drop_table("product_sale_cancellations")
