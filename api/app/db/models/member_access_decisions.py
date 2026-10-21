"""Append-only administrator decisions for payment-related membership access."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid, UniqueConstraint, event, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MemberAccessDecision(Base):
    __tablename__ = "member_access_decisions"
    __table_args__ = (
        CheckConstraint("action IN ('restrict', 'restore')", name="ck_member_access_decisions_action"),
        CheckConstraint("length(request_fingerprint) = 64", name="ck_member_access_decisions_fingerprint"),
        UniqueConstraint("period_id", "idempotency_key", name="uq_member_access_decisions_key"),
        UniqueConstraint("period_id", "decision_order", name="uq_member_access_decisions_order"),
        Index("ix_member_access_decisions_period_created", "period_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    period_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("membership_periods.id", ondelete="RESTRICT"), nullable=False)
    actor_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(String(240), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    decision_order: Mapped[int] = mapped_column(Integer, nullable=False)
    lifted_access_decision_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("member_access_decisions.id", ondelete="RESTRICT"))
    lifted_payment_review_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("payment_review_events.id", ondelete="RESTRICT"))
    lifted_review_event_count: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


@event.listens_for(MemberAccessDecision, "before_update")
@event.listens_for(MemberAccessDecision, "before_delete")
def _reject_member_access_decision_mutation(*_args) -> None:
    raise ValueError("Membership access decisions are append-only.")
