"""Add salary to roster profiles."""
from alembic import op
import sqlalchemy as sa

revision = "0050_payroll"
down_revision = "0049_expenses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("staff_roster_profiles", sa.Column(
        "monthly_salary_minor", sa.BigInteger(),
        sa.CheckConstraint("monthly_salary_minor >= 0", name="ck_staff_roster_monthly_salary_nonnegative"),
        nullable=False, server_default="0",
    ))
    op.create_table(
        "payroll_advances",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("staff_profile_id", sa.Uuid(), sa.ForeignKey("staff_roster_profiles.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("notes", sa.String(255)),
        sa.Column("expense_id", sa.Uuid(), sa.ForeignKey("expenses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("recorded_by_id", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("amount_minor > 0", name="ck_payroll_advance_amount"),
        sa.UniqueConstraint("branch_id", "recorded_by_id", "idempotency_key", name="uq_payroll_advance_actor_key"),
    )
    op.create_index("ix_payroll_advances_profile_week", "payroll_advances", ["staff_profile_id", "week_start"])
    op.create_table(
        "payroll_payments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("staff_profile_id", sa.Uuid(), sa.ForeignKey("staff_roster_profiles.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("base_minor", sa.BigInteger(), nullable=False),
        sa.Column("advances_minor", sa.BigInteger(), nullable=False),
        sa.Column("net_minor", sa.BigInteger(), nullable=False),
        sa.Column("payment_method", sa.String(16), nullable=False),
        sa.Column("expense_id", sa.Uuid(), sa.ForeignKey("expenses.id", ondelete="RESTRICT")),
        sa.Column("recorded_by_id", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("staff_profile_id", "week_start", name="uq_payroll_payment_profile_week"),
        sa.UniqueConstraint("branch_id", "recorded_by_id", "idempotency_key", name="uq_payroll_payment_actor_key"),
        sa.CheckConstraint("base_minor >= 0 AND advances_minor >= 0 AND net_minor >= 0 AND net_minor = base_minor - advances_minor", name="ck_payroll_payment_amounts"),
        sa.CheckConstraint("payment_method IN ('transfer', 'cash')", name="ck_payroll_payment_method"),
        sa.CheckConstraint("(net_minor = 0 AND expense_id IS NULL) OR (net_minor > 0 AND expense_id IS NOT NULL)", name="ck_payroll_payment_expense"),
    )


def downgrade() -> None:
    # Payroll and linked expenses are financial records, not disposable schema state.
    connection = op.get_bind()
    if (connection.execute(sa.text("SELECT 1 FROM payroll_advances LIMIT 1")).first()
            or connection.execute(sa.text("SELECT 1 FROM payroll_payments LIMIT 1")).first()
            or connection.execute(sa.text("SELECT 1 FROM staff_roster_profiles WHERE monthly_salary_minor <> 0 LIMIT 1")).first()):
        raise RuntimeError("Cannot downgrade while payroll records exist.")
    op.drop_table("payroll_payments")
    op.drop_index("ix_payroll_advances_profile_week", table_name="payroll_advances")
    op.drop_table("payroll_advances")
    op.drop_column("staff_roster_profiles", "monthly_salary_minor")
