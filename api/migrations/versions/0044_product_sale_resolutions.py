"""Record administrative product sale intent resolutions."""
from alembic import op
import sqlalchemy as sa

revision = "0044_product_sale_resolutions"
down_revision = "0043_product_sale_intents"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("product_sale_resolutions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("seller_id", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("register_id", sa.Uuid(), sa.ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("result", sa.String(16), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("result IN ('completed', 'cancelled')", name="ck_product_sale_resolution_result"))


def downgrade():
    if op.get_bind().execute(sa.text("SELECT 1 FROM product_sale_resolutions LIMIT 1")).first():
        raise RuntimeError("Cannot remove product sale resolution audit records.")
    op.drop_table("product_sale_resolutions")
