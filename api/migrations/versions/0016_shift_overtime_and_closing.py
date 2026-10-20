"""Separate overtime source shifts from financial shifts and persist close counts."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0016_overtime_shift_close"
down_revision = "0015_membership_sales"
branch_labels = None
depends_on = None


def _uuid_type():
    return sa.Uuid(as_uuid=True).with_variant(postgresql.UUID(as_uuid=True), "postgresql")


def upgrade() -> None:
    with op.batch_alter_table("orders") as batch:
        batch.add_column(sa.Column("financial_shift_id", _uuid_type(), nullable=True))
        batch.add_column(sa.Column("is_overtime", sa.Boolean(), server_default=sa.false(), nullable=False))
        batch.add_column(
            sa.Column("cash_included_in_opening", sa.Boolean(), server_default=sa.false(), nullable=False)
        )
        batch.create_foreign_key(
            "fk_orders_financial_shift_id_shifts",
            "shifts",
            ["financial_shift_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch.create_check_constraint(
            "ck_orders_opening_cash_attribution",
            "cash_included_in_opening = false OR (is_overtime = true AND financial_shift_id IS NOT NULL)",
        )
    op.execute(sa.text("UPDATE orders SET financial_shift_id = shift_id WHERE financial_shift_id IS NULL"))
    op.create_index("ix_orders_financial_shift_id", "orders", ["financial_shift_id"])
    op.create_table(
        "shift_closing_denomination_counts",
        sa.Column("id", _uuid_type(), nullable=False),
        sa.Column("shift_id", _uuid_type(), nullable=False),
        sa.Column("denomination_minor", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("denomination_minor > 0", name="ck_shift_closing_counts_denomination_positive"),
        sa.CheckConstraint("quantity >= 0", name="ck_shift_closing_counts_quantity_nonnegative"),
        sa.ForeignKeyConstraint(["shift_id"], ["shifts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("shift_id", "denomination_minor", name="uq_shift_closing_counts_shift_denomination"),
    )


def downgrade() -> None:
    op.drop_table("shift_closing_denomination_counts")
    op.drop_index("ix_orders_financial_shift_id", table_name="orders")
    with op.batch_alter_table("orders") as batch:
        batch.drop_constraint("ck_orders_opening_cash_attribution", type_="check")
        batch.drop_constraint("fk_orders_financial_shift_id_shifts", type_="foreignkey")
        batch.drop_column("cash_included_in_opening")
        batch.drop_column("is_overtime")
        batch.drop_column("financial_shift_id")
