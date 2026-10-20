"""Branch-neutral member membership-period date records."""
from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Uuid, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MembershipPeriod(Base):
    """A confirmed-payment-triggered membership date interval, not an access grant."""

    __tablename__ = "membership_periods"
    __table_args__ = (
        CheckConstraint("ends_on > starts_on", name="ck_membership_periods_end_after_start"),
        UniqueConstraint("order_item_id", name="uq_membership_periods_order_item"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    member_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("members.id", ondelete="RESTRICT"), nullable=False)
    order_item_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("order_items.id", ondelete="RESTRICT"), nullable=False)
    plan_version_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("plan_versions.id", ondelete="RESTRICT"), nullable=False)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[date] = mapped_column(Date, nullable=False)
    activated_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
