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
