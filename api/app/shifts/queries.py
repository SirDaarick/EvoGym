"""Database queries and operations for terminals, cash registers, and shifts."""
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.db.models.orders import Order, OrderItem, Payment
from app.db.models.membership_debt_payments import MembershipDebtPayment
from app.db.models.shifts import (
    CashRegister,
    PaymentTerminal,
    Shift,
    ShiftClosingDenominationCount,
    ShiftDenominationCount,
    ShiftInventoryObservation,
    ShiftInventoryReview,
)
from app.inventory.queries import validate_opening_inventory_snapshot
from app.shifts.schemas import (
    CashRegisterDTO,
    PaymentTerminalDTO,
    ShiftDTO,
    ShiftInventoryReviewDTO,
)


class ShiftAlreadyOpenError(Exception):
    """Raised when opening a shift on a register that already has an active open shift."""


class CashRegisterNotFoundError(Exception):
    """Raised when a specified cash register cannot be found."""


class ShiftNotFoundError(Exception):
    """Raised when a shift cannot be found."""


class ShiftCloseConflictError(Exception):
    """Raised when a shift cannot be closed or a frozen close is retried differently."""


@dataclass(frozen=True)
class ShiftCloseResult:
    shift: Shift
    replayed: bool


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
        .options(
            selectinload(Shift.inventory_review).joinedload(ShiftInventoryReview.snapshot),
            selectinload(Shift.inventory_review).selectinload(ShiftInventoryReview.observations),
        )
        .order_by(Shift.opened_at.desc())
    )
    return session.scalar(stmt)


def open_shift(
    session: Session,
    register_id: UUID,
    opened_by: UUID,
    denomination_counts: list[dict[str, int]],
    inventory_snapshot_id: UUID,
    inventory_observations: list[dict[str, object]] | None = None,
    opening_cash_minor: int | None = None,
) -> Shift:
    """Open a new shift for a cash register with pessimistic locking and uniqueness guard."""
    maximum = 2**63 - 1
    if not isinstance(denomination_counts, list):
        raise ValueError("Opening denomination counts must be a list.")
    if not denomination_counts and (
        type(opening_cash_minor) is not int or not 0 <= opening_cash_minor <= maximum
    ):
        raise ValueError("An explicit valid opening cash total is required without denomination counts.")
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
    if denomination_counts and opening_cash_minor is not None and (
        type(opening_cash_minor) is not int or opening_cash_minor != total
    ):
        raise ValueError("Opening cash total must match denomination counts.")
    if denomination_counts:
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

    snapshot, snapshot_items = validate_opening_inventory_snapshot(
        session, register_id=register_id, branch_id=register.branch_id, snapshot_id=inventory_snapshot_id
    )
    observations = [] if inventory_observations is None else inventory_observations
    if not isinstance(observations, list):
        raise ValueError("Inventory observations must be a list.")
    seen_products: set[UUID] = set()
    persisted_observations: list[ShiftInventoryObservation] = []
    for item in observations:
        if not isinstance(item, dict):
            raise ValueError("Inventory observations must be mappings.")
        product_id = item.get("product_id")
        quantity = item.get("physical_quantity")
        reason = item.get("reason")
        if not isinstance(product_id, UUID) or product_id not in snapshot_items:
            raise ValueError("Inventory observation product is not present in the snapshot.")
        if product_id in seen_products:
            raise ValueError("Inventory observations cannot contain duplicate products.")
        if type(quantity) is not int or not 0 <= quantity <= maximum:
            raise ValueError("Physical quantities must be nonnegative signed 64-bit integers.")
        if reason is not None and not isinstance(reason, str):
            raise ValueError("Inventory observation reason must be text.")
        reason = reason.strip() if reason is not None else None
        if reason is not None and len(reason) > 500:
            raise ValueError("Inventory observation reason cannot exceed 500 characters.")
        snapshot_item = snapshot_items[product_id]
        if (
            snapshot_item.initialized
            and snapshot_item.expected_quantity is not None
            and quantity != snapshot_item.expected_quantity
            and not reason
        ):
            raise ValueError("A reason is required when physical inventory differs from the known baseline.")
        seen_products.add(product_id)
        persisted_observations.append(ShiftInventoryObservation(
            snapshot_item=snapshot_item, physical_quantity=quantity, reason=reason
        ))

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
    shift.inventory_review = ShiftInventoryReview(
        snapshot_id=snapshot.id,
        confirmed_by=opened_by,
        mode="physical_counts_reported" if persisted_observations else "no_changes_declared",
        observations=persisted_observations,
    )
    session.add(shift)
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise ShiftAlreadyOpenError(
            f"An open shift is already active on cash register {register_id}."
        ) from exc

    # The mandatory opening count already includes pending overtime cash. Link it
    # under the same register lock and mark it as part of the physical baseline.
    session.execute(
        update(Order)
        .where(
            Order.register_id == register_id,
            Order.is_overtime.is_(True),
            Order.financial_shift_id.is_(None),
        )
        .values(financial_shift_id=shift.id, cash_included_in_opening=True)
    )
    session.flush()

    return shift


