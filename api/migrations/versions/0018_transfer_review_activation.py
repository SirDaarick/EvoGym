"""Add voucher review history and provisionally activated transfer periods."""
from alembic import op
import sqlalchemy as sa


revision = "0018_transfer_review_activation"
down_revision = "0017_membership_transfer_pending"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("payments") as batch_op:
        batch_op.drop_constraint("ck_payments_method_status", type_="check")
        batch_op.create_check_constraint(
            "ck_payments_method_status",
            "(method = 'cash' AND status = 'confirmed') OR "
            "(method = 'transfer' AND status IN ('pending', 'under_review', 'confirmed'))",
        )

    op.create_table(
        "payment_review_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("payment_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("from_status", sa.String(length=24), nullable=True),
        sa.Column("to_status", sa.String(length=24), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "(from_status IS NULL AND to_status = 'under_review') OR "
            "(from_status IN ('under_review', 'pending', 'confirmed') "
            "AND to_status IN ('pending', 'confirmed'))",
            name="ck_payment_review_events_transition",
        ),
        sa.CheckConstraint("length(request_fingerprint) = 64", name="ck_payment_review_events_fingerprint"),
        sa.ForeignKeyConstraint(["payment_id"], ["payments.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["actor_id"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("payment_id", "idempotency_key", name="uq_payment_review_events_key"),
    )
    op.create_index(
        "ix_payment_review_events_payment_created", "payment_review_events", ["payment_id", "created_at"]
    )


def downgrade() -> None:
    connection = op.get_bind()
    review_events = connection.execute(sa.text("SELECT count(*) FROM payment_review_events")).scalar_one()
    nonlegacy_transfers = connection.execute(sa.text(
        "SELECT count(*) FROM payments WHERE method = 'transfer' AND status <> 'pending'"
    )).scalar_one()
    transfer_periods = connection.execute(sa.text(
        "SELECT count(*) FROM membership_periods mp "
        "JOIN order_items oi ON oi.id = mp.order_item_id "
        "JOIN payments p ON p.order_id = oi.order_id WHERE p.method = 'transfer'"
    )).scalar_one()
    if review_events or nonlegacy_transfers or transfer_periods:
        raise RuntimeError("Cannot downgrade while voucher review history or transfer membership periods exist.")

    op.drop_index("ix_payment_review_events_payment_created", table_name="payment_review_events")
    op.drop_table("payment_review_events")
    with op.batch_alter_table("payments") as batch_op:
        batch_op.drop_constraint("ck_payments_method_status", type_="check")
        batch_op.create_check_constraint(
            "ck_payments_method_status",
            "(method = 'cash' AND status = 'confirmed') OR (method = 'transfer' AND status = 'pending')",
        )
