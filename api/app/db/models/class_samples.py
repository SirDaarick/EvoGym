"""Durable paid class-sample entitlement records."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, JSON, String, Uuid, UniqueConstraint, event, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ClassSampleEntitlement(Base):
    """One retained sample entitlement per member, linked to its purchase."""

    __tablename__ = "class_sample_entitlements"
    __table_args__ = (
        UniqueConstraint("member_id", name="uq_class_sample_entitlements_member"),
        UniqueConstraint("order_item_id", name="uq_class_sample_entitlements_order_item"),
        Index("ix_class_sample_entitlements_plan_version", "plan_version_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    member_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("members.id", ondelete="RESTRICT"), nullable=False)
    order_item_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("order_items.id", ondelete="RESTRICT"), nullable=False)
    plan_version_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("plan_versions.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ClassSampleCheckIn(Base):
    """Append-only, one-time consumption event for a paid sample entitlement."""

    __tablename__ = "class_sample_check_ins"
    __table_args__ = (
        CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_class_sample_check_ins_key_length"),
        CheckConstraint("length(request_fingerprint) = 64", name="ck_class_sample_check_ins_fingerprint"),
        UniqueConstraint("entitlement_id", name="uq_class_sample_check_ins_entitlement"),
        UniqueConstraint("branch_id", "recorded_by", "idempotency_key", name="uq_class_sample_check_ins_actor_key"),
        Index("ix_class_sample_check_ins_member_occurred", "member_id", "occurred_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    entitlement_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("class_sample_entitlements.id", ondelete="RESTRICT"), nullable=False)
    member_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("members.id", ondelete="RESTRICT"), nullable=False)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    recorded_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    access_reason: Mapped[str] = mapped_column(String(64), nullable=False)
    access_warnings: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


@event.listens_for(ClassSampleCheckIn, "before_update")
@event.listens_for(ClassSampleCheckIn, "before_delete")
def _reject_class_sample_check_in_mutation(*_args) -> None:
    raise ValueError("Class sample check-in events are append-only.")
