"""Shifts, registers, and payment terminals API router."""
from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import IntegrityError

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.shifts.queries import (
    CashRegisterNotFoundError,
    ShiftAlreadyOpenError,
    create_cash_register,
    create_payment_terminal,
    get_active_register_ids,
    get_cash_register,
    get_open_shift,
    get_shift_by_id,
    list_cash_registers,
    list_payment_terminals,
    open_shift,
    to_cash_register_dto,
    to_payment_terminal_dto,
    to_shift_dto,
)
from app.shifts.schemas import (
    CashRegisterDTO,
    CreateCashRegisterDTO,
    CreatePaymentTerminalDTO,
    OpenShiftDTO,
    PaymentTerminalDTO,
    ShiftDTO,
)

router = APIRouter(prefix="/api/v1", tags=["shifts"])
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class ShiftActorPrincipal:
    """Authenticated principal for shift and register operations."""

    staff_id: UUID
    is_admin: bool
    branch_id: UUID | None


def get_shift_actor_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> ShiftActorPrincipal:
    """Authenticate Admin or Staff actor for shift operations."""
    factory = request.app.state.session_factory
    if factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")

    token = credentials.credentials

    # 1. Admin Bearer
    try:
        staff_id, _session_id = validate_admin_session(factory, token)
        return ShiftActorPrincipal(staff_id=staff_id, is_admin=True, branch_id=None)
    except (AuthorizationDenied, ValueError):
        pass
    except Exception:
        pass

    # 2. Staff Bearer with operational permission
    try:
        principal = validate_session(factory, token, Permission.MEMBER_OPERATIONAL_READ)
        return ShiftActorPrincipal(
            staff_id=principal.staff_id,
            is_admin=False,
            branch_id=principal.branch_id,
        )
    except (AuthorizationDenied, ValueError):
        pass
    except Exception:
        pass

    raise HTTPException(401, "Authentication failed.")


# ==============================================================================
# Payment Terminals
# ==============================================================================


