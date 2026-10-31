"""Individually identified rental assets and their lifecycle records."""
from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    event,
    func,
    inspect,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RentalAsset(Base):
    __tablename__ = "rental_assets"
    __table_args__ = (
        UniqueConstraint("branch_id", "kind", "code", name="uq_rental_assets_code"),
        UniqueConstraint("branch_id", "locker_number", name="uq_rental_assets_locker_number"),
        CheckConstraint("kind IN ('glove', 'locker')", name="ck_rental_assets_kind"),
        CheckConstraint("length(code) BETWEEN 1 AND 64 AND code = lower(trim(code))", name="ck_rental_assets_code"),
        CheckConstraint("price_minor BETWEEN 0 AND 9223372036854775807", name="ck_rental_assets_price"),
        CheckConstraint("status IN ('available', 'employee', 'out_of_service') AND (status != 'employee' OR kind = 'locker')", name="ck_rental_assets_status"),
        CheckConstraint(
            "(kind = 'glove' AND color IS NOT NULL AND length(color) BETWEEN 1 AND 64 "
            "AND ounces IS NOT NULL AND ounces > 0 AND locker_number IS NULL) OR "
            "(kind = 'locker' AND locker_number IS NOT NULL AND locker_number > 0 AND color IS NULL AND ounces IS NULL)",
            name="ck_rental_assets_attributes",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="available", server_default="available")
    color: Mapped[str | None] = mapped_column(String(64))
    ounces: Mapped[int | None] = mapped_column(Integer)
    locker_number: Mapped[int | None] = mapped_column(Integer)
    created_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Rental(Base):
    """One asset occupancy tied to a member and never inferred from expiry."""

    __tablename__ = "rentals"
    __table_args__ = (
        CheckConstraint("kind IN ('glove', 'locker')", name="ck_rentals_kind"),
        CheckConstraint("status IN ('active', 'returned', 'released', 'cancelled')", name="ck_rentals_status"),
        CheckConstraint(
            "(kind = 'glove' AND status IN ('active', 'returned')) OR "
            "(kind = 'locker' AND status IN ('active', 'released', 'cancelled'))",
            name="ck_rentals_kind_status",
        ),
        CheckConstraint(
            "(kind = 'locker' AND starts_on IS NOT NULL AND ends_on IS NOT NULL AND ends_on > starts_on) OR "
            "(kind = 'glove' AND starts_on IS NULL AND ends_on IS NULL)",
            name="ck_rentals_period",
        ),
        CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_rentals_idempotency_key_length"),
        CheckConstraint("length(request_fingerprint) = 64", name="ck_rentals_fingerprint_length"),
        UniqueConstraint("actor_id", "branch_id", "idempotency_key", name="uq_rentals_actor_branch_idempotency"),
        Index(
            "uq_rentals_active_asset", "asset_id", unique=True,
            sqlite_where=text("status = 'active'"), postgresql_where=text("status = 'active'"),
        ),
        Index("ix_rentals_member_created", "member_id", "created_at"),
        Index("ix_rentals_branch_kind_status", "branch_id", "kind", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    asset_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("rental_assets.id", ondelete="RESTRICT"), nullable=False)
    member_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("members.id", ondelete="RESTRICT"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active", server_default="active")
    starts_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    actor_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    ended_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class RentalCharge(Base):
    """One immutable priced period or one-off charge snapshot for a rental."""

    __tablename__ = "rental_charges"
    __table_args__ = (
        CheckConstraint("charge_kind IN ('initial', 'renewal')", name="ck_rental_charges_kind"),
        CheckConstraint("amount_minor BETWEEN 0 AND 9223372036854775807", name="ck_rental_charges_amount"),
        CheckConstraint("starts_on <= ends_on", name="ck_rental_charges_period"),
        CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_rental_charges_idempotency_key_length"),
        CheckConstraint("length(request_fingerprint) = 64", name="ck_rental_charges_fingerprint_length"),
        UniqueConstraint("rental_id", "starts_on", name="uq_rental_charges_rental_period"),
        UniqueConstraint("rental_id", "idempotency_key", name="uq_rental_charges_rental_idempotency"),
        Index("ix_rental_charges_rental_created", "rental_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    rental_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("rentals.id", ondelete="CASCADE"), nullable=False)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    charge_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[date] = mapped_column(Date, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class RentalReceipt(Base):
    """Durable receipt command that can allocate one repayment across periods."""

    __tablename__ = "rental_receipts"
    __table_args__ = (
        CheckConstraint("method IN ('cash', 'transfer')", name="ck_rental_receipts_method"),
        CheckConstraint("status IN ('pending', 'confirmed')", name="ck_rental_receipts_status"),
        CheckConstraint("amount_minor BETWEEN 1 AND 9223372036854775807", name="ck_rental_receipts_amount"),
        CheckConstraint("remaining_minor BETWEEN 0 AND 9223372036854775807", name="ck_rental_receipts_remaining"),
        CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_rental_receipts_key_length"),
        CheckConstraint("length(request_fingerprint) = 64", name="ck_rental_receipts_fingerprint"),
        UniqueConstraint("received_by", "idempotency_key", name="uq_rental_receipts_actor_key"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    rental_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("rentals.id", ondelete="RESTRICT"), nullable=False)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    register_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False)
    shift_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=False)
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    remaining_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    received_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


@event.listens_for(RentalReceipt, "before_update")
@event.listens_for(RentalReceipt, "before_delete")
def _reject_rental_receipt_mutation(*_args) -> None:
    raise ValueError("Rental receipts are append-only")


class RentalCancellation(Base):
    """Persistent cancellation facts that also serve as the owner alert source."""

    __tablename__ = "rental_cancellations"
    __table_args__ = (
        CheckConstraint("refund_method IN ('cash', 'card')", name="ck_rental_cancellations_refund_method"),
        CheckConstraint(
            "refund_amount_minor BETWEEN 0 AND 9223372036854775807 AND refund_amount_minor <= settled_minor",
            name="ck_rental_cancellations_refund_bounds",
        ),
        CheckConstraint(
            "settled_minor BETWEEN 0 AND 9223372036854775807 AND suggested_refund_minor BETWEEN 0 AND 9223372036854775807",
            name="ck_rental_cancellations_amounts",
        ),
        CheckConstraint(
            "cancelled_debt_minor BETWEEN 0 AND 9223372036854775807",
            name="ck_rental_cancellations_debt",
        ),
        CheckConstraint("length(trim(reason)) BETWEEN 1 AND 240", name="ck_rental_cancellations_reason"),
        CheckConstraint(
            "(reviewed_by IS NULL AND reviewed_at IS NULL) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)",
            name="ck_rental_cancellations_review_pair",
        ),
        CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_rental_cancellations_idempotency_key_length"),
        CheckConstraint("length(request_fingerprint) = 64", name="ck_rental_cancellations_fingerprint_length"),
        CheckConstraint("length(preview_token) = 64", name="ck_rental_cancellations_preview_token"),
        UniqueConstraint("rental_id", name="uq_rental_cancellations_rental"),
        UniqueConstraint("actor_id", "branch_id", "idempotency_key", name="uq_rental_cancellations_actor_branch_idempotency"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    rental_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("rentals.id", ondelete="RESTRICT"), nullable=False)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    member_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("members.id", ondelete="RESTRICT"), nullable=False)
    asset_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("rental_assets.id", ondelete="RESTRICT"), nullable=False)
    actor_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    actor_name: Mapped[str | None] = mapped_column(String(160))
    register_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False)
    shift_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=False)
    reason: Mapped[str] = mapped_column(String(240), nullable=False)
    refund_method: Mapped[str] = mapped_column(String(16), nullable=False)
    refund_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    suggested_refund_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    settled_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    cancelled_debt_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    preview_token: Mapped[str] = mapped_column(String(64), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    reviewed_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"))
    reviewed_by_name: Mapped[str | None] = mapped_column(String(160))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


_CANCELLATION_FINANCIAL_FIELDS = (
    "rental_id", "branch_id", "member_id", "asset_id", "actor_id", "actor_name", "register_id",
    "shift_id", "reason", "refund_method", "refund_amount_minor", "suggested_refund_minor",
    "settled_minor", "cancelled_debt_minor", "preview_token", "idempotency_key",
    "request_fingerprint",
)


@event.listens_for(RentalCancellation, "before_update")
def _reject_cancellation_financial_change(_mapper, _connection, target) -> None:
    state = inspect(target)
    if any(state.attrs[field].history.has_changes() for field in _CANCELLATION_FINANCIAL_FIELDS):
        raise ValueError("Rental cancellation financial facts are immutable")


@event.listens_for(RentalCancellation, "before_delete")
def _reject_cancellation_delete(_mapper, _connection, _target) -> None:
    raise ValueError("Rental cancellation records are append-only")


class RentalCardAttempt(Base):
    """Durable server-bound card attempt; provider results settle it once."""

    __tablename__ = "rental_card_attempts"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'confirmed', 'failed', 'unknown', 'cancelled')", name="ck_rental_card_attempts_status"),
        CheckConstraint("amount_minor BETWEEN 1 AND 9223372036854775807", name="ck_rental_card_attempts_amount"),
        CheckConstraint("currency = 'MXN'", name="ck_rental_card_attempts_currency"),
        CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_rental_card_attempts_idempotency_key_length"),
        CheckConstraint("length(request_fingerprint) = 64", name="ck_rental_card_attempts_fingerprint_length"),
        UniqueConstraint("created_by", "idempotency_key", name="uq_rental_card_attempts_actor_idempotency"),
        Index("ix_rental_card_attempts_charge_status", "charge_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    rental_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("rentals.id", ondelete="RESTRICT"), nullable=False)
    charge_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("rental_charges.id", ondelete="RESTRICT"), nullable=False)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    member_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("members.id", ondelete="RESTRICT"), nullable=False)
    asset_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("rental_assets.id", ondelete="RESTRICT"), nullable=False)
    register_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False)
    shift_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="RESTRICT"), nullable=False)
    terminal_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("payment_terminals.id", ondelete="RESTRICT"))
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="MXN", server_default="MXN")
    provider_intent_id: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    failure_reason: Mapped[str | None] = mapped_column(String(240))
    payment_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("payments.id", ondelete="SET NULL"))
    authorization_code: Mapped[str | None] = mapped_column(String(64))
    card_brand: Mapped[str | None] = mapped_column(String(32))
    card_last_four: Mapped[str | None] = mapped_column(String(4))
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
