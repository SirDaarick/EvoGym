"""Allow pending bank-transfer membership orders without changing existing rows."""
from alembic import op
import sqlalchemy as sa


revision = "0017_membership_transfer_pending"
down_revision = "0016_overtime_shift_close"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("payments") as batch_op:
        batch_op.drop_constraint("ck_payments_cash_only", type_="check")
        batch_op.drop_constraint("ck_payments_confirmed_only", type_="check")
        batch_op.create_check_constraint(
            "ck_payments_supported_method", "method IN ('cash', 'transfer')"
        )
        batch_op.create_check_constraint(
            "ck_payments_method_status",
            "(method = 'cash' AND status = 'confirmed') OR "
            "(method = 'transfer' AND status = 'pending')",
        )


def downgrade() -> None:
    connection = op.get_bind()
    pending_transfers = connection.execute(
        sa.text("SELECT count(*) FROM payments WHERE method = 'transfer' AND status = 'pending'")
    ).scalar_one()
    if pending_transfers:
        raise RuntimeError("Cannot downgrade while pending transfer payments exist.")

    with op.batch_alter_table("payments") as batch_op:
        batch_op.drop_constraint("ck_payments_method_status", type_="check")
        batch_op.drop_constraint("ck_payments_supported_method", type_="check")
        batch_op.create_check_constraint("ck_payments_cash_only", "method = 'cash'")
        batch_op.create_check_constraint("ck_payments_confirmed_only", "status = 'confirmed'")
