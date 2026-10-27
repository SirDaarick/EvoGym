"""Shifts, registers, and payment terminals API router."""
from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import IntegrityError, InterfaceError, OperationalError, TimeoutError

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.inventory.queries import (
    InventorySnapshotConsumedError,
    InventorySnapshotStaleError,
    InventorySnapshotUnavailableError,
    capture_register_inventory_snapshot,
    get_register_inventory_snapshot,
)
from app.inventory.schemas import RegisterInventorySnapshotDTO
from app.shifts.queries import (
    CashRegisterNotFoundError,
    ShiftCloseConflictError,
    ShiftNotFoundError,
    ShiftAlreadyOpenError,
    create_cash_register,
    create_payment_terminal,
    close_shift,
    get_active_register_ids,
    get_cash_register,
    get_open_shift,
    get_shift_by_id,
    list_shifts_by_register,
    list_cash_registers,
    list_payment_terminals,
    open_shift,
    shift_financial_summary,
    to_cash_register_dto,
    to_payment_terminal_dto,
    to_shift_dto,
)
from app.shifts.schemas import (
    CashRegisterDTO,
    CloseShiftDTO,
    CreateCashRegisterDTO,
    CreatePaymentTerminalDTO,
    OpenShiftDTO,
    PaymentTerminalDTO,
    ShiftDTO,
    ShiftPageDTO,
    ShiftSummaryDTO,
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

    # 1. Admin Bearer, only when token verification is configured.
    settings = request.app.state.settings
    if settings.admin_auth_configured and settings.admin_token_signing_configured:
        try:
            staff_id, _session_id = validate_admin_session(
                factory, token, settings.admin_token_signing_secret.get_secret_value()
            )
            return ShiftActorPrincipal(staff_id=staff_id, is_admin=True, branch_id=None)
        except AuthorizationDenied:
            pass
        except (OperationalError, InterfaceError, TimeoutError):
            raise HTTPException(503, "Authentication service unavailable.") from None

    # 2. Staff Bearer with operational permission
    try:
        principal = validate_session(factory, token, Permission.MEMBER_OPERATIONAL_READ)
        return ShiftActorPrincipal(
            staff_id=principal.staff_id,
            is_admin=False,
            branch_id=principal.branch_id,
        )
    except AuthorizationDenied:
        pass
    except (OperationalError, InterfaceError, TimeoutError):
        raise HTTPException(503, "Authentication service unavailable.") from None

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

        return to_shift_dto(shift, session=session)


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
                denomination_counts=[item.model_dump() for item in payload.denomination_counts or []],
                inventory_snapshot_id=payload.inventory_snapshot_id,
                inventory_observations=[item.model_dump() for item in payload.inventory_observations],
            )
            session.commit()
            return to_shift_dto(shift, session=session)
        except ShiftAlreadyOpenError:
            raise HTTPException(
                409,
                "An open shift is already active on this cash register.",
            )
        except CashRegisterNotFoundError:
            raise HTTPException(404, "Cash register not found.")
        except InventorySnapshotUnavailableError as exc:
            raise HTTPException(404, str(exc))
        except (InventorySnapshotStaleError, InventorySnapshotConsumedError) as exc:
            raise HTTPException(409, str(exc))
        except ValueError as exc:
            raise HTTPException(422, str(exc))


