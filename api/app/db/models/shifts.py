"""Payment terminal, cash register, and shift models."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class PaymentTerminal(Base):
    """Payment terminal (e.g. Mercado Pago Point) registered per branch."""

    __tablename__ = "payment_terminals"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'inactive', 'maintenance')",
            name="ck_payment_terminals_status",
        ),
        UniqueConstraint("branch_id", "code", name="uq_payment_terminals_branch_code"),
        Index("ix_payment_terminals_branch_id", "branch_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("branches.id", ondelete="RESTRICT"),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    provider: Mapped[str] = mapped_column(
        String(32), nullable=False, default="mercado_pago", server_default="mercado_pago"
    )
    device_id: Mapped[str] = mapped_column(String(64), nullable=False)
    mp_store_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mp_pos_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="active", server_default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class CashRegister(Base):
    """Cash register registered per branch with optional default terminal."""

    __tablename__ = "cash_registers"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'inactive')",
            name="ck_cash_registers_status",
        ),
        UniqueConstraint("branch_id", "code", name="uq_cash_registers_branch_code"),
        Index("ix_cash_registers_branch_id", "branch_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("branches.id", ondelete="RESTRICT"),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    default_terminal_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("payment_terminals.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="active", server_default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    default_terminal: Mapped[PaymentTerminal | None] = relationship(
        "PaymentTerminal",
        foreign_keys=[default_terminal_id],
        lazy="selectin",
    )
    shifts: Mapped[list["Shift"]] = relationship(
        "Shift",
        back_populates="cash_register",
        order_by="desc(Shift.opened_at)",
    )


class Shift(Base):
    """Operational cash shift on a cash register."""

    __tablename__ = "shifts"
    __table_args__ = (
        CheckConstraint(
            "status IN ('open', 'closing', 'closed')",
            name="ck_shifts_status",
        ),
        CheckConstraint(
            "opening_cash_minor >= 0",
            name="ck_shifts_opening_cash_minor",
        ),
        Index(
            "uq_shifts_active_per_register",
            "cash_register_id",
            unique=True,
            postgresql_where=text("status IN ('open', 'closing')"),
            sqlite_where=text("status IN ('open', 'closing')"),
        ),
        Index("ix_shifts_cash_register_id", "cash_register_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    cash_register_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("cash_registers.id", ondelete="RESTRICT"),
        nullable=False,
    )
    opened_by: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("staff_users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    closed_by: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("staff_users.id", ondelete="RESTRICT"),
        nullable=True,
    )
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(24),
        nullable=False,
        default="open",
        server_default="open",
    )
    opening_cash_minor: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
    )
    expected_cash_at_close_minor: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )
    counted_cash_minor: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )
    difference_minor: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )
    closing_notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    cash_register: Mapped[CashRegister] = relationship(
        "CashRegister",
        back_populates="shifts",
    )
    denomination_counts: Mapped[list["ShiftDenominationCount"]] = relationship(
        "ShiftDenominationCount",
        back_populates="shift",
        cascade="all, delete-orphan",
        order_by="ShiftDenominationCount.denomination_minor.desc()",
        lazy="selectin",
    )
    closing_denomination_counts: Mapped[list["ShiftClosingDenominationCount"]] = relationship(
        "ShiftClosingDenominationCount",
        back_populates="shift",
        cascade="all, delete-orphan",
        order_by="ShiftClosingDenominationCount.denomination_minor.desc()",
        lazy="selectin",
    )
    inventory_review: Mapped["ShiftInventoryReview | None"] = relationship(
        "ShiftInventoryReview", back_populates="shift", cascade="all, delete-orphan", uselist=False, lazy="selectin"
    )


class ShiftDenominationCount(Base):
    """Opening cash denomination observation for one shift."""

    __tablename__ = "shift_denomination_counts"
    __table_args__ = (
        CheckConstraint("denomination_minor > 0", name="ck_shift_denomination_counts_denomination_positive"),
        CheckConstraint("quantity >= 0", name="ck_shift_denomination_counts_quantity_nonnegative"),
        UniqueConstraint("shift_id", "denomination_minor", name="uq_shift_denomination_counts_shift_denomination"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    shift_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False
    )
    denomination_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[int] = mapped_column(BigInteger, nullable=False)

    shift: Mapped[Shift] = relationship("Shift", back_populates="denomination_counts")


class ShiftClosingDenominationCount(Base):
    """Immutable bill and coin evidence recorded at shift close."""

    __tablename__ = "shift_closing_denomination_counts"
    __table_args__ = (
        CheckConstraint("denomination_minor > 0", name="ck_shift_closing_counts_denomination_positive"),
        CheckConstraint("quantity >= 0", name="ck_shift_closing_counts_quantity_nonnegative"),
        UniqueConstraint("shift_id", "denomination_minor", name="uq_shift_closing_counts_shift_denomination"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    shift_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False
    )
    denomination_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[int] = mapped_column(BigInteger, nullable=False)

    shift: Mapped[Shift] = relationship("Shift", back_populates="closing_denomination_counts")


class ShiftInventoryReview(Base):
    """Global opening inventory acceptance and optional physical observations."""

    __tablename__ = "shift_inventory_reviews"
    __table_args__ = (
        CheckConstraint("mode IN ('no_changes_declared', 'physical_counts_reported')", name="ck_shift_inventory_reviews_mode"),
        UniqueConstraint("shift_id", name="uq_shift_inventory_reviews_shift"),
        UniqueConstraint("snapshot_id", name="uq_shift_inventory_reviews_snapshot"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    shift_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False)
    snapshot_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("register_inventory_snapshots.id", ondelete="RESTRICT"), nullable=False)
    confirmed_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    mode: Mapped[str] = mapped_column(String(32), nullable=False)
    observations: Mapped[list["ShiftInventoryObservation"]] = relationship(
        "ShiftInventoryObservation", back_populates="review", cascade="all, delete-orphan", lazy="selectin"
    )
    shift: Mapped[Shift] = relationship("Shift", back_populates="inventory_review")
    snapshot: Mapped["RegisterInventorySnapshot"] = relationship("RegisterInventorySnapshot", lazy="selectin")


class ShiftInventoryObservation(Base):
    """Physical count reported for one item in the consumed opening snapshot."""

    __tablename__ = "shift_inventory_observations"
    __table_args__ = (
        CheckConstraint("physical_quantity IS NOT NULL AND physical_quantity >= 0", name="ck_shift_inventory_observations_quantity_nonnegative"),
        UniqueConstraint("review_id", "snapshot_item_id", name="uq_shift_inventory_observations_item"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    review_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("shift_inventory_reviews.id", ondelete="CASCADE"), nullable=False)
    snapshot_item_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("register_inventory_snapshot_items.id", ondelete="RESTRICT"), nullable=False)
    physical_quantity: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    review: Mapped[ShiftInventoryReview] = relationship("ShiftInventoryReview", back_populates="observations")
    snapshot_item: Mapped["RegisterInventorySnapshotItem"] = relationship("RegisterInventorySnapshotItem", lazy="joined")
