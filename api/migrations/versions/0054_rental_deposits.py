"""Rental deposits: per-asset deposit amount and an append-only deposit movement ledger."""
from alembic import op
import sqlalchemy as sa

revision = "0054_rental_deposits"
down_revision = "0053_scoop_products"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("rental_assets") as batch:
        batch.add_column(sa.Column("deposit_minor", sa.BigInteger(), nullable=False, server_default="0"))
    op.create_table(
        "rental_deposit_movements",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("rental_id", sa.Uuid(), sa.ForeignKey("rentals.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("register_id", sa.Uuid(), sa.ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("shift_id", sa.Uuid(), sa.ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("retained_minor", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("reason", sa.String(240), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('hold', 'refund')", name="ck_rental_deposit_movements_kind"),
        sa.CheckConstraint(
            "(kind = 'hold' AND amount_minor BETWEEN 1 AND 9223372036854775807 AND retained_minor = 0) OR "
            "(kind = 'refund' AND amount_minor BETWEEN 0 AND 9223372036854775807 "
            "AND retained_minor BETWEEN 0 AND 9223372036854775807)",
            name="ck_rental_deposit_movements_amounts",
        ),
        sa.CheckConstraint(
            "retained_minor = 0 OR (reason IS NOT NULL AND length(trim(reason)) BETWEEN 1 AND 240)",
            name="ck_rental_deposit_movements_reason",
        ),
        sa.CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_rental_deposit_movements_key_length"),
        sa.CheckConstraint("length(request_fingerprint) = 64", name="ck_rental_deposit_movements_fingerprint"),
        sa.UniqueConstraint("rental_id", "kind", name="uq_rental_deposit_movements_rental_kind"),
    )
    op.create_index("ix_rental_deposit_movements_shift", "rental_deposit_movements", ["shift_id"])


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM rental_deposit_movements LIMIT 1")).first():
        raise RuntimeError("Cannot remove recorded rental deposit movements.")
    if connection.execute(sa.text("SELECT 1 FROM rental_assets WHERE deposit_minor <> 0 LIMIT 1")).first():
        raise RuntimeError("Cannot remove configured rental deposit amounts.")
    op.drop_index("ix_rental_deposit_movements_shift", table_name="rental_deposit_movements")
    op.drop_table("rental_deposit_movements")
    with op.batch_alter_table("rental_assets") as batch:
        batch.drop_column("deposit_minor")
