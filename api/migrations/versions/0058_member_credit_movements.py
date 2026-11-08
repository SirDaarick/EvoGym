"""Add the append-only member credit (saldo a favor) ledger."""
from alembic import op
import sqlalchemy as sa


revision = "0058_member_credit_movements"
down_revision = "0057_contingency_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "member_credit_movements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("register_id", sa.Uuid(), nullable=False),
        sa.Column("shift_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("balance_after_minor", sa.BigInteger(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=True),
        sa.Column("debt_id", sa.Uuid(), nullable=True),
        sa.Column("rental_charge_id", sa.Uuid(), nullable=True),
        sa.Column("received_by", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('deposit', 'apply')", name="ck_member_credit_movements_kind"),
        sa.CheckConstraint("amount_minor > 0", name="ck_member_credit_movements_positive_amount"),
        sa.CheckConstraint("balance_after_minor >= 0", name="ck_member_credit_movements_nonnegative_balance"),
        sa.CheckConstraint(
            "idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 128",
            name="ck_member_credit_movements_key_length",
        ),
        sa.CheckConstraint(
            "request_fingerprint IS NULL OR length(request_fingerprint) = 64",
            name="ck_member_credit_movements_fingerprint",
        ),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["register_id"], ["cash_registers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["shift_id"], ["shifts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["debt_id"], ["membership_debts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["rental_charge_id"], ["rental_charges.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["received_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "received_by", "idempotency_key", name="uq_member_credit_movements_actor_key"),
    )
    op.create_index(
        "ix_member_credit_movements_member_created", "member_credit_movements", ["member_id", "created_at"]
    )
    op.create_index("ix_member_credit_movements_shift", "member_credit_movements", ["shift_id"])


def downgrade() -> None:
    connection = op.get_bind()
    movement_count = connection.execute(sa.text("SELECT count(*) FROM member_credit_movements")).scalar_one()
    if movement_count:
        raise RuntimeError("Cannot downgrade while member credit movements exist.")
    op.drop_index("ix_member_credit_movements_shift", table_name="member_credit_movements")
    op.drop_index("ix_member_credit_movements_member_created", table_name="member_credit_movements")
    op.drop_table("member_credit_movements")
