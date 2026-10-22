"""Durable paid class-sample entitlement records."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Uuid, UniqueConstraint, func
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
