"""Append-only accepted online membership check-in events."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, JSON, String, Uuid, UniqueConstraint, event, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MemberCheckIn(Base):
    __tablename__ = "member_check_ins"
    __table_args__ = (
        CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_member_check_ins_key_length"),
        CheckConstraint("length(request_fingerprint) = 64", name="ck_member_check_ins_fingerprint"),
        UniqueConstraint("branch_id", "recorded_by", "idempotency_key", name="uq_member_check_ins_actor_key"),
        Index("ix_member_check_ins_period_occurred", "period_id", "occurred_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    member_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("members.id", ondelete="RESTRICT"), nullable=False)
    period_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("membership_periods.id", ondelete="RESTRICT"), nullable=False)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    recorded_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    access_reason: Mapped[str] = mapped_column(String(64), nullable=False)
    access_warnings: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


@event.listens_for(MemberCheckIn, "before_update")
@event.listens_for(MemberCheckIn, "before_delete")
def _reject_member_check_in_mutation(*_args) -> None:
    raise ValueError("Member check-in events are append-only.")
