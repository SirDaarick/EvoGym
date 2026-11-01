"""Append-only payroll movements and payment snapshots."""
from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, CheckConstraint, Date, DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PayrollAdvance(Base):
    __tablename__ = "payroll_advances"
    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="ck_payroll_advance_amount"),
        UniqueConstraint("branch_id", "recorded_by_id", "idempotency_key", name="uq_payroll_advance_actor_key"),
        Index("ix_payroll_advances_profile_week", "staff_profile_id", "week_start"),
    )
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    staff_profile_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_roster_profiles.id", ondelete="RESTRICT"), nullable=False)
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(255))
    expense_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("expenses.id", ondelete="RESTRICT"), nullable=False)
    recorded_by_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class PayrollPayment(Base):
    __tablename__ = "payroll_payments"
    __table_args__ = (
        UniqueConstraint("staff_profile_id", "week_start", name="uq_payroll_payment_profile_week"),
        UniqueConstraint("branch_id", "recorded_by_id", "idempotency_key", name="uq_payroll_payment_actor_key"),
        CheckConstraint("base_minor >= 0 AND advances_minor >= 0 AND net_minor >= 0 AND net_minor = base_minor - advances_minor", name="ck_payroll_payment_amounts"),
        CheckConstraint("payment_method IN ('transfer', 'cash')", name="ck_payroll_payment_method"),
        CheckConstraint("(net_minor = 0 AND expense_id IS NULL) OR (net_minor > 0 AND expense_id IS NOT NULL)", name="ck_payroll_payment_expense"),
    )
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    staff_profile_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_roster_profiles.id", ondelete="RESTRICT"), nullable=False)
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    base_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    advances_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    net_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(16), nullable=False)
    expense_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("expenses.id", ondelete="RESTRICT"))
    recorded_by_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
