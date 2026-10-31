"""Card payments with Mercado Pago Point integration and terminal linkage."""
from alembic import op
import sqlalchemy as sa

revision = "0046_card_payments_point"
down_revision = "0045_product_refunds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("payments") as batch:
        batch.add_column(sa.Column("terminal_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("mp_payment_intent_id", sa.String(64), nullable=True))
        batch.add_column(sa.Column("mp_payment_id", sa.String(64), nullable=True))
        batch.add_column(sa.Column("card_brand", sa.String(32), nullable=True))
        batch.add_column(sa.Column("card_last_four", sa.String(4), nullable=True))
        batch.add_column(sa.Column("authorization_code", sa.String(64), nullable=True))
        batch.create_foreign_key(
            "fk_payments_terminal_id_payment_terminals",
            "payment_terminals",
            ["terminal_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.drop_constraint("ck_payments_supported_method", type_="check")
        batch.drop_constraint("ck_payments_method_status", type_="check")
        batch.create_check_constraint(
            "ck_payments_supported_method",
            "method IN ('cash', 'transfer', 'card')",
        )
        batch.create_check_constraint(
            "ck_payments_method_status",
            "(method = 'cash' AND status = 'confirmed') OR "
            "(method = 'transfer' AND status IN ('pending', 'under_review', 'confirmed')) OR "
            "(method = 'card' AND status IN ('pending', 'confirmed', 'failed'))",
        )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM payments WHERE method = 'card' LIMIT 1")).first():
        raise RuntimeError("Cannot remove card payment records.")

    with op.batch_alter_table("payments") as batch:
        batch.drop_constraint("ck_payments_method_status", type_="check")
        batch.drop_constraint("ck_payments_supported_method", type_="check")
        batch.create_check_constraint(
            "ck_payments_supported_method",
            "method IN ('cash', 'transfer')",
        )
        batch.create_check_constraint(
            "ck_payments_method_status",
            "(method = 'cash' AND status = 'confirmed') OR "
            "(method = 'transfer' AND status IN ('pending', 'under_review', 'confirmed'))",
        )
        batch.drop_constraint("fk_payments_terminal_id_payment_terminals", type_="foreignkey")
        batch.drop_column("authorization_code")
        batch.drop_column("card_last_four")
        batch.drop_column("card_brand")
        batch.drop_column("mp_payment_id")
        batch.drop_column("mp_payment_intent_id")
        batch.drop_column("terminal_id")
