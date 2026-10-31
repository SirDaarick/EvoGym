"""Recorded shift and business cash movements."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("category IN ('consumibles','limpieza','mantenimiento_piso','mantenimiento_peso','mantenimiento_cardio','mantenimiento_box','servicios','general')", name="ck_expenses_category"),
        CheckConstraint("amount_minor > 0", name="ck_expenses_amount"),
        CheckConstraint("payment_method IN ('cash','transfer','card')", name="ck_expenses_method"),
        CheckConstraint("shift_id IS NULL OR payment_method = 'cash'", name="ck_expenses_shift_cash"),
        CheckConstraint("(voided_at IS NULL AND voided_by_id IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND voided_by_id IS NOT NULL AND void_reason IS NOT NULL)", name="ck_expenses_void"),
        UniqueConstraint("branch_id", "recorded_by_id", "idempotency_key", name="uq_expenses_actor_key"),
        Index("ix_expenses_branch_created", "branch_id", "created_at"),
        Index("ix_expenses_shift", "shift_id"),
    )
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    shift_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="RESTRICT"))
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    concept: Mapped[str] = mapped_column(String(255), nullable=False)
    payee_name: Mapped[str] = mapped_column(String(160), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(16), nullable=False)
    voucher_reference: Mapped[str | None] = mapped_column(String(120))
    evidence_key: Mapped[str | None] = mapped_column(String(255))
    recorded_by_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_by_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"))
    void_reason: Mapped[str | None] = mapped_column(String(500))


class ShiftCashContribution(Base):
    __tablename__ = "shift_cash_contributions"
    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="ck_shift_cash_contributions_amount"),
        UniqueConstraint("branch_id", "recorded_by_id", "idempotency_key", name="uq_shift_cash_contributions_actor_key"),
        Index("ix_shift_cash_contributions_shift", "shift_id"),
    )
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    shift_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=False)
    concept: Mapped[str] = mapped_column(String(255), nullable=False)
    contributor_name: Mapped[str] = mapped_column(String(160), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    recorded_by_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
