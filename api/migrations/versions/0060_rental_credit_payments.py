"""Allow rental charges to be settled from member credit (payment method 'credit')."""
from alembic import op
import sqlalchemy as sa

revision = "0060_rental_credit_payments"
down_revision = "0059_debt_payment_credit"
branch_labels = None
depends_on = None

_STATUS_BASE = (
    "(method = 'cash' AND status = 'confirmed') OR "
    "(method = 'transfer' AND status IN ('pending', 'under_review', 'confirmed')) OR "
    "(method = 'card' AND status IN ('pending', 'confirmed', 'failed'))"
)


def upgrade() -> None:
    with op.batch_alter_table("payments") as batch:
        batch.drop_constraint("ck_payments_supported_method", type_="check")
        batch.drop_constraint("ck_payments_method_status", type_="check")
        batch.create_check_constraint(
            "ck_payments_supported_method", "method IN ('cash', 'transfer', 'card', 'credit')"
        )
        batch.create_check_constraint(
            "ck_payments_method_status", _STATUS_BASE + " OR (method = 'credit' AND status = 'confirmed')"
        )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM payments WHERE method = 'credit' LIMIT 1")).first():
        raise RuntimeError("Cannot remove payments settled from member credit.")
    with op.batch_alter_table("payments") as batch:
        batch.drop_constraint("ck_payments_method_status", type_="check")
        batch.drop_constraint("ck_payments_supported_method", type_="check")
        batch.create_check_constraint("ck_payments_supported_method", "method IN ('cash', 'transfer', 'card')")
        batch.create_check_constraint("ck_payments_method_status", _STATUS_BASE)
