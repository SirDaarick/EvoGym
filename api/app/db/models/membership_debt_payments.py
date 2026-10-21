"""Append-only cash receipts applied to one membership debt."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, Uuid, UniqueConstraint, event, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MembershipDebtPayment(Base):
    """A later cash receipt for a specifically selected membership sale debt."""

    __tablename__ = "membership_debt_payments"
    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="ck_membership_debt_payments_positive_amount"),
        CheckConstraint("remaining_after_minor >= 0", name="ck_membership_debt_payments_nonnegative_remaining"),
        CheckConstraint("length(idempotency_key) > 0", name="ck_membership_debt_payments_nonempty_key"),
        CheckConstraint("length(request_fingerprint) = 64", name="ck_membership_debt_payments_fingerprint"),
        UniqueConstraint("branch_id", "received_by", "idempotency_key", name="uq_membership_debt_payments_actor_key"),
        Index("ix_membership_debt_payments_debt_created", "debt_id", "created_at"),
        Index("ix_membership_debt_payments_shift", "shift_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    debt_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("membership_debts.id", ondelete="RESTRICT"), nullable=False
    )
    order_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False
    )
    member_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("members.id", ondelete="RESTRICT"), nullable=False
    )
    branch_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False
    )
    register_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False
    )
    shift_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=False
    )
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    remaining_after_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    received_by: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False
    )
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


@event.listens_for(MembershipDebtPayment, "before_update")
def _reject_debt_payment_update(mapper, connection, target) -> None:
    raise ValueError("Membership debt payment receipts are immutable.")


@event.listens_for(MembershipDebtPayment, "before_delete")
def _reject_debt_payment_delete(mapper, connection, target) -> None:
    raise ValueError("Membership debt payment receipts cannot be deleted.")
