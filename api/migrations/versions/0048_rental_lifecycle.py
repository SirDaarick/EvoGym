"""Rental lifecycle, cancellations, card attempts, and payment ownership."""
from alembic import op
import sqlalchemy as sa

revision = "0048_rental_lifecycle"
down_revision = "0047_rental_assets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rentals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("rental_assets.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("starts_on", sa.Date(), nullable=True),
        sa.Column("ends_on", sa.Date(), nullable=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("ended_by", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('glove', 'locker')", name="ck_rentals_kind"),
        sa.CheckConstraint("status IN ('active', 'returned', 'released', 'cancelled')", name="ck_rentals_status"),
        sa.CheckConstraint(
            "(kind = 'glove' AND status IN ('active', 'returned')) OR "
            "(kind = 'locker' AND status IN ('active', 'released', 'cancelled'))",
            name="ck_rentals_kind_status",
        ),
        sa.CheckConstraint(
            "(kind = 'locker' AND starts_on IS NOT NULL AND ends_on IS NOT NULL AND ends_on > starts_on) OR "
            "(kind = 'glove' AND starts_on IS NULL AND ends_on IS NULL)",
            name="ck_rentals_period",
        ),
        sa.CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_rentals_idempotency_key_length"),
        sa.CheckConstraint("length(request_fingerprint) = 64", name="ck_rentals_fingerprint_length"),
        sa.UniqueConstraint("actor_id", "branch_id", "idempotency_key", name="uq_rentals_actor_branch_idempotency"),
    )
    op.create_index("uq_rentals_active_asset", "rentals", ["asset_id"], unique=True,
                    sqlite_where=sa.text("status = 'active'"),
                    postgresql_where=sa.text("status = 'active'"))
    op.create_index("ix_rentals_member_created", "rentals", ["member_id", "created_at"])
    op.create_index("ix_rentals_branch_kind_status", "rentals", ["branch_id", "kind", "status"])

    op.create_table(
        "rental_charges",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("rental_id", sa.Uuid(), sa.ForeignKey("rentals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("charge_kind", sa.String(16), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("charge_kind IN ('initial', 'renewal')", name="ck_rental_charges_kind"),
        sa.CheckConstraint("amount_minor BETWEEN 0 AND 9223372036854775807", name="ck_rental_charges_amount"),
        sa.CheckConstraint("starts_on <= ends_on", name="ck_rental_charges_period"),
        sa.CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_rental_charges_idempotency_key_length"),
        sa.CheckConstraint("length(request_fingerprint) = 64", name="ck_rental_charges_fingerprint_length"),
        sa.UniqueConstraint("rental_id", "starts_on", name="uq_rental_charges_rental_period"),
        sa.UniqueConstraint("rental_id", "idempotency_key", name="uq_rental_charges_rental_idempotency"),
    )
    op.create_index("ix_rental_charges_rental_created", "rental_charges", ["rental_id", "created_at"])

    op.create_table(
        "rental_receipts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("rental_id", sa.Uuid(), sa.ForeignKey("rentals.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("register_id", sa.Uuid(), sa.ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("shift_id", sa.Uuid(), sa.ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("method", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("remaining_minor", sa.BigInteger(), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("received_by", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("method IN ('cash', 'transfer')", name="ck_rental_receipts_method"),
        sa.CheckConstraint("status IN ('pending', 'confirmed')", name="ck_rental_receipts_status"),
        sa.CheckConstraint("amount_minor BETWEEN 1 AND 9223372036854775807", name="ck_rental_receipts_amount"),
        sa.CheckConstraint("remaining_minor BETWEEN 0 AND 9223372036854775807", name="ck_rental_receipts_remaining"),
        sa.CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_rental_receipts_key_length"),
        sa.CheckConstraint("length(request_fingerprint) = 64", name="ck_rental_receipts_fingerprint"),
        sa.UniqueConstraint("received_by", "idempotency_key", name="uq_rental_receipts_actor_key"),
    )

    op.create_table(
        "rental_cancellations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("rental_id", sa.Uuid(), sa.ForeignKey("rentals.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("rental_assets.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("actor_name", sa.String(160), nullable=True),
        sa.Column("register_id", sa.Uuid(), sa.ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("shift_id", sa.Uuid(), sa.ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("reason", sa.String(240), nullable=False),
        sa.Column("refund_method", sa.String(16), nullable=False),
        sa.Column("refund_amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("suggested_refund_minor", sa.BigInteger(), nullable=False),
        sa.Column("settled_minor", sa.BigInteger(), nullable=False),
        sa.Column("cancelled_debt_minor", sa.BigInteger(), nullable=False),
        sa.Column("preview_token", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("reviewed_by", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("reviewed_by_name", sa.String(160), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("refund_method IN ('cash', 'card')", name="ck_rental_cancellations_refund_method"),
        sa.CheckConstraint(
            "refund_amount_minor BETWEEN 0 AND 9223372036854775807 AND refund_amount_minor <= settled_minor",
            name="ck_rental_cancellations_refund_bounds",
        ),
        sa.CheckConstraint(
            "settled_minor BETWEEN 0 AND 9223372036854775807 AND suggested_refund_minor BETWEEN 0 AND 9223372036854775807",
            name="ck_rental_cancellations_amounts",
        ),
        sa.CheckConstraint("cancelled_debt_minor BETWEEN 0 AND 9223372036854775807", name="ck_rental_cancellations_debt"),
        sa.CheckConstraint("length(trim(reason)) BETWEEN 1 AND 240", name="ck_rental_cancellations_reason"),
        sa.CheckConstraint(
            "(reviewed_by IS NULL AND reviewed_at IS NULL) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)",
            name="ck_rental_cancellations_review_pair",
        ),
        sa.CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_rental_cancellations_idempotency_key_length"),
        sa.CheckConstraint("length(request_fingerprint) = 64", name="ck_rental_cancellations_fingerprint_length"),
        sa.CheckConstraint("length(preview_token) = 64", name="ck_rental_cancellations_preview_token"),
        sa.UniqueConstraint("rental_id", name="uq_rental_cancellations_rental"),
        sa.UniqueConstraint("actor_id", "branch_id", "idempotency_key",
                            name="uq_rental_cancellations_actor_branch_idempotency"),
    )

    op.create_table(
        "rental_card_attempts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("rental_id", sa.Uuid(), sa.ForeignKey("rentals.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("charge_id", sa.Uuid(), sa.ForeignKey("rental_charges.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("rental_assets.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("register_id", sa.Uuid(), sa.ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("shift_id", sa.Uuid(), sa.ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("terminal_id", sa.Uuid(), sa.ForeignKey("payment_terminals.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="MXN"),
        sa.Column("provider_intent_id", sa.String(64), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("failure_reason", sa.String(240), nullable=True),
        sa.Column("payment_id", sa.Uuid(), sa.ForeignKey("payments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("authorization_code", sa.String(64), nullable=True),
        sa.Column("card_brand", sa.String(32), nullable=True),
        sa.Column("card_last_four", sa.String(4), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('pending', 'confirmed', 'failed', 'unknown', 'cancelled')",
                           name="ck_rental_card_attempts_status"),
        sa.CheckConstraint("amount_minor BETWEEN 1 AND 9223372036854775807",
                           name="ck_rental_card_attempts_amount"),
        sa.CheckConstraint("currency = 'MXN'", name="ck_rental_card_attempts_currency"),
        sa.CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128",
                           name="ck_rental_card_attempts_idempotency_key_length"),
        sa.CheckConstraint("length(request_fingerprint) = 64",
                           name="ck_rental_card_attempts_fingerprint_length"),
        sa.UniqueConstraint("created_by", "idempotency_key", name="uq_rental_card_attempts_actor_idempotency"),
    )
    op.create_index("ix_rental_card_attempts_charge_status", "rental_card_attempts", ["charge_id", "status"])

    with op.batch_alter_table("payments") as batch:
        batch.alter_column("order_id", existing_type=sa.Uuid(), nullable=True)
        batch.add_column(sa.Column("rental_charge_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("rental_receipt_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("register_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("shift_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("idempotency_key", sa.String(128), nullable=True))
        batch.add_column(sa.Column("request_fingerprint", sa.String(64), nullable=True))
        batch.create_foreign_key("fk_payments_rental_charge_id_rental_charges", "rental_charges",
                                 ["rental_charge_id"], ["id"], ondelete="RESTRICT")
        batch.create_foreign_key("fk_payments_rental_receipt_id_rental_receipts", "rental_receipts",
                                 ["rental_receipt_id"], ["id"], ondelete="RESTRICT")
        batch.create_foreign_key("fk_payments_register_id_cash_registers", "cash_registers",
                                 ["register_id"], ["id"], ondelete="RESTRICT")
        batch.create_foreign_key("fk_payments_shift_id_shifts", "shifts",
                                 ["shift_id"], ["id"], ondelete="RESTRICT")
        batch.create_check_constraint(
            "ck_payments_exactly_one_owner",
            "(order_id IS NOT NULL AND rental_charge_id IS NULL) OR "
            "(order_id IS NULL AND rental_charge_id IS NOT NULL)",
        )
        batch.create_check_constraint(
            "ck_payments_idempotency_key_length",
            "idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 128",
        )
        batch.create_check_constraint(
            "ck_payments_fingerprint_length",
            "request_fingerprint IS NULL OR length(request_fingerprint) = 64",
        )
        batch.create_unique_constraint("uq_payments_received_by_idempotency", ["received_by", "idempotency_key"])
    op.create_index("ix_payments_rental_receipt_id", "payments", ["rental_receipt_id"])


def downgrade() -> None:
    connection = op.get_bind()
    for table in ("rentals", "rental_charges", "rental_receipts", "rental_cancellations", "rental_card_attempts"):
        if connection.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first():
            raise RuntimeError("Cannot remove recorded rental lifecycle data.")
    op.drop_table("rental_card_attempts")
    op.drop_index("ix_payments_rental_receipt_id", table_name="payments")
    with op.batch_alter_table("payments") as batch:
        batch.drop_constraint("uq_payments_received_by_idempotency", type_="unique")
        batch.drop_constraint("ck_payments_fingerprint_length", type_="check")
        batch.drop_constraint("ck_payments_idempotency_key_length", type_="check")
        batch.drop_constraint("ck_payments_exactly_one_owner", type_="check")
        batch.drop_constraint("fk_payments_shift_id_shifts", type_="foreignkey")
        batch.drop_constraint("fk_payments_register_id_cash_registers", type_="foreignkey")
        batch.drop_constraint("fk_payments_rental_receipt_id_rental_receipts", type_="foreignkey")
        batch.drop_constraint("fk_payments_rental_charge_id_rental_charges", type_="foreignkey")
        batch.drop_column("request_fingerprint")
        batch.drop_column("idempotency_key")
        batch.drop_column("shift_id")
        batch.drop_column("register_id")
        batch.drop_column("rental_receipt_id")
        batch.drop_column("rental_charge_id")
        batch.alter_column("order_id", existing_type=sa.Uuid(), nullable=False)
    op.drop_table("rental_cancellations")
    op.drop_table("rental_receipts")
    op.drop_table("rental_charges")
    op.drop_table("rentals")
