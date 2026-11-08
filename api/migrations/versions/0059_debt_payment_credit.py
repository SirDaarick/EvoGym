"""Record how much of each membership debt repayment was paid from member credit."""
from alembic import op
import sqlalchemy as sa


revision = "0059_debt_payment_credit"
down_revision = "0058_member_credit_movements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("membership_debt_payments") as batch:
        batch.add_column(sa.Column("credit_minor", sa.BigInteger(), server_default="0", nullable=False))
        batch.create_check_constraint(
            "ck_membership_debt_payments_credit_bounds", "credit_minor >= 0 AND credit_minor <= amount_minor"
        )


def downgrade() -> None:
    connection = op.get_bind()
    credit_count = connection.execute(
        sa.text("SELECT count(*) FROM membership_debt_payments WHERE credit_minor > 0")
    ).scalar_one()
    if credit_count:
        raise RuntimeError("Cannot downgrade while debt repayments paid from member credit exist.")
    with op.batch_alter_table("membership_debt_payments") as batch:
        batch.drop_constraint("ck_membership_debt_payments_credit_bounds", type_="check")
        batch.drop_column("credit_minor")
