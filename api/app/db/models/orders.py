"""Canonical order, line-item snapshot, and confirmed payment records."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Order(Base):
    """A server-priced order posted by one seller to one branch cash shift."""

    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("currency = 'MXN'", name="ck_orders_currency_mxn"),
        CheckConstraint("total_minor >= 0", name="ck_orders_total_nonnegative"),
        CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_orders_idempotency_key_length"),
        CheckConstraint("length(request_fingerprint) = 64", name="ck_orders_fingerprint_length"),
        CheckConstraint(
            "cash_included_in_opening = false OR (is_overtime = true AND financial_shift_id IS NOT NULL)",
            name="ck_orders_opening_cash_attribution",
        ),
        UniqueConstraint("seller_id", "branch_id", "idempotency_key", name="uq_orders_seller_branch_idempotency"),
        Index("ix_orders_member_created", "member_id", "created_at"),
        Index("ix_orders_financial_shift_id", "financial_shift_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    register_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False)
    shift_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=False)
    financial_shift_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=True
    )
    is_overtime: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    cash_included_in_opening: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    member_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("members.id", ondelete="RESTRICT"), nullable=False)
    seller_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="MXN", server_default="MXN")
    total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan", lazy="selectin")
    payment: Mapped["Payment | None"] = relationship(back_populates="order", cascade="all, delete-orphan", uselist=False, lazy="selectin")


class OrderItem(Base):
    """One immutable membership line in the first supported cash order slice."""

    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("line_number > 0", name="ck_order_items_line_number_positive"),
        CheckConstraint("item_kind = 'membership'", name="ck_order_items_membership_kind"),
        CheckConstraint("quantity = 1", name="ck_order_items_quantity_one"),
        CheckConstraint("unit_amount_minor >= 0 AND line_total_minor = unit_amount_minor", name="ck_order_items_amounts_match"),
        CheckConstraint(
            "(entitlement_mode = 'period' AND duration_value IS NOT NULL AND duration_value > 0 "
            "AND duration_unit IS NOT NULL AND duration_unit IN ('day', 'month', 'year')) OR "
            "(entitlement_mode = 'single_entry' AND duration_value IS NULL AND duration_unit IS NULL)",
            name="ck_order_items_duration",
        ),
        CheckConstraint("entitlement_mode IN ('period', 'single_entry')", name="ck_order_items_entitlement_mode"),
        UniqueConstraint("order_id", "line_number", name="uq_order_items_order_line"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    plan_version_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("plan_versions.id", ondelete="RESTRICT"), nullable=False)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    item_kind: Mapped[str] = mapped_column(String(24), nullable=False, default="membership", server_default="membership")
    description_snapshot: Mapped[str] = mapped_column(String(160), nullable=False)
    duration_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    entitlement_mode: Mapped[str] = mapped_column(String(24), nullable=False, default="period", server_default="period")
    quantity: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, server_default="1")
    unit_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    line_total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)

    order: Mapped[Order] = relationship(back_populates="items")


class Payment(Base):
    """Cash settlement or pending transfer linked to a canonical order."""

    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("method IN ('cash', 'transfer')", name="ck_payments_supported_method"),
        CheckConstraint(
            "(method = 'cash' AND status = 'confirmed') OR "
            "(method = 'transfer' AND status IN ('pending', 'under_review', 'confirmed'))",
            name="ck_payments_method_status",
        ),
        CheckConstraint("amount_minor >= 0", name="ck_payments_amount_nonnegative"),
        UniqueConstraint("order_id", name="uq_payments_order"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    method: Mapped[str] = mapped_column(String(24), nullable=False, default="cash", server_default="cash")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="confirmed", server_default="confirmed")
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    received_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    order: Mapped[Order] = relationship(back_populates="payment")
