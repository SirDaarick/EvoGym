"""Shift, register and terminal use cases: access checks, orchestration, commits.

SQL lives in `app.shifts.queries`; HTTP transport lives in `app.api.shifts`. Failures are
raised as `HttpStatusError`s (never HTTPException). Every use case is a single transaction,
so each takes a `session`.
"""
from typing import Protocol
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.errors import HttpStatusError, http_errors
from app.inventory.queries import (
    InventorySnapshotConsumedError,
    InventorySnapshotStaleError,
    InventorySnapshotUnavailableError,
    capture_register_inventory_snapshot,
    get_register_inventory_snapshot,
)
from app.inventory.schemas import RegisterInventorySnapshotDTO
from app.shifts import queries as q
from app.shifts.queries import CashRegisterNotFoundError, ShiftAlreadyOpenError, ShiftCloseConflictError, ShiftNotFoundError
from app.shifts.schemas import (
    CashRegisterDTO, CloseShiftDTO, CreateCashRegisterDTO, CreatePaymentTerminalDTO, OpenShiftDTO,
    PaymentTerminalDTO, ShiftCloseDraftInputDTO, ShiftDTO, ShiftPageDTO, ShiftSummaryDTO,
)


class Principal(Protocol):
    staff_id: UUID
    branch_id: UUID | None
    is_admin: bool


def _uuid(value: str) -> UUID:
    try:
        return UUID(value)
    except (ValueError, TypeError):
        raise HttpStatusError(422) from None


def _require_admin(principal: Principal) -> None:
    if not principal.is_admin:
        raise HttpStatusError(403)


def _require_branch(principal: Principal, branch_id: UUID) -> None:
    if not principal.is_admin and branch_id != principal.branch_id:
        raise HttpStatusError(403)


def _get_register(session, principal: Principal, register_id: UUID, *, denied: int = 403):
    register = q.get_cash_register(session, register_id)
    if register is None:
        raise HttpStatusError(404)
    if not principal.is_admin and register.branch_id != principal.branch_id:
        raise HttpStatusError(denied)
    return register


def _get_shift(session, principal: Principal, shift_id: UUID):
    shift = q.get_shift_by_id(session, shift_id)
    if shift is None:
        raise HttpStatusError(404)
    _require_branch(principal, shift.cash_register.branch_id)
    return shift


# --- payment terminals -----------------------------------------------------------------------

def list_terminals(session, principal: Principal, branch_id: UUID | None) -> list[PaymentTerminalDTO]:
    if principal.is_admin:
        effective_branch = branch_id
    else:
        if branch_id is not None:
            _require_branch(principal, branch_id)
        effective_branch = principal.branch_id
    return [q.to_payment_terminal_dto(t) for t in q.list_payment_terminals(session, branch_id=effective_branch)]


def create_terminal(session, principal: Principal, payload: CreatePaymentTerminalDTO) -> PaymentTerminalDTO:
    _require_admin(principal)
    branch_uuid = _uuid(payload.branch_id)
    with http_errors((IntegrityError, 409)):
        terminal = q.create_payment_terminal(
            session, branch_id=branch_uuid, code=payload.code, name=payload.name, device_id=payload.device_id,
            provider=payload.provider, mp_store_id=payload.mp_store_id, mp_pos_id=payload.mp_pos_id,
        )
        session.commit()
        return q.to_payment_terminal_dto(terminal)


# --- cash registers --------------------------------------------------------------------------

def list_registers(session, principal: Principal, branch_id: UUID | None) -> list[CashRegisterDTO]:
    receptionist = not principal.is_admin and q.has_receptionist_grant(
        session, staff_id=principal.staff_id, branch_id=principal.branch_id
    )
    if not principal.is_admin and not receptionist:
        if branch_id is not None:
            _require_branch(principal, branch_id)
        effective_branch = principal.branch_id
    else:
        effective_branch = branch_id
    registers = q.list_cash_registers(session, branch_id=effective_branch)
    active_ids = q.get_active_register_ids(session)
    items: list[CashRegisterDTO] = []
    for register in registers:
        is_open = register.id in active_ids
        last_closed_id = q.get_latest_closed_shift_id(session, register.id)
        expected_opening: int | None = None
        if not is_open:
            expected, has_baseline = q.expected_opening_cash_for_register(session, register.id)
            if has_baseline:
                expected_opening = expected
        items.append(
            q.to_cash_register_dto(
                register,
                has_open_shift=is_open,
                last_closed_shift_id=last_closed_id,
                expected_opening_cash_minor=expected_opening,
            )
        )
    return items


def create_register(session, principal: Principal, payload: CreateCashRegisterDTO) -> CashRegisterDTO:
    _require_admin(principal)
    branch_uuid = _uuid(payload.branch_id)
    default_terminal_uuid = _uuid(payload.default_terminal_id) if payload.default_terminal_id else None
    with http_errors((IntegrityError, 409)):
        register = q.create_cash_register(
            session, branch_id=branch_uuid, code=payload.code, name=payload.name,
            default_terminal_id=default_terminal_uuid,
        )
        session.commit()
        return q.to_cash_register_dto(register, has_open_shift=False)


