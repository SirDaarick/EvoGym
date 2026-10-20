"""Registers, terminals, and shift management.

Revision ID: 0010_registers_terminals_and_shifts
Revises: 0009_catalog_services_and_plans
"""
from alembic import op
import sqlalchemy as sa

revision = "0010_registers_terminals_and_shifts"
down_revision = "0009_catalog_services_and_plans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create payment_terminals table
    op.create_table(
        "payment_terminals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("provider", sa.String(32), server_default="mercado_pago", nullable=False),
        sa.Column("device_id", sa.String(64), nullable=False),
        sa.Column("mp_store_id", sa.String(64), nullable=True),
        sa.Column("mp_pos_id", sa.String(64), nullable=True),
        sa.Column("status", sa.String(24), server_default="active", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'inactive', 'maintenance')",
            name="ck_payment_terminals_status",
        ),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "code", name="uq_payment_terminals_branch_code"),
    )
    op.create_index("ix_payment_terminals_branch_id", "payment_terminals", ["branch_id"])

    # 2. Create cash_registers table
    op.create_table(
        "cash_registers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("default_terminal_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(24), server_default="active", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('active', 'inactive')", name="ck_cash_registers_status"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["default_terminal_id"], ["payment_terminals.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "code", name="uq_cash_registers_branch_code"),
    )
    op.create_index("ix_cash_registers_branch_id", "cash_registers", ["branch_id"])

    # 3. Create shifts table
    op.create_table(
        "shifts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("cash_register_id", sa.Uuid(), nullable=False),
        sa.Column("opened_by", sa.Uuid(), nullable=False),
        sa.Column("closed_by", sa.Uuid(), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(24), server_default="open", nullable=False),
        sa.Column("opening_cash_minor", sa.BigInteger(), nullable=False),
        sa.Column("expected_cash_at_close_minor", sa.BigInteger(), nullable=True),
        sa.Column("counted_cash_minor", sa.BigInteger(), nullable=True),
        sa.Column("difference_minor", sa.BigInteger(), nullable=True),
        sa.Column("closing_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('open', 'closing', 'closed')", name="ck_shifts_status"),
        sa.CheckConstraint("opening_cash_minor >= 0", name="ck_shifts_opening_cash_minor"),
        sa.ForeignKeyConstraint(["cash_register_id"], ["cash_registers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["opened_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["closed_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_shifts_cash_register_id", "shifts", ["cash_register_id"])
    op.create_index(
        "uq_shifts_active_per_register",
        "shifts",
        ["cash_register_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('open', 'closing')"),
        sqlite_where=sa.text("status IN ('open', 'closing')"),
    )


def downgrade() -> None:
    op.drop_index("uq_shifts_active_per_register", table_name="shifts")
    op.drop_index("ix_shifts_cash_register_id", table_name="shifts")
    op.drop_table("shifts")

    op.drop_index("ix_cash_registers_branch_id", table_name="cash_registers")
    op.drop_table("cash_registers")

    op.drop_index("ix_payment_terminals_branch_id", table_name="payment_terminals")
    op.drop_table("payment_terminals")
