"""Record immutable initial remainders for partial membership cash payments."""
from alembic import op
import sqlalchemy as sa


revision = "0019_membership_debt_records"
down_revision = "0018_transfer_review_activation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "membership_debts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("initial_outstanding_minor", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("initial_outstanding_minor > 0", name="ck_membership_debts_positive_amount"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_id", name="uq_membership_debts_order"),
    )
    op.create_index("ix_membership_debts_member_created", "membership_debts", ["member_id", "created_at"])


def downgrade() -> None:
    connection = op.get_bind()
    debt_count = connection.execute(sa.text("SELECT count(*) FROM membership_debts")).scalar_one()
    if debt_count:
        raise RuntimeError("Cannot downgrade while membership debt records exist.")
    op.drop_index("ix_membership_debts_member_created", table_name="membership_debts")
    op.drop_table("membership_debts")
