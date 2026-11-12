"""Shifts HTTP transport: resolve the actor, call one `app.shifts.service` function, shape the response."""
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import InterfaceError, OperationalError, TimeoutError

from app.api.deps import SessionDep
from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.inventory.schemas import RegisterInventorySnapshotDTO
from app.shifts import service
from app.shifts.schemas import (
    CashRegisterDTO, CloseShiftDTO, CreateCashRegisterDTO, CreatePaymentTerminalDTO, OpenShiftDTO,
    PaymentTerminalDTO, ShiftCloseDraftInputDTO, ShiftDTO, ShiftPageDTO, ShiftSummaryDTO,
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


Principal = Annotated[ShiftActorPrincipal, Depends(get_shift_actor_principal)]


@router.get("/terminals", response_model=list[PaymentTerminalDTO])
def list_terminals_endpoint(
    principal: Principal, *, session: SessionDep,
    branch_id: UUID | None = Query(None, description="Optional branch filter for admin."),
) -> list[PaymentTerminalDTO]:
    return service.list_terminals(session, principal, branch_id)


@router.post("/terminals", response_model=PaymentTerminalDTO, status_code=201)
def create_terminal_endpoint(
    payload: CreatePaymentTerminalDTO, principal: Principal, *, session: SessionDep,
) -> PaymentTerminalDTO:
    return service.create_terminal(session, principal, payload)


@router.get("/registers", response_model=list[CashRegisterDTO])
def list_registers_endpoint(
    principal: Principal, *, session: SessionDep,
    branch_id: UUID | None = Query(None, description="Optional branch filter for admin."),
) -> list[CashRegisterDTO]:
    return service.list_registers(session, principal, branch_id)


@router.post("/registers", response_model=CashRegisterDTO, status_code=201)
def create_register_endpoint(
    payload: CreateCashRegisterDTO, principal: Principal, *, session: SessionDep,
) -> CashRegisterDTO:
    return service.create_register(session, principal, payload)


@router.get("/shifts/current", response_model=ShiftDTO)
def get_current_shift_endpoint(
    principal: Principal, *, session: SessionDep,
    register_id: UUID = Query(..., description="Cash register UUID."),
) -> ShiftDTO:
    return service.get_current_shift(session, principal, register_id)


@router.post("/shifts/open", response_model=ShiftDTO, status_code=201)
def open_shift_endpoint(payload: OpenShiftDTO, principal: Principal, *, session: SessionDep) -> ShiftDTO:
    return service.open_shift(session, principal, payload)


@router.post("/shifts/{shift_id}/close", response_model=ShiftDTO, status_code=201)
def close_shift_endpoint(
    shift_id: UUID, payload: CloseShiftDTO, response: Response, principal: Principal, *, session: SessionDep,
) -> ShiftDTO:
    dto, replayed = service.close_shift(session, principal, shift_id, payload)
    if replayed:
        response.status_code = 200
    return dto


@router.put("/shifts/{shift_id}/close-draft", response_model=ShiftDTO)
def save_close_draft_endpoint(
    shift_id: UUID, payload: ShiftCloseDraftInputDTO, principal: Principal, *, session: SessionDep,
) -> ShiftDTO:
    return service.save_close_draft(session, principal, shift_id, payload)


@router.get("/shifts/{shift_id}", response_model=ShiftDTO)
def get_shift_endpoint(shift_id: UUID, principal: Principal, *, session: SessionDep) -> ShiftDTO:
    return service.get_shift(session, principal, shift_id)


@router.get("/shifts/{shift_id}/summary", response_model=ShiftSummaryDTO)
def get_shift_summary_endpoint(shift_id: UUID, principal: Principal, *, session: SessionDep) -> ShiftSummaryDTO:
    return service.get_shift_summary(session, principal, shift_id)


@router.get("/shifts", response_model=ShiftPageDTO)
def list_shifts_endpoint(
    principal: Principal, *, session: SessionDep,
    register_id: UUID = Query(..., description="Cash register UUID."),
    offset: int = Query(0, ge=0, le=2**63 - 1),
    limit: int = Query(50, ge=1, le=100),
) -> ShiftPageDTO:
    return service.list_shifts(session, principal, register_id, offset, limit)


@router.post(
    "/registers/{register_id}/inventory-snapshots",
    response_model=RegisterInventorySnapshotDTO,
    status_code=201,
)
def capture_register_inventory_snapshot_endpoint(
    register_id: UUID, principal: Principal, *, session: SessionDep,
) -> RegisterInventorySnapshotDTO:
    return service.capture_inventory_snapshot(session, principal, register_id)


@router.get(
    "/registers/{register_id}/inventory-snapshots/{snapshot_id}",
    response_model=RegisterInventorySnapshotDTO,
)
def get_register_inventory_snapshot_endpoint(
    register_id: UUID, snapshot_id: UUID, principal: Principal, *, session: SessionDep,
) -> RegisterInventorySnapshotDTO:
    return service.get_inventory_snapshot(session, principal, register_id, snapshot_id)
