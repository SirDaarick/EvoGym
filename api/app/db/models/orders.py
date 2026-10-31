"""Canonical order, line-item snapshot, and confirmed payment records."""
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.db.models.shifts import PaymentTerminal


class Order(Base):
    """A server-priced order posted by one seller to one branch cash shift."""

    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("currency = 'MXN'", name="ck_orders_currency_mxn"),
        CheckConstraint("total_minor >= 0", name="ck_orders_total_nonnegative"),
        CheckConstraint("(order_kind = 'membership' AND member_id IS NOT NULL) OR order_kind = 'product'", name="ck_orders_kind_member"),
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
    member_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("members.id", ondelete="RESTRICT"), nullable=True)
    order_kind: Mapped[str] = mapped_column(String(24), nullable=False, default="membership", server_default="membership")
    seller_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="MXN", server_default="MXN")
    total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan", lazy="selectin", order_by="OrderItem.line_number")
    payment: Mapped["Payment | None"] = relationship(back_populates="order", cascade="all, delete-orphan", uselist=False, lazy="selectin")


class ProductSaleResolution(Base):
    """Durable attribution for administrative resolution of an uncertain sale."""
    __tablename__ = "product_sale_resolutions"
    __table_args__ = (CheckConstraint("result IN ('completed', 'cancelled')", name="ck_product_sale_resolution_result"),)
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    actor_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    seller_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    register_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    result: Mapped[str] = mapped_column(String(16), nullable=False)
    resolved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


@event.listens_for(ProductSaleResolution, "before_update")
@event.listens_for(ProductSaleResolution, "before_delete")
def _reject_resolution_modification(_mapper, _connection, _target):
    raise ValueError("Product sale resolution records are append-only")


class ProductSaleCancellation(Base):
    """Durable cancellation prevents a delayed request from creating a sale."""

    __tablename__ = "product_sale_cancellations"
    seller_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), primary_key=True)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), primary_key=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ProductSaleIntent(Base):
    """One unresolved product sale per seller, shared by all sessions."""
    __tablename__ = "product_sale_intents"
    seller_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), primary_key=True)
    register_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)


class OrderItem(Base):
    """One immutable membership line in the first supported cash order slice."""

    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("line_number > 0", name="ck_order_items_line_number_positive"),
        CheckConstraint("(item_kind = 'membership' AND plan_version_id IS NOT NULL AND product_id IS NULL AND quantity = 1 AND entitlement_mode IS NOT NULL) OR (item_kind = 'product' AND product_id IS NOT NULL AND plan_version_id IS NULL AND quantity > 0 AND entitlement_mode IS NULL AND duration_value IS NULL AND duration_unit IS NULL)", name="ck_order_items_kind_fields"),
        CheckConstraint("unit_amount_minor >= 0 AND line_total_minor >= 0 AND (item_kind = 'membership' OR line_total_minor = unit_amount_minor * quantity)", name="ck_order_items_amounts_match"),
        CheckConstraint(
            "item_kind = 'product' OR (entitlement_mode = 'period' AND duration_value IS NOT NULL AND duration_value > 0 "
            "AND duration_unit IS NOT NULL AND duration_unit IN ('day', 'month', 'year')) OR "
            "(entitlement_mode = 'single_entry' AND duration_value IS NULL AND duration_unit IS NULL)",
            name="ck_order_items_duration",
        ),
        CheckConstraint("item_kind = 'product' OR entitlement_mode IN ('period', 'single_entry')", name="ck_order_items_entitlement_mode"),
        UniqueConstraint("order_id", "line_number", name="uq_order_items_order_line"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    plan_version_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("plan_versions.id", ondelete="RESTRICT"), nullable=True)
    product_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=True)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    item_kind: Mapped[str] = mapped_column(String(24), nullable=False, default="membership", server_default="membership")
    description_snapshot: Mapped[str] = mapped_column(String(160), nullable=False)
    duration_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    entitlement_mode: Mapped[str | None] = mapped_column(String(24), nullable=True, default="period", server_default="period")
    quantity: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, server_default="1")
    unit_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    line_total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)

    order: Mapped[Order] = relationship(back_populates="items")
    refund: Mapped["ProductRefund | None"] = relationship(back_populates="order_item", uselist=False, lazy="selectin")


