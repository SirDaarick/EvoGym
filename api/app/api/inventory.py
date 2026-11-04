"""Inventory HTTP transport: parse the request, call one `app.inventory.service` function, shape the response."""
from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import InterfaceError, OperationalError

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.inventory import service
from app.inventory.schemas import (
    BranchDTO,
    OpenContainerDTO,
    ProductCreateDTO,
    ProductDTO,
    ProductPageDTO,
    ProductUpdateDTO,
    StockInitializationCreateDTO,
    StockInitializationDTO,
    StockMovementCreateDTO,
    StockMovementDTO,
    StockMovementPageDTO,
    StockPageDTO,
)

router = APIRouter(prefix="/api/v1/inventory", tags=["inventory"])
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class InventoryActorPrincipal:
    staff_id: UUID
    is_admin: bool
    branch_id: UUID | None


def _actor(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> InventoryActorPrincipal:
    factory = request.app.state.session_factory
    settings = request.app.state.settings
    if factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")

    token = credentials.credentials

    # 1. Admin session
    if settings.admin_auth_configured and settings.admin_token_signing_configured:
        try:
            actor_id, _session_id = validate_admin_session(
                factory, token, settings.admin_token_signing_secret.get_secret_value()
            )
            return InventoryActorPrincipal(staff_id=actor_id, is_admin=True, branch_id=None)
        except AuthorizationDenied:
            pass
        except (OperationalError, InterfaceError, TimeoutError):
            raise HTTPException(503, "Authentication service unavailable.") from None

    # 2. Staff session with MEMBER_OPERATIONAL_READ
    try:
        principal = validate_session(factory, token, Permission.MEMBER_OPERATIONAL_READ)
        return InventoryActorPrincipal(
            staff_id=principal.staff_id,
            is_admin=False,
            branch_id=principal.branch_id,
        )
    except AuthorizationDenied:
        pass
    except (OperationalError, InterfaceError, TimeoutError):
        raise HTTPException(503, "Authentication service unavailable.") from None

    raise HTTPException(401, "Authentication failed.")


def _admin(
    principal: InventoryActorPrincipal = Depends(_actor),
) -> UUID:
    if not principal.is_admin:
        raise HTTPException(403, "Access restricted to admin.")
    return principal.staff_id


def _factory(request: Request):
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503, "Database unavailable.")
    return factory


@router.get("/branches", response_model=list[BranchDTO])
def list_branches_endpoint(request: Request, principal: InventoryActorPrincipal = Depends(_actor)):
    return service.list_branches(_factory(request))


@router.post("/products", response_model=ProductDTO, status_code=201)
def create_product_endpoint(payload: ProductCreateDTO, request: Request, actor_id: UUID = Depends(_admin)):
    return service.create_product(_factory(request), actor_id, payload)


@router.patch("/products/{product_id}", response_model=ProductDTO)
def update_product_endpoint(product_id: UUID, payload: ProductUpdateDTO, request: Request, actor_id: UUID = Depends(_admin)):
    return service.update_product(_factory(request), product_id, payload)


@router.get("/products", response_model=ProductPageDTO)
def list_products_endpoint(
    request: Request,
    offset: int = Query(0, ge=0, le=2**63 - 1),
    limit: int = Query(50, ge=1, le=100),
    actor_id: UUID = Depends(_admin),
):
    return service.list_products(_factory(request), offset, limit)


@router.post("/branches/{branch_id}/initializations", response_model=StockInitializationDTO, status_code=201)
def initialize_endpoint(
    branch_id: UUID,
    payload: StockInitializationCreateDTO,
    request: Request,
    actor_id: UUID = Depends(_admin),
):
    return service.initialize_stock(_factory(request), actor_id, branch_id, payload)


@router.get("/branches/{branch_id}/stock", response_model=StockPageDTO)
def list_stock_endpoint(
    branch_id: UUID,
    request: Request,
    offset: int = Query(0, ge=0, le=2**63 - 1),
    limit: int = Query(50, ge=1, le=100),
    principal: InventoryActorPrincipal = Depends(_actor),
):
    return service.list_stock(_factory(request), principal, branch_id, offset, limit)


@router.post("/branches/{branch_id}/open-container", status_code=201)
def open_container_endpoint(branch_id: UUID, payload: OpenContainerDTO, request: Request, response: Response, principal: InventoryActorPrincipal = Depends(_actor)):
    if not service.open_container(_factory(request), principal, branch_id, payload):
        response.status_code = 200
    return {"opened": True}


@router.post("/branches/{branch_id}/movements", response_model=StockMovementDTO, status_code=201)
def record_movement_endpoint(
    branch_id: UUID,
    payload: StockMovementCreateDTO,
    request: Request,
    response: Response,
    principal: InventoryActorPrincipal = Depends(_actor),
    idempotency_key_header: str | None = Header(None, alias="Idempotency-Key"),
):
    dto, is_new = service.record_movement(_factory(request), principal, branch_id, payload, idempotency_key_header)
    if not is_new:
        response.status_code = 200
    return dto


@router.get("/branches/{branch_id}/movements", response_model=StockMovementPageDTO)
def list_movements_endpoint(
    branch_id: UUID,
    request: Request,
    offset: int = Query(0, ge=0, le=2**63 - 1),
    limit: int = Query(50, ge=1, le=100),
    principal: InventoryActorPrincipal = Depends(_actor),
):
    return service.list_movements(_factory(request), principal, branch_id, offset, limit)
