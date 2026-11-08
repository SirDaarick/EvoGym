"""Allow rental receivable receipts to be paid from member credit (method 'credit')."""
from alembic import op
import sqlalchemy as sa

revision = "0061_rental_receipt_credit"
down_revision = "0060_rental_credit_payments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("rental_receipts") as batch:
        batch.drop_constraint("ck_rental_receipts_method", type_="check")
        batch.create_check_constraint("ck_rental_receipts_method", "method IN ('cash', 'transfer', 'credit')")


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM rental_receipts WHERE method = 'credit' LIMIT 1")).first():
        raise RuntimeError("Cannot remove rental receipts paid from member credit.")
    with op.batch_alter_table("rental_receipts") as batch:
        batch.drop_constraint("ck_rental_receipts_method", type_="check")
        batch.create_check_constraint("ck_rental_receipts_method", "method IN ('cash', 'transfer')")