@router.post("/shifts/{shift_id}/close", response_model=ShiftDTO, status_code=201)
def close_shift_endpoint(
    shift_id: UUID,
    payload: CloseShiftDTO,
    request: Request,
    response: Response,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> ShiftDTO:
    """Persist and freeze physical cash evidence for an open shift."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    try:
        with factory() as session:
            observed = get_shift_by_id(session, shift_id)
            if observed is None:
                raise HTTPException(404, "Shift not found.")
            if not principal.is_admin and observed.cash_register.branch_id != principal.branch_id:
                raise HTTPException(404, "Shift not found.")
            result = close_shift(
                session,
                shift_id=shift_id,
                closed_by=principal.staff_id,
                denomination_counts=(
                    [item.model_dump() for item in payload.denomination_counts]
                    if payload.denomination_counts is not None else None
                ),
                counted_cash_minor=(
                    payload.counted_cash_minor if payload.denomination_counts is None else None
                ),
                closing_notes=payload.closing_notes,
            )
            session.commit()
            if result.replayed:
                response.status_code = 200
            return to_shift_dto(result.shift)
    except HTTPException:
        raise
    except ShiftNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except CashRegisterNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ShiftCloseConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


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

        return to_shift_dto(shift, session=session)


@router.get("/shifts/{shift_id}/summary", response_model=ShiftSummaryDTO)
def get_shift_summary_endpoint(
    shift_id: UUID,
    request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> ShiftSummaryDTO:
    """Read the supported canonical payment summary for a shift."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        shift = get_shift_by_id(session, shift_id)
        if shift is None:
            raise HTTPException(404, "Shift not found.")
        if not principal.is_admin and shift.cash_register.branch_id != principal.branch_id:
            raise HTTPException(403, "Access restricted to staff branch.")
        if shift.status == "open":
            summary = shift_financial_summary(session, shift)
        else:
            summary = shift_financial_summary(session, shift)
        return ShiftSummaryDTO.model_validate(summary)


@router.get("/shifts", response_model=ShiftPageDTO)
def list_shifts_endpoint(
    request: Request,
    register_id: UUID = Query(..., description="Cash register UUID."),
    offset: int = Query(0, ge=0, le=2**63 - 1),
    limit: int = Query(50, ge=1, le=100),
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> ShiftPageDTO:
    """Retrieve a paged history for one cash register."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        register = get_cash_register(session, register_id)
        if register is None:
            raise HTTPException(404, "Cash register not found.")
        if not principal.is_admin and register.branch_id != principal.branch_id:
            raise HTTPException(403, "Access restricted to staff branch.")
        shifts, total = list_shifts_by_register(session, register_id=register_id, offset=offset, limit=limit)
        return ShiftPageDTO(
            items=[to_shift_dto(shift, session=session) for shift in shifts],
            total=total,
            offset=offset,
            limit=limit,
        )


@router.post(
    "/registers/{register_id}/inventory-snapshots",
    response_model=RegisterInventorySnapshotDTO,
    status_code=201,
)
def capture_register_inventory_snapshot_endpoint(
    register_id: UUID,
    request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> RegisterInventorySnapshotDTO:
    """Capture the full piece catalog currently presented for this register's branch."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    with factory() as session:
        register = get_cash_register(session, register_id)
        if register is None:
            raise HTTPException(404, "Cash register not found.")
        if not principal.is_admin and register.branch_id != principal.branch_id:
            raise HTTPException(404, "Cash register not found.")

        snapshot = capture_register_inventory_snapshot(
            session, register_id=register.id, actor_id=principal.staff_id
        )
        session.commit()
        return RegisterInventorySnapshotDTO.model_validate(snapshot)


@router.get(
    "/registers/{register_id}/inventory-snapshots/{snapshot_id}",
    response_model=RegisterInventorySnapshotDTO,
)
def get_register_inventory_snapshot_endpoint(
    register_id: UUID,
    snapshot_id: UUID,
    request: Request,
    principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
) -> RegisterInventorySnapshotDTO:
    """Read a stored observation after rechecking live register authorization."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")

    with factory() as session:
        register = get_cash_register(session, register_id)
        if register is None:
            raise HTTPException(404, "Cash register not found.")
        if not principal.is_admin and register.branch_id != principal.branch_id:
            raise HTTPException(404, "Cash register not found.")

        snapshot = get_register_inventory_snapshot(
            session, register_id=register.id, snapshot_id=snapshot_id
        )
        if snapshot is None or snapshot.branch_id != register.branch_id:
            raise HTTPException(404, "Inventory snapshot not found.")
        return RegisterInventorySnapshotDTO.model_validate(snapshot)