class Payment(Base):
    """Cash settlement, pending transfer, or Point card payment owned by an order or rental charge."""

    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("method IN ('cash', 'transfer', 'card')", name="ck_payments_supported_method"),
        CheckConstraint(
            "(method = 'cash' AND status = 'confirmed') OR "
            "(method = 'transfer' AND status IN ('pending', 'under_review', 'confirmed')) OR "
            "(method = 'card' AND status IN ('pending', 'confirmed', 'failed'))",
            name="ck_payments_method_status",
        ),
        CheckConstraint("amount_minor >= 0", name="ck_payments_amount_nonnegative"),
        CheckConstraint(
            "(order_id IS NOT NULL AND rental_charge_id IS NULL) OR "
            "(order_id IS NULL AND rental_charge_id IS NOT NULL)",
            name="ck_payments_exactly_one_owner",
        ),
        CheckConstraint(
            "idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 128",
            name="ck_payments_idempotency_key_length",
        ),
        CheckConstraint(
            "request_fingerprint IS NULL OR length(request_fingerprint) = 64",
            name="ck_payments_fingerprint_length",
        ),
        UniqueConstraint("order_id", name="uq_payments_order"),
        UniqueConstraint("received_by", "idempotency_key", name="uq_payments_received_by_idempotency"),
        Index("ix_payments_rental_receipt_id", "rental_receipt_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=True
    )
    rental_charge_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("rental_charges.id", ondelete="RESTRICT"), nullable=True
    )
    rental_receipt_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("rental_receipts.id", ondelete="RESTRICT"), nullable=True
    )
    register_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=True
    )
    shift_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=True
    )
    method: Mapped[str] = mapped_column(String(24), nullable=False, default="cash", server_default="cash")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="confirmed", server_default="confirmed")
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    received_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    terminal_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("payment_terminals.id", ondelete="SET NULL"), nullable=True
    )
    mp_payment_intent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mp_payment_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    card_brand: Mapped[str | None] = mapped_column(String(32), nullable=True)
    card_last_four: Mapped[str | None] = mapped_column(String(4), nullable=True)
    authorization_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    request_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)

    order: Mapped[Order | None] = relationship(back_populates="payment")
    terminal: Mapped["PaymentTerminal | None"] = relationship(lazy="selectin")


class ProductRefund(Base):
    """Compensating refund record for a single returned product line."""

    __tablename__ = "product_refunds"
    __table_args__ = (
        CheckConstraint("length(trim(reason)) > 0", name="ck_product_refunds_reason_nonempty"),
        CheckConstraint("disposition IN ('restock', 'waste')", name="ck_product_refunds_disposition"),
        CheckConstraint("payout_method IN ('cash', 'card')", name="ck_product_refunds_payout_method"),
        CheckConstraint("amount_minor > 0", name="ck_product_refunds_amount_positive"),
        CheckConstraint("quantity > 0", name="ck_product_refunds_quantity_positive"),
        CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_product_refunds_idempotency_key_length"),
        CheckConstraint("length(request_fingerprint) = 64", name="ck_product_refunds_fingerprint_length"),
        UniqueConstraint("actor_id", "branch_id", "idempotency_key", name="uq_product_refunds_actor_branch_idempotency"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_item_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("order_items.id", ondelete="RESTRICT"), nullable=False, unique=True
    )
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    register_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False)
    shift_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=False)
    financial_shift_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=True
    )
    actor_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    reason: Mapped[str] = mapped_column(String(240), nullable=False)
    disposition: Mapped[str] = mapped_column(String(16), nullable=False)
    payout_method: Mapped[str] = mapped_column(String(16), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[int] = mapped_column(BigInteger, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    order_item: Mapped[OrderItem] = relationship(back_populates="refund", lazy="selectin")


@event.listens_for(ProductRefund, "before_update")
@event.listens_for(ProductRefund, "before_delete")
def _reject_refund_modification(_mapper, _connection, _target):
    raise ValueError("Product refund records are append-only")
