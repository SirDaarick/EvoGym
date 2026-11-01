"""Add expenses and shift cash contributions."""
from alembic import op
import sqlalchemy as sa

revision = "0049_expenses"
down_revision = "0048_rental_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "expenses",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("shift_id", sa.Uuid(), sa.ForeignKey("shifts.id", ondelete="RESTRICT")),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("concept", sa.String(255), nullable=False),
        sa.Column("payee_name", sa.String(160), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("payment_method", sa.String(16), nullable=False),
        sa.Column("voucher_reference", sa.String(120)),
        sa.Column("evidence_key", sa.String(255)),
        sa.Column("recorded_by_id", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("voided_at", sa.DateTime(timezone=True)),
        sa.Column("voided_by_id", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT")),
        sa.Column("void_reason", sa.String(500)),
        sa.CheckConstraint("category IN ('consumibles','limpieza','mantenimiento_piso','mantenimiento_peso','mantenimiento_cardio','mantenimiento_box','servicios','general')", name="ck_expenses_category"),
        sa.CheckConstraint("amount_minor > 0", name="ck_expenses_amount"),
        sa.CheckConstraint("payment_method IN ('cash','transfer','card')", name="ck_expenses_method"),
        sa.CheckConstraint("shift_id IS NULL OR payment_method = 'cash'", name="ck_expenses_shift_cash"),
        sa.CheckConstraint("(voided_at IS NULL AND voided_by_id IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND voided_by_id IS NOT NULL AND void_reason IS NOT NULL)", name="ck_expenses_void"),
        sa.UniqueConstraint("branch_id", "recorded_by_id", "idempotency_key", name="uq_expenses_actor_key"),
    )
    op.create_index("ix_expenses_branch_created", "expenses", ["branch_id", "created_at"])
    op.create_index("ix_expenses_shift", "expenses", ["shift_id"])
    op.create_table(
        "shift_cash_contributions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("shift_id", sa.Uuid(), sa.ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("concept", sa.String(255), nullable=False),
        sa.Column("contributor_name", sa.String(160), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("recorded_by_id", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("amount_minor > 0", name="ck_shift_cash_contributions_amount"),
        sa.UniqueConstraint("branch_id", "recorded_by_id", "idempotency_key", name="uq_shift_cash_contributions_actor_key"),
    )
    op.create_index("ix_shift_cash_contributions_shift", "shift_cash_contributions", ["shift_id"])


def downgrade() -> None:
    connection = op.get_bind()
    for table in ("expenses", "shift_cash_contributions"):
        if connection.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first():
            raise RuntimeError("Cannot remove recorded cash movements.")
    op.drop_table("shift_cash_contributions")
    op.drop_table("expenses")