# --- shifts ----------------------------------------------------------------------------------

def get_current_shift(session, principal: Principal, register_id: UUID) -> ShiftDTO:
    _get_register(session, principal, register_id)
    shift = q.get_open_shift(session, register_id)
    if shift is None:
        raise HttpStatusError(404)
    return q.to_shift_dto(shift, session=session)


def open_shift(session, principal: Principal, payload: OpenShiftDTO) -> ShiftDTO:
    register_uuid = _uuid(payload.cash_register_id)
    _get_register(session, principal, register_uuid)
    notes = (payload.notes or payload.opening_notes or "").strip() or None
    with http_errors(
        (ShiftAlreadyOpenError, 409), (CashRegisterNotFoundError, 404), (InventorySnapshotUnavailableError, 404),
        (InventorySnapshotStaleError, 409), (InventorySnapshotConsumedError, 409), (ValueError, 422),
    ):
        shift = q.open_shift(
            session,
            register_id=register_uuid,
            opened_by=principal.staff_id,
            opening_cash_minor=payload.opening_cash_minor,
            denomination_counts=[item.model_dump() for item in payload.denomination_counts or []],
            inventory_snapshot_id=payload.inventory_snapshot_id,
            inventory_observations=[item.model_dump() for item in payload.inventory_observations],
            notes=notes,
        )
        session.commit()
        return q.to_shift_dto(shift, session=session)


def close_shift(session, principal: Principal, shift_id: UUID, payload: CloseShiftDTO) -> tuple[ShiftDTO, bool]:
    """Return the closed shift and whether this was an idempotent replay."""
    with http_errors(
        (ShiftNotFoundError, 404), (CashRegisterNotFoundError, 404), (ShiftCloseConflictError, 409), (ValueError, 422),
    ):
        observed = q.get_shift_by_id(session, shift_id)
        if observed is None:
            raise HttpStatusError(404)
        if not principal.is_admin and observed.cash_register.branch_id != principal.branch_id:
            raise HttpStatusError(404)
        closing_notes = (payload.closing_notes or payload.notes or "").strip() or None
        result = q.close_shift(
            session,
            shift_id=shift_id,
            closed_by=principal.staff_id,
            denomination_counts=(
                [item.model_dump() for item in payload.denomination_counts]
                if payload.denomination_counts is not None else None
            ),
            counted_cash_minor=payload.counted_cash_minor if payload.denomination_counts is None else None,
            closing_notes=closing_notes,
        )
        session.commit()
        return q.to_shift_dto(result.shift, session=session), result.replayed


def save_close_draft(
    session,
    principal: Principal,
    shift_id: UUID,
    payload: ShiftCloseDraftInputDTO,
) -> ShiftDTO:
    """Persist a progressive closing draft while the shift stays open."""
    with http_errors(
        (ShiftNotFoundError, 404), (CashRegisterNotFoundError, 404), (ShiftCloseConflictError, 409), (ValueError, 422),
    ):
        _get_shift(session, principal, shift_id)
        shift = q.save_shift_close_draft(
            session,
            shift_id=shift_id,
            draft=payload.model_dump(mode="json"),
        )
        session.commit()
        return q.to_shift_dto(shift, session=session)


def get_shift(session, principal: Principal, shift_id: UUID) -> ShiftDTO:
    return q.to_shift_dto(_get_shift(session, principal, shift_id), session=session)


def get_shift_summary(session, principal: Principal, shift_id: UUID) -> ShiftSummaryDTO:
    shift = _get_shift(session, principal, shift_id)
    return ShiftSummaryDTO.model_validate(q.shift_financial_summary(session, shift))


def list_shifts(session, principal: Principal, register_id: UUID, offset: int, limit: int) -> ShiftPageDTO:
    _get_register(session, principal, register_id)
    shifts, total = q.list_shifts_by_register(session, register_id=register_id, offset=offset, limit=limit)
    return ShiftPageDTO(
        items=[q.to_shift_dto(shift, session=session) for shift in shifts],
        total=total, offset=offset, limit=limit,
    )


# --- register inventory snapshots ------------------------------------------------------------

def capture_inventory_snapshot(session, principal: Principal, register_id: UUID) -> RegisterInventorySnapshotDTO:
    register = _get_register(session, principal, register_id, denied=404)
    snapshot = capture_register_inventory_snapshot(session, register_id=register.id, actor_id=principal.staff_id)
    session.commit()
    return RegisterInventorySnapshotDTO.model_validate(snapshot)


def get_inventory_snapshot(
    session, principal: Principal, register_id: UUID, snapshot_id: UUID
) -> RegisterInventorySnapshotDTO:
    register = _get_register(session, principal, register_id, denied=404)
    snapshot = get_register_inventory_snapshot(session, register_id=register.id, snapshot_id=snapshot_id)
    if snapshot is None or snapshot.branch_id != register.branch_id:
        raise HttpStatusError(404)
    return RegisterInventorySnapshotDTO.model_validate(snapshot)
