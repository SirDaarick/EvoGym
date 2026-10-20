"""Database queries and operations for terminals, cash registers, and shifts."""
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models.shifts import CashRegister, PaymentTerminal, Shift, ShiftDenominationCount
from app.shifts.schemas import (
    CashRegisterDTO,
    PaymentTerminalDTO,
    ShiftDTO,
)


class ShiftAlreadyOpenError(Exception):
    """Raised when opening a shift on a register that already has an active open shift."""


class CashRegisterNotFoundError(Exception):
    """Raised when a specified cash register cannot be found."""


def create_payment_terminal(
    session: Session,
    branch_id: UUID,
    code: str,
    name: str,
    device_id: str,
    provider: str = "mercado_pago",
    mp_store_id: str | None = None,
    mp_pos_id: str | None = None,
) -> PaymentTerminal:
    """Create a new payment terminal for a branch."""
    terminal = PaymentTerminal(
        branch_id=branch_id,
        code=code.strip(),
        name=name.strip(),
        device_id=device_id.strip(),
        provider=provider.strip(),
        mp_store_id=mp_store_id.strip() if mp_store_id else None,
        mp_pos_id=mp_pos_id.strip() if mp_pos_id else None,
        status="active",
    )
    session.add(terminal)
    session.flush()
    return terminal


def list_payment_terminals(
    session: Session,
    branch_id: UUID | None = None,
) -> list[PaymentTerminal]:
    """List payment terminals, optionally filtered by branch."""
    stmt = select(PaymentTerminal)
    if branch_id is not None:
        stmt = stmt.where(PaymentTerminal.branch_id == branch_id)
    stmt = stmt.order_by(PaymentTerminal.code.asc())
    return list(session.scalars(stmt).all())


def create_cash_register(
    session: Session,
    branch_id: UUID,
    code: str,
    name: str,
    default_terminal_id: UUID | None = None,
) -> CashRegister:
    """Create a new cash register for a branch."""
    register = CashRegister(
        branch_id=branch_id,
        code=code.strip(),
        name=name.strip(),
        default_terminal_id=default_terminal_id,
        status="active",
    )
    session.add(register)
    session.flush()
    return register


def list_cash_registers(
    session: Session,
    branch_id: UUID | None = None,
) -> list[CashRegister]:
    """List cash registers, optionally filtered by branch."""
    stmt = select(CashRegister)
    if branch_id is not None:
        stmt = stmt.where(CashRegister.branch_id == branch_id)
    stmt = stmt.order_by(CashRegister.code.asc())
    return list(session.scalars(stmt).all())


def get_active_register_ids(session: Session) -> set[UUID]:
    """Return set of cash_register_ids that have an active ('open' or 'closing') shift."""
    stmt = select(Shift.cash_register_id).where(Shift.status.in_(["open", "closing"]))
    return set(session.scalars(stmt).all())


def get_cash_register(
    session: Session,
    register_id: UUID,
) -> CashRegister | None:
    """Retrieve a single cash register by ID."""
    stmt = select(CashRegister).where(CashRegister.id == register_id)
    return session.scalar(stmt)


def get_open_shift(
    session: Session,
    register_id: UUID,
) -> Shift | None:
    """Retrieve the currently open or closing shift for a cash register."""
    stmt = (
        select(Shift)
        .where(
            Shift.cash_register_id == register_id,
            Shift.status.in_(["open", "closing"]),
        )
        .order_by(Shift.opened_at.desc())
    )
    return session.scalar(stmt)


def open_shift(
    session: Session,
    register_id: UUID,
    opened_by: UUID,
    denomination_counts: list[dict[str, int]],
    opening_cash_minor: int | None = None,
) -> Shift:
    """Open a new shift for a cash register with pessimistic locking and uniqueness guard."""
    maximum = 2**63 - 1
    if not isinstance(denomination_counts, list) or not denomination_counts:
        raise ValueError("At least one opening denomination count is required.")
    total = 0
    seen: set[int] = set()
    validated_counts: list[tuple[int, int]] = []
    for item in denomination_counts:
        if not isinstance(item, dict):
            raise ValueError("Opening denomination counts must be mappings.")
        denomination = item.get("denomination_minor")
        quantity = item.get("quantity")
        if type(denomination) is not int or not 0 < denomination <= maximum:
            raise ValueError("Denominations must be positive signed 64-bit integers.")
        if type(quantity) is not int or not 0 <= quantity <= maximum:
            raise ValueError("Quantities must be nonnegative signed 64-bit integers.")
        if denomination in seen:
            raise ValueError("Opening denomination counts cannot contain duplicates.")
        seen.add(denomination)
        value = denomination * quantity
        if value > maximum or total > maximum - value:
            raise ValueError("Opening denomination total exceeds signed 64-bit minor units.")
        total += value
        validated_counts.append((denomination, quantity))
    if type(opening_cash_minor) is int and opening_cash_minor < 0:
        raise ValueError("Opening cash cannot be negative.")
    if opening_cash_minor is not None and (
        type(opening_cash_minor) is not int or opening_cash_minor != total
    ):
        raise ValueError("Opening cash total must match denomination counts.")
    opening_cash_minor = total

    # 1. Lock the CashRegister row
    stmt = select(CashRegister).where(CashRegister.id == register_id).with_for_update()
    register = session.scalar(stmt)
    if register is None:
        raise CashRegisterNotFoundError(f"Cash register {register_id} not found.")

    # 2. Check for active shift
    active_shift_stmt = (
        select(Shift)
        .where(
            Shift.cash_register_id == register_id,
            Shift.status.in_(["open", "closing"]),
        )
        .with_for_update()
    )
    existing_shift = session.scalar(active_shift_stmt)
    if existing_shift is not None:
        raise ShiftAlreadyOpenError(
            f"An open shift is already active on cash register {register_id}."
        )

    # 3. Create shift and flush to trigger DB constraints
    shift = Shift(
        cash_register_id=register_id,
        opened_by=opened_by,
        opening_cash_minor=opening_cash_minor,
        status="open",
    )
    shift.denomination_counts = [
        ShiftDenominationCount(denomination_minor=denomination, quantity=quantity)
        for denomination, quantity in validated_counts
    ]
    session.add(shift)
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise ShiftAlreadyOpenError(
            f"An open shift is already active on cash register {register_id}."
        ) from exc

    return shift


def get_shift_by_id(
    session: Session,
    shift_id: UUID,
) -> Shift | None:
    """Retrieve a shift by ID."""
    stmt = select(Shift).where(Shift.id == shift_id)
    return session.scalar(stmt)


def to_payment_terminal_dto(terminal: PaymentTerminal) -> PaymentTerminalDTO:
    """Convert PaymentTerminal model to PaymentTerminalDTO."""
    return PaymentTerminalDTO.model_validate(terminal)


def to_cash_register_dto(
    register: CashRegister,
    has_open_shift: bool = False,
) -> CashRegisterDTO:
    """Convert CashRegister model to CashRegisterDTO."""
    dto = CashRegisterDTO.model_validate(register)
    dto.has_open_shift = has_open_shift
    return dto


def to_shift_dto(shift: Shift) -> ShiftDTO:
    """Convert Shift model to ShiftDTO."""
    return ShiftDTO.model_validate(shift)
