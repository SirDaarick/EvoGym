"""Add branch timezones and canonical cash membership sale records."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0015_membership_sales"
down_revision = "0014_opening_inventory_reviews"
branch_labels = None
depends_on = None


def _uuid_type():
    return sa.Uuid(as_uuid=True).with_variant(postgresql.UUID(as_uuid=True), "postgresql")


def upgrade() -> None:
    op.add_column(
        "branches",
        sa.Column("timezone", sa.String(length=64), server_default="America/Mexico_City", nullable=False),
    )
    op.create_table(
        "orders",
        sa.Column("id", _uuid_type(), nullable=False),
        sa.Column("branch_id", _uuid_type(), nullable=False),
        sa.Column("register_id", _uuid_type(), nullable=False),
        sa.Column("shift_id", _uuid_type(), nullable=False),
        sa.Column("member_id", _uuid_type(), nullable=False),
        sa.Column("seller_id", _uuid_type(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("currency", sa.String(length=3), server_default="MXN", nullable=False),
        sa.Column("total_minor", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("currency = 'MXN'", name="ck_orders_currency_mxn"),
        sa.CheckConstraint("total_minor >= 0", name="ck_orders_total_nonnegative"),
        sa.CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_orders_idempotency_key_length"),
        sa.CheckConstraint("length(request_fingerprint) = 64", name="ck_orders_fingerprint_length"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["register_id"], ["cash_registers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["shift_id"], ["shifts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["seller_id"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("seller_id", "branch_id", "idempotency_key", name="uq_orders_seller_branch_idempotency"),
    )
    op.create_index("ix_orders_member_created", "orders", ["member_id", "created_at"])
    op.create_table(
        "order_items",
        sa.Column("id", _uuid_type(), nullable=False),
        sa.Column("order_id", _uuid_type(), nullable=False),
        sa.Column("plan_version_id", _uuid_type(), nullable=False),
        sa.Column("line_number", sa.Integer(), server_default="1", nullable=False),
        sa.Column("item_kind", sa.String(length=24), server_default="membership", nullable=False),
        sa.Column("description_snapshot", sa.String(length=160), nullable=False),
        sa.Column("duration_value", sa.Integer(), nullable=False),
        sa.Column("duration_unit", sa.String(length=16), nullable=False),
        sa.Column("quantity", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("unit_amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("line_total_minor", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("line_number > 0", name="ck_order_items_line_number_positive"),
        sa.CheckConstraint("item_kind = 'membership'", name="ck_order_items_membership_kind"),
        sa.CheckConstraint("quantity = 1", name="ck_order_items_quantity_one"),
        sa.CheckConstraint("unit_amount_minor >= 0 AND line_total_minor >= 0", name="ck_order_items_amounts_nonnegative"),
        sa.CheckConstraint("duration_value > 0 AND duration_unit IN ('day', 'month', 'year')", name="ck_order_items_duration"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["plan_version_id"], ["plan_versions.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_id", "line_number", name="uq_order_items_order_line"),
    )
    op.create_table(
        "payments",
        sa.Column("id", _uuid_type(), nullable=False),
        sa.Column("order_id", _uuid_type(), nullable=False),
        sa.Column("method", sa.String(length=24), server_default="cash", nullable=False),
        sa.Column("status", sa.String(length=24), server_default="confirmed", nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("received_by", _uuid_type(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("method = 'cash'", name="ck_payments_cash_only"),
        sa.CheckConstraint("status = 'confirmed'", name="ck_payments_confirmed_only"),
        sa.CheckConstraint("amount_minor >= 0", name="ck_payments_amount_nonnegative"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["received_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_id", name="uq_payments_order"),
    )
    op.create_table(
        "membership_periods",
        sa.Column("id", _uuid_type(), nullable=False),
        sa.Column("member_id", _uuid_type(), nullable=False),
        sa.Column("order_item_id", _uuid_type(), nullable=False),
        sa.Column("plan_version_id", _uuid_type(), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("activated_by", _uuid_type(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("ends_on > starts_on", name="ck_membership_periods_end_after_start"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["order_item_id"], ["order_items.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["plan_version_id"], ["plan_versions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["activated_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_item_id", name="uq_membership_periods_order_item"),
    )


def downgrade() -> None:
    op.drop_table("membership_periods")
    op.drop_table("payments")
    op.drop_table("order_items")
    op.drop_index("ix_orders_member_created", table_name="orders")
    op.drop_table("orders")
    op.drop_column("branches", "timezone")
