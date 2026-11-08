"""Append-only ledger of member credit (saldo a favor) deposits and applications."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid, event, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MemberCreditMovement(Base):
    """A cash deposit into, or a payment drawn from, one member's credit balance."""

    __tablename__ = "member_credit_movements"
    __table_args__ = (
        CheckConstraint("kind IN ('deposit', 'apply')", name="ck_member_credit_movements_kind"),
        CheckConstraint("amount_minor > 0", name="ck_member_credit_movements_positive_amount"),
        CheckConstraint("balance_after_minor >= 0", name="ck_member_credit_movements_nonnegative_balance"),
        CheckConstraint(
            "idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 128",
            name="ck_member_credit_movements_key_length",
        ),
        CheckConstraint(
            "request_fingerprint IS NULL OR length(request_fingerprint) = 64",
            name="ck_member_credit_movements_fingerprint",
        ),
        UniqueConstraint("branch_id", "received_by", "idempotency_key", name="uq_member_credit_movements_actor_key"),
        Index("ix_member_credit_movements_member_created", "member_id", "created_at"),
        Index("ix_member_credit_movements_shift", "shift_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
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
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    balance_after_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    order_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="RESTRICT"), nullable=True
    )
    debt_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("membership_debts.id", ondelete="RESTRICT"), nullable=True
    )
    rental_charge_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("rental_charges.id", ondelete="RESTRICT"), nullable=True
    )
    received_by: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False
    )
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    request_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


@event.listens_for(MemberCreditMovement, "before_update")
def _reject_credit_movement_update(mapper, connection, target) -> None:
    raise ValueError("Member credit movements are immutable.")


@event.listens_for(MemberCreditMovement, "before_delete")
def _reject_credit_movement_delete(mapper, connection, target) -> None:
    raise ValueError("Member credit movements cannot be deleted.")
