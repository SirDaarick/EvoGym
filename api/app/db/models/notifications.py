"""Notification outbox and WhatsApp inbound inbox (provider side effects live outside domain transactions)."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class NotificationOutbox(Base):
    """One pending/sent outbound message. Mutable delivery state; `idempotency_key` makes enqueue idempotent."""

    __tablename__ = "notification_outbox"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'sending', 'sent', 'failed', 'dead')", name="ck_notification_outbox_status"),
        CheckConstraint("channel IN ('whatsapp', 'email', 'sms')", name="ck_notification_outbox_channel"),
        CheckConstraint("attempts >= 0 AND max_attempts >= 1", name="ck_notification_outbox_attempts"),
        CheckConstraint("length(idempotency_key) BETWEEN 1 AND 160", name="ck_notification_outbox_key_length"),
        UniqueConstraint("idempotency_key", name="uq_notification_outbox_idempotency_key"),
        Index("ix_notification_outbox_due", "status", "next_attempt_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    kind: Mapped[str] = mapped_column(String(48), nullable=False)
    recipient: Mapped[str] = mapped_column(String(64), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=6, server_default="6")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    provider_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class WhatsappInboxMessage(Base):
    """Deduplicated record of an accepted inbound WhatsApp message. Stores no message text and no raw phone."""

    __tablename__ = "whatsapp_inbox_messages"
    __table_args__ = (
        CheckConstraint("outcome IN ('answered', 'unverified', 'ignored')", name="ck_whatsapp_inbox_outcome"),
        UniqueConstraint("provider_message_id", name="uq_whatsapp_inbox_provider_message_id"),
        Index("ix_whatsapp_inbox_received", "received_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    provider_message_id: Mapped[str] = mapped_column(String(128), nullable=False)
    sender_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    message_type: Mapped[str] = mapped_column(String(24), nullable=False)
    member_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("members.id", ondelete="RESTRICT"), nullable=True)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    tool: Mapped[str | None] = mapped_column(String(48), nullable=True)
    reply_outbox_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("notification_outbox.id", ondelete="RESTRICT"), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