@router.get("/terminals", response_model=list[PaymentTerminalDTO])
def list_terminals_endpoint(
    request: Request,
    branch_id: UUID | None = Query(None, description="Optional branch filter for admin."),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> list[PaymentTerminalDTO]:
    """List payment terminals. Accessible by Staff (filtered to branch) or Admin."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    if not principal.is_admin:
        if branch_id is not None and branch_id != principal.branch_id:
            raise HTTPException(403, "Access restricted to staff branch.")
        effective_branch = principal.branch_id
    else:
        effective_branch = branch_id

    with factory() as session:
        terminals = list_payment_terminals(session, branch_id=effective_branch)
        return [to_payment_terminal_dto(t) for t in terminals]


@router.post("/terminals", response_model=PaymentTerminalDTO, status_code=201)
def create_terminal_endpoint(
    payload: CreatePaymentTerminalDTO,
    request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> PaymentTerminalDTO:
    """Create a new payment terminal. Admin only."""
    if not principal.is_admin:
        raise HTTPException(403, "Access restricted to admin.")

    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    try:
        branch_uuid = UUID(payload.branch_id)
    except (ValueError, TypeError):
        raise HTTPException(422, "Invalid branch_id UUID.")

    try:
        with factory() as session:
            terminal = create_payment_terminal(
                session,
                branch_id=branch_uuid,
                code=payload.code,
                name=payload.name,
                device_id=payload.device_id,
                provider=payload.provider,
                mp_store_id=payload.mp_store_id,
                mp_pos_id=payload.mp_pos_id,
            )
            session.commit()
            return to_payment_terminal_dto(terminal)
    except IntegrityError:
        raise HTTPException(
            409,
            f"A payment terminal with code '{payload.code}' already exists in this branch.",
        )


# ==============================================================================
# Cash Registers
# ==============================================================================


@router.get("/registers", response_model=list[CashRegisterDTO])
def list_registers_endpoint(
    request: Request,
    branch_id: UUID | None = Query(None, description="Optional branch filter for admin."),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> list[CashRegisterDTO]:
    """List cash registers. Accessible by Staff (filtered to branch) or Admin."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    if not principal.is_admin:
        if branch_id is not None and branch_id != principal.branch_id:
            raise HTTPException(403, "Access restricted to staff branch.")
        effective_branch = principal.branch_id
    else:
        effective_branch = branch_id

    with factory() as session:
        registers = list_cash_registers(session, branch_id=effective_branch)
        active_ids = get_active_register_ids(session)
        return [
            to_cash_register_dto(r, has_open_shift=(r.id in active_ids))
            for r in registers
        ]


@router.post("/registers", response_model=CashRegisterDTO, status_code=201)
def create_register_endpoint(
    payload: CreateCashRegisterDTO,
    request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> CashRegisterDTO:
    """Create a new cash register. Admin only."""
    if not principal.is_admin:
        raise HTTPException(403, "Access restricted to admin.")

    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    try:
        branch_uuid = UUID(payload.branch_id)
    except (ValueError, TypeError):
        raise HTTPException(422, "Invalid branch_id UUID.")

    default_terminal_uuid: UUID | None = None
    if payload.default_terminal_id:
        try:
            default_terminal_uuid = UUID(payload.default_terminal_id)
        except (ValueError, TypeError):
            raise HTTPException(422, "Invalid default_terminal_id UUID.")

    try:
        with factory() as session:
            register = create_cash_register(
                session,
                branch_id=branch_uuid,
                code=payload.code,
                name=payload.name,
                default_terminal_id=default_terminal_uuid,
            )
            session.commit()
            return to_cash_register_dto(register, has_open_shift=False)
    except IntegrityError:
        raise HTTPException(
            409,
            f"A cash register with code '{payload.code}' already exists in this branch.",
        )


# ==============================================================================
# Shifts
# ==============================================================================


@router.get("/shifts/current", response_model=ShiftDTO)
def get_current_shift_endpoint(
    request: Request,
    register_id: UUID = Query(..., description="Cash register UUID."),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> ShiftDTO:
    """Retrieve the current active open shift on a cash register."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    with factory() as session:
        register = get_cash_register(session, register_id)
        if register is None:
            raise HTTPException(404, "Cash register not found.")

        if not principal.is_admin and register.branch_id != principal.branch_id:
            raise HTTPException(403, "Access restricted to staff branch.")

        shift = get_open_shift(session, register_id)
        if shift is None:
            raise HTTPException(404, "No open shift found for this cash register.")

        return to_shift_dto(shift)


@router.post("/shifts/open", response_model=ShiftDTO, status_code=201)
def open_shift_endpoint(
    payload: OpenShiftDTO,
    request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> ShiftDTO:
    """Open a new shift on a cash register. Accessible by Staff or Admin."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    try:
        register_uuid = UUID(payload.cash_register_id)
    except (ValueError, TypeError):
        raise HTTPException(422, "Invalid cash_register_id UUID.")

    with factory() as session:
        register = get_cash_register(session, register_uuid)
        if register is None:
            raise HTTPException(404, "Cash register not found.")

        if not principal.is_admin and register.branch_id != principal.branch_id:
            raise HTTPException(403, "Access restricted to staff branch.")

        try:
            shift = open_shift(
                session,
                register_id=register_uuid,
                opened_by=principal.staff_id,
                opening_cash_minor=payload.opening_cash_minor,
                denomination_counts=[item.model_dump() for item in payload.denomination_counts],
            )
            session.commit()
            return to_shift_dto(shift)
        except ShiftAlreadyOpenError:
            raise HTTPException(
                409,
                "An open shift is already active on this cash register.",
            )
        except CashRegisterNotFoundError:
            raise HTTPException(404, "Cash register not found.")


@router.get("/shifts/{shift_id}", response_model=ShiftDTO)
def get_shift_endpoint(
    shift_id: UUID,
    request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> ShiftDTO:
    """Retrieve details of a specific shift by ID."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    with factory() as session:
        shift = get_shift_by_id(session, shift_id)
        if shift is None:
            raise HTTPException(404, "Shift not found.")

        if not principal.is_admin and shift.cash_register.branch_id != principal.branch_id:
            raise HTTPException(403, "Access restricted to staff branch.")

        return to_shift_dto(shift)
