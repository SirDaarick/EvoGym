"""Add append-only cash repayment receipts for membership debts."""
from alembic import op
import sqlalchemy as sa


revision = "0020_membership_debt_payments"
down_revision = "0019_membership_debt_records"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "membership_debt_payments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("debt_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("register_id", sa.Uuid(), nullable=False),
        sa.Column("shift_id", sa.Uuid(), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("remaining_after_minor", sa.BigInteger(), nullable=False),
        sa.Column("received_by", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("amount_minor > 0", name="ck_membership_debt_payments_positive_amount"),
        sa.CheckConstraint("remaining_after_minor >= 0", name="ck_membership_debt_payments_nonnegative_remaining"),
        sa.CheckConstraint("length(idempotency_key) > 0", name="ck_membership_debt_payments_nonempty_key"),
        sa.CheckConstraint("length(request_fingerprint) = 64", name="ck_membership_debt_payments_fingerprint"),
        sa.ForeignKeyConstraint(["debt_id"], ["membership_debts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["register_id"], ["cash_registers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["shift_id"], ["shifts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["received_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "received_by", "idempotency_key", name="uq_membership_debt_payments_actor_key"),
    )
    op.create_index(
        "ix_membership_debt_payments_debt_created", "membership_debt_payments", ["debt_id", "created_at"]
    )
    op.create_index("ix_membership_debt_payments_shift", "membership_debt_payments", ["shift_id"])


def downgrade() -> None:
    connection = op.get_bind()
    receipt_count = connection.execute(sa.text("SELECT count(*) FROM membership_debt_payments")).scalar_one()
    if receipt_count:
        raise RuntimeError("Cannot downgrade while membership debt payment receipts exist.")
    op.drop_index("ix_membership_debt_payments_shift", table_name="membership_debt_payments")
    op.drop_index("ix_membership_debt_payments_debt_created", table_name="membership_debt_payments")
    op.drop_table("membership_debt_payments")
