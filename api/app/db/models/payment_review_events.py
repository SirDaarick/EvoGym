"""Append-only actor and decision history for voucher-backed transfers."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid, event, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PaymentReviewEvent(Base):
    """One receptionist attestation or authorized administrator review decision."""

    __tablename__ = "payment_review_events"
    __table_args__ = (
        CheckConstraint(
            "(from_status IS NULL AND to_status = 'under_review') OR "
            "(from_status IN ('under_review', 'pending', 'confirmed') "
            "AND to_status IN ('pending', 'confirmed'))",
            name="ck_payment_review_events_transition",
        ),
        CheckConstraint("length(request_fingerprint) = 64", name="ck_payment_review_events_fingerprint"),
        UniqueConstraint("payment_id", "idempotency_key", name="uq_payment_review_events_key"),
        Index("ix_payment_review_events_payment_created", "payment_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    payment_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("payments.id", ondelete="RESTRICT"), nullable=False
    )
    actor_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False
    )
    from_status: Mapped[str | None] = mapped_column(String(24))
    to_status: Mapped[str] = mapped_column(String(24), nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(128))
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


@event.listens_for(PaymentReviewEvent, "before_update")
def _reject_payment_review_event_update(_mapper, _connection, _target) -> None:
    raise ValueError("Payment review events are append-only")


@event.listens_for(PaymentReviewEvent, "before_delete")
def _reject_payment_review_event_delete(_mapper, _connection, _target) -> None:
    raise ValueError("Payment review events are append-only")