def close_shift(
    session: Session,
    *,
    shift_id: UUID,
    closed_by: UUID,
    denomination_counts: list[dict[str, int]] | None,
    counted_cash_minor: int | None = None,
    closing_notes: str | None = None,
    now: datetime | None = None,
) -> ShiftCloseResult:
    """Freeze a shift's physical cash cut while serializing against register posting/opening."""
    maximum = 2**63 - 1
    if (denomination_counts is None) == (counted_cash_minor is None):
        raise ValueError("Provide either closing denomination counts or a manual counted total.")
    if denomination_counts is not None and (not isinstance(denomination_counts, list) or not denomination_counts):
        raise ValueError("At least one closing denomination count is required.")
    if counted_cash_minor is not None and (type(counted_cash_minor) is not int or not 0 <= counted_cash_minor <= maximum):
        raise ValueError("Counted cash must be a nonnegative signed 64-bit integer.")
    if closing_notes is not None:
        if not isinstance(closing_notes, str) or len(closing_notes.strip()) > 500:
            raise ValueError("Closing notes must be at most 500 characters.")
        closing_notes = closing_notes.strip() or None
    total_counted = counted_cash_minor if counted_cash_minor is not None else 0
    seen: set[int] = set()
    validated: list[tuple[int, int]] = []
    for item in denomination_counts or []:
        if not isinstance(item, dict):
            raise ValueError("Closing denomination counts must be mappings.")
        denomination = item.get("denomination_minor")
        quantity = item.get("quantity")
        if type(denomination) is not int or not 0 < denomination <= maximum:
            raise ValueError("Denominations must be positive signed 64-bit integers.")
        if type(quantity) is not int or not 0 <= quantity <= maximum:
            raise ValueError("Quantities must be nonnegative signed 64-bit integers.")
        if denomination in seen:
            raise ValueError("Closing denomination counts cannot contain duplicates.")
        seen.add(denomination)
        value = denomination * quantity
        if value > maximum or total_counted > maximum - value:
            raise ValueError("Closing denomination total exceeds signed 64-bit minor units.")
        total_counted += value
        validated.append((denomination, quantity))

    register_id = session.scalar(select(Shift.cash_register_id).where(Shift.id == shift_id))
    if register_id is None:
        raise ShiftNotFoundError("Shift not found.")
    register = session.scalar(
        select(CashRegister).where(CashRegister.id == register_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if register is None:
        raise CashRegisterNotFoundError("Cash register not found.")
    shift = session.scalar(
        select(Shift).where(Shift.id == shift_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if shift is None:
        raise ShiftNotFoundError("Shift not found.")

    if shift.status == "closed":
        stored = sorted(
            (item.denomination_minor, item.quantity) for item in shift.closing_denomination_counts
        )
        same_counts = denomination_counts is not None and stored == sorted(validated)
        same_manual = denomination_counts is None and not stored and shift.counted_cash_minor == total_counted
        if not (same_counts or same_manual) or shift.closing_notes != closing_notes:
            raise ShiftCloseConflictError("A closed shift's cash cut cannot be changed.")
        return ShiftCloseResult(shift, replayed=True)
    if shift.status != "open":
        raise ShiftCloseConflictError("Only an open shift can be closed.")

    expected = expected_cash_for_shift(session, shift)
    shift.closed_by = closed_by
    shift.closed_at = now or datetime.now(timezone.utc)
    shift.expected_cash_at_close_minor = expected
    shift.counted_cash_minor = total_counted
    shift.difference_minor = total_counted - expected
    shift.closing_notes = closing_notes
    shift.status = "closed"
    shift.closing_denomination_counts = [
        ShiftClosingDenominationCount(denomination_minor=denomination, quantity=quantity)
        for denomination, quantity in validated
    ]
    session.flush()
    return ShiftCloseResult(shift, replayed=False)


def expected_cash_for_shift(session: Session, shift: Shift) -> int:
    """Calculate current expected cash from the same authoritative sources used by close."""
    maximum = 2**63 - 1
    inflow = 0
    amounts = session.scalars(
        select(Payment.amount_minor)
        .join(Order, Order.id == Payment.order_id)
        .where(
            Order.financial_shift_id == shift.id,
            Order.cash_included_in_opening.is_(False),
            Payment.method == "cash",
            Payment.status == "confirmed",
        )
    )
    for amount in amounts:
        if type(amount) is not int or amount < 0 or inflow > maximum - amount:
            raise ValueError("Cash inflow exceeds signed 64-bit minor units.")
        inflow += amount
    repayment_amounts = session.scalars(
        select(MembershipDebtPayment.amount_minor).where(MembershipDebtPayment.shift_id == shift.id)
    )
    for amount in repayment_amounts:
        if type(amount) is not int or amount <= 0 or inflow > maximum - amount:
            raise ValueError("Cash repayment inflow exceeds signed 64-bit minor units.")
        inflow += amount
    if type(shift.opening_cash_minor) is not int or shift.opening_cash_minor < 0:
        raise ValueError("Opening cash is outside supported minor-unit bounds.")
    if shift.opening_cash_minor > maximum - inflow:
        raise ValueError("Expected closing cash exceeds signed 64-bit minor units.")
    return shift.opening_cash_minor + inflow


def shift_financial_summary(session: Session, shift: Shift) -> dict[str, object]:
    """Return only canonical order and membership-debt payment activity for a shift."""
    payment_rows = session.execute(
        select(Payment, Order)
        .join(Order, Order.id == Payment.order_id)
        .where(or_(
            Order.financial_shift_id == shift.id,
            and_(Order.shift_id == shift.id, Payment.method == "transfer"),
        ))
        .order_by(Payment.received_at.desc(), Payment.id.desc())
    ).all()
    debt_rows = session.execute(
        select(MembershipDebtPayment)
        .where(MembershipDebtPayment.shift_id == shift.id)
        .order_by(MembershipDebtPayment.created_at.desc(), MembershipDebtPayment.id.desc())
    ).scalars().all()

    payments: list[dict[str, object]] = []
    confirmed_minor = 0
    cash_minor = 0
    pending_transfer_minor = 0
    methods: dict[str, dict[str, int | str]] = {}
    for payment, order in payment_rows:
        item = session.scalar(
            select(OrderItem.description_snapshot)
            .where(OrderItem.order_id == order.id)
            .order_by(OrderItem.line_number)
            .limit(1)
        )
        description = item or "Membresía"
        payments.append({"id": payment.id, "description": description, "method": payment.method,
                         "status": payment.status, "amount_minor": payment.amount_minor,
                         "recorded_at": payment.received_at})
        if payment.status == "confirmed":
            confirmed_minor += payment.amount_minor
            bucket = methods.setdefault(payment.method, {"method": payment.method, "count": 0, "amount_minor": 0})
            bucket["count"] = int(bucket["count"]) + 1
            bucket["amount_minor"] = int(bucket["amount_minor"]) + payment.amount_minor
            if payment.method == "cash":
                cash_minor += payment.amount_minor
        elif payment.method == "transfer":
            pending_transfer_minor += payment.amount_minor

    for debt in debt_rows:
        payments.append({"id": debt.id, "description": "Abono de membresía", "method": "cash",
                         "status": "confirmed", "amount_minor": debt.amount_minor,
                         "recorded_at": debt.created_at})
        confirmed_minor += debt.amount_minor
        cash_minor += debt.amount_minor
        bucket = methods.setdefault("cash", {"method": "cash", "count": 0, "amount_minor": 0})
        bucket["count"] = int(bucket["count"]) + 1
        bucket["amount_minor"] = int(bucket["amount_minor"]) + debt.amount_minor

    payments.sort(key=lambda row: (row["recorded_at"], str(row["id"])), reverse=True)
    activities = ([{"family": "membership", "count": sum(int(method["count"]) for method in methods.values()),
                    "amount_minor": confirmed_minor}] if confirmed_minor else [])
    return {"shift_id": shift.id, "confirmed_minor": confirmed_minor, "confirmed_cash_minor": cash_minor,
            "pending_transfer_minor": pending_transfer_minor,
            "payment_methods": sorted(methods.values(), key=lambda item: str(item["method"])),
            "activities": activities, "payments": payments,
            "expected_cash_minor": expected_cash_for_shift(session, shift)}


def get_shift_by_id(
    session: Session,
    shift_id: UUID,
) -> Shift | None:
    """Retrieve a shift by ID."""
    stmt = select(Shift).where(Shift.id == shift_id).options(
        selectinload(Shift.inventory_review).joinedload(ShiftInventoryReview.snapshot),
        selectinload(Shift.inventory_review).selectinload(ShiftInventoryReview.observations),
    )
    return session.scalar(stmt)


def list_shifts_by_register(
    session: Session, *, register_id: UUID, offset: int = 0, limit: int = 50
) -> tuple[list[Shift], int]:
    """Return a bounded, newest-first history page for one cash register."""
    total = session.scalar(select(func.count()).select_from(Shift).where(Shift.cash_register_id == register_id)) or 0
    stmt = (
        select(Shift)
        .where(Shift.cash_register_id == register_id)
        .order_by(Shift.opened_at.desc(), Shift.id.desc())
        .offset(offset)
        .limit(limit)
        .options(
            selectinload(Shift.inventory_review).joinedload(ShiftInventoryReview.snapshot),
            selectinload(Shift.inventory_review).selectinload(ShiftInventoryReview.observations),
        )
    )
    return list(session.scalars(stmt).all()), total


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


def to_shift_dto(shift: Shift, session: Session | None = None) -> ShiftDTO:
    """Convert Shift model to ShiftDTO."""
    dto = ShiftDTO.model_validate({
        "id": shift.id,
        "cash_register_id": shift.cash_register_id,
        "opened_by": shift.opened_by,
        "closed_by": shift.closed_by,
        "opened_at": shift.opened_at,
        "closed_at": shift.closed_at,
        "status": shift.status,
        "opening_cash_minor": shift.opening_cash_minor,
        "denomination_counts": shift.denomination_counts,
        "closing_denomination_counts": shift.closing_denomination_counts,
        "expected_cash_at_close_minor": shift.expected_cash_at_close_minor,
        "current_expected_cash_minor": (
            expected_cash_for_shift(session, shift) if session is not None and shift.status == "open" else None
        ),
        "counted_cash_minor": shift.counted_cash_minor,
        "difference_minor": shift.difference_minor,
        "closing_notes": shift.closing_notes,
    })
    review = shift.inventory_review
    if review is not None:
        dto.inventory_review = ShiftInventoryReviewDTO.model_validate({
            "snapshot_id": review.snapshot_id,
            "confirmed_by": review.confirmed_by,
            "confirmed_at": review.confirmed_at,
            "mode": review.mode,
            "source_state": review.snapshot.source_state,
            "item_count": review.snapshot.item_count,
            "missing_count": review.snapshot.missing_count,
            "observations": [
                {
                    "product_id": observation.snapshot_item.product_id,
                    "code": observation.snapshot_item.code,
                    "name": observation.snapshot_item.name,
                    "unit": observation.snapshot_item.unit,
                    "physical_quantity": observation.physical_quantity,
                    "reason": observation.reason,
                }
                for observation in review.observations
            ],
        })
    return dto
