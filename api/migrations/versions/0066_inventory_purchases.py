"""Record grouped inventory purchases with exact costs and a linked expense."""
from alembic import op
import sqlalchemy as sa

revision = "0066_inventory_purchases"
down_revision = "0065_shared_member_phones"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_purchases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("recorded_by", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("expense_id", sa.Uuid(), sa.ForeignKey("expenses.id", ondelete="RESTRICT"), nullable=False, unique=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("total_minor", sa.BigInteger(), nullable=False),
        sa.Column("lines", sa.JSON(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("branch_id", "idempotency_key", name="uq_inventory_purchase_branch_key"),
        sa.CheckConstraint("total_minor > 0", name="ck_inventory_purchase_total_positive"),
    )


def downgrade() -> None:
    if op.get_context().as_sql:
        if op.get_context().dialect.name != "postgresql":
            raise RuntimeError("Offline downgrade requires PostgreSQL to protect purchase records.")
        op.execute("DO $$ BEGIN IF EXISTS (SELECT 1 FROM inventory_purchases) THEN RAISE EXCEPTION 'Cannot remove recorded inventory purchases.'; END IF; END $$")
    elif op.get_bind().execute(sa.text("SELECT 1 FROM inventory_purchases LIMIT 1")).first():
        raise RuntimeError("Cannot remove recorded inventory purchases.")
    op.drop_table("inventory_purchases")
