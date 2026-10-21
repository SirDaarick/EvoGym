"""Immutable initial outstanding amounts from partially paid memberships."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Uuid, UniqueConstraint, event, func
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.db.base import Base


class MembershipDebt(Base):
    """Record the unpaid remainder at sale time without mutating the sale snapshot."""

    __tablename__ = "membership_debts"
    __table_args__ = (
        CheckConstraint("initial_outstanding_minor > 0", name="ck_membership_debts_positive_amount"),
        UniqueConstraint("order_id", name="uq_membership_debts_order"),
        Index("ix_membership_debts_member_created", "member_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False
    )
    member_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("members.id", ondelete="RESTRICT"), nullable=False
    )
    initial_outstanding_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


@event.listens_for(MembershipDebt, "before_update")
def _reject_membership_debt_update(mapper, connection, target) -> None:
    raise ValueError("Initial membership debt records are immutable.")


@event.listens_for(MembershipDebt, "before_delete")
def _reject_membership_debt_delete(mapper, connection, target) -> None:
    raise ValueError("Initial membership debt records cannot be deleted.")
