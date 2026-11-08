"""One Point card intent can fund only one payment."""
from alembic import op
import sqlalchemy as sa

revision = "0064_unique_card_intent"
down_revision = "0063_member_credit_nonnegative"
branch_labels = None
depends_on = None


def upgrade() -> None:
    duplicates = op.get_bind().execute(sa.text(
        "SELECT mp_payment_intent_id FROM payments WHERE mp_payment_intent_id IS NOT NULL "
        "GROUP BY mp_payment_intent_id HAVING COUNT(*) > 1"
    )).scalars().all()
    if duplicates:
        raise RuntimeError(f"Resolve payments sharing a card intent before migrating: {', '.join(duplicates)}")
    op.create_index(
        "ux_payments_mp_payment_intent_id", "payments", ["mp_payment_intent_id"], unique=True,
        postgresql_where=sa.text("mp_payment_intent_id IS NOT NULL"),
        sqlite_where=sa.text("mp_payment_intent_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_payments_mp_payment_intent_id", table_name="payments")
