"""Notification outbox and WhatsApp inbound inbox."""
from alembic import op
import sqlalchemy as sa

revision = "0055_notification_outbox"
down_revision = "0054_rental_deposits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_outbox",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("idempotency_key", sa.String(160), nullable=False),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("kind", sa.String(48), nullable=False),
        sa.Column("recipient", sa.String(64), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_message_id", sa.String(128), nullable=True),
        sa.Column("last_error", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('pending', 'sending', 'sent', 'failed', 'dead')", name="ck_notification_outbox_status"),
        sa.CheckConstraint("channel IN ('whatsapp', 'email', 'sms')", name="ck_notification_outbox_channel"),
        sa.CheckConstraint("attempts >= 0 AND max_attempts >= 1", name="ck_notification_outbox_attempts"),
        sa.CheckConstraint("length(idempotency_key) BETWEEN 1 AND 160", name="ck_notification_outbox_key_length"),
        sa.UniqueConstraint("idempotency_key", name="uq_notification_outbox_idempotency_key"),
    )
    op.create_index("ix_notification_outbox_due", "notification_outbox", ["status", "next_attempt_at"])
    op.create_table(
        "whatsapp_inbox_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("provider_message_id", sa.String(128), nullable=False),
        sa.Column("sender_hash", sa.String(64), nullable=False),
        sa.Column("message_type", sa.String(24), nullable=False),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("tool", sa.String(48), nullable=True),
        sa.Column("reply_outbox_id", sa.Uuid(), sa.ForeignKey("notification_outbox.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("outcome IN ('answered', 'unverified', 'ignored')", name="ck_whatsapp_inbox_outcome"),
        sa.UniqueConstraint("provider_message_id", name="uq_whatsapp_inbox_provider_message_id"),
    )
    op.create_index("ix_whatsapp_inbox_received", "whatsapp_inbox_messages", ["received_at"])


def downgrade() -> None:
    connection = op.get_bind()
    for table in ("whatsapp_inbox_messages", "notification_outbox"):
        if connection.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first():
            raise RuntimeError(f"Cannot remove recorded rows from {table}.")
    op.drop_index("ix_whatsapp_inbox_received", table_name="whatsapp_inbox_messages")
    op.drop_table("whatsapp_inbox_messages")
    op.drop_index("ix_notification_outbox_due", table_name="notification_outbox")
    op.drop_table("notification_outbox")
