"""Piece-counted product catalog and branch stock inventory API."""
from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, InterfaceError, OperationalError

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.inventory.queries import (
    IdempotencyConflictError,
    InactiveProductError,
    InsufficientStockError,
    create_product,
    get_on_hand_stock,
    initialize_stock,
    list_branches,
    list_branch_stock,
    list_products,
    list_stock_movements,
    record_stock_movement,
    update_product,
)
from app.inventory.schemas import (
    BranchDTO,
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
    StockRowDTO,
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
    with _factory(request)() as session:
        branches = list_branches(session)
        return [BranchDTO.model_validate(b) for b in branches]


@router.post("/products", response_model=ProductDTO, status_code=201)
def create_product_endpoint(payload: ProductCreateDTO, request: Request, actor_id: UUID = Depends(_admin)):
    factory = _factory(request)
    try:
        with factory.begin() as session:
            product = create_product(
                session,
                code=payload.code,
                name=payload.name,
                category=payload.category,
                price_minor=payload.price_minor,
                cost_minor=payload.cost_minor,
                unit=payload.unit,
                initial_quantity=payload.initial_quantity,
                initial_branch_id=payload.initial_branch_id,
                created_by=actor_id,
            )
            session.flush()
            return ProductDTO.model_validate(product)
    except IntegrityError as exc:
        msg = str(exc.orig)
        if "products.code" in msg or "uq_products_code" in msg:
            raise HTTPException(409, "A product with this code already exists.") from None
        raise


@router.patch("/products/{product_id}", response_model=ProductDTO)
def update_product_endpoint(product_id: UUID, payload: ProductUpdateDTO, request: Request, actor_id: UUID = Depends(_admin)):
    factory = _factory(request)
    try:
        with factory.begin() as session:
            product = update_product(
                session,
                product_id=product_id,
                name=payload.name,
                category=payload.category,
                price_minor=payload.price_minor,
                cost_minor=payload.cost_minor,
                is_active=payload.is_active,
            )
            return ProductDTO.model_validate(product)
    except LookupError:
        raise HTTPException(404, "Product not found.") from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("/products", response_model=ProductPageDTO)
def list_products_endpoint(
    request: Request,
    offset: int = Query(0, ge=0, le=2**63 - 1),
    limit: int = Query(50, ge=1, le=100),
    actor_id: UUID = Depends(_admin),
):
    with _factory(request)() as session:
        rows, total = list_products(session, offset=offset, limit=limit)
        return ProductPageDTO(items=[ProductDTO.model_validate(r) for r in rows], total=total)


@router.post("/branches/{branch_id}/initializations", response_model=StockInitializationDTO, status_code=201)
def initialize_endpoint(
    branch_id: UUID,
    payload: StockInitializationCreateDTO,
    request: Request,
    actor_id: UUID = Depends(_admin),
):
    try:
        with _factory(request).begin() as session:
            row = initialize_stock(
                session,
                branch_id=branch_id,
                product_id=payload.product_id,
                quantity=payload.quantity,
                actor_id=actor_id,
            )
            return StockInitializationDTO(
                id=row.id,
                branch_id=row.branch_id,
                product_id=row.product_id,
                quantity=row.quantity,
                initialized_by=row.initialized_by,
                initialized_at=row.initialized_at,
            )
    except LookupError as exc:
        raise HTTPException(404, f"The requested {exc.args[0]} was not found.") from None
    except IntegrityError as exc:
        detail = str(exc.orig)
        if not ("stock_initializations.branch_id" in detail or "uq_stock_initializations_branch_product" in detail):
            raise
        raise HTTPException(409, "Stock has already been initialized for this branch and product.") from None


@router.get("/branches/{branch_id}/stock", response_model=StockPageDTO)
def list_stock_endpoint(
    branch_id: UUID,
    request: Request,
    offset: int = Query(0, ge=0, le=2**63 - 1),
    limit: int = Query(50, ge=1, le=100),
    principal: InventoryActorPrincipal = Depends(_actor),
):
    try:
        with _factory(request)() as session:
            if not principal.is_admin and principal.branch_id != branch_id:
                from app.db.models import RoleGrant
                receptionist = session.scalar(select(RoleGrant.id).where(
                    RoleGrant.staff_id == principal.staff_id, RoleGrant.role == "receptionist",
                    RoleGrant.scope_kind == "branch", RoleGrant.branch_id == principal.branch_id,
                    RoleGrant.is_active.is_(True),
                )) is not None
                if not receptionist:
                    raise HTTPException(403, "Access restricted to your assigned branch.")
            rows, total = list_branch_stock(session, branch_id=branch_id, offset=offset, limit=limit)
            items = []
            for product, initialization, restocked, waste, sold in rows:
                initialized = initialization is not None
                opening_qty = initialization.quantity if initialized else None
                current_qty = (opening_qty + restocked - waste - sold) if initialized else None
                items.append(
                    StockRowDTO(
                        product_id=product.id,
                        code=product.code,
                        name=product.name,
                        category=product.category,
                        price_minor=product.price_minor,
                        cost_minor=product.cost_minor,
                        is_active=product.is_active,
                        unit=product.unit,
                        initialized=initialized,
                        opening_quantity=opening_qty,
                        restocked_quantity=restocked,
                        waste_quantity=waste,
                        quantity=current_qty,
                        initialized_at=initialization.initialized_at if initialized else None,
                    )
                )
            return StockPageDTO(items=items, total=total)
    except LookupError:
        raise HTTPException(404, "The requested branch was not found.") from None


@router.post("/branches/{branch_id}/movements", response_model=StockMovementDTO, status_code=201)
def record_movement_endpoint(
    branch_id: UUID,
    payload: StockMovementCreateDTO,
    request: Request,
    response: Response,
    principal: InventoryActorPrincipal = Depends(_actor),
    idempotency_key_header: str | None = Header(None, alias="Idempotency-Key"),
):
    if not principal.is_admin and principal.branch_id != branch_id:
        raise HTTPException(403, "Access restricted to your assigned branch.")

    key = payload.idempotency_key or idempotency_key_header
    if not key or not key.strip():
        raise HTTPException(422, "An idempotency key is required.")
    key = key.strip()

    try:
        with _factory(request).begin() as session:
            mov, on_hand, is_new = record_stock_movement(
                session,
                branch_id=branch_id,
                product_id=payload.product_id,
                kind=payload.kind,
                quantity=payload.quantity,
                actor_id=principal.staff_id,
                idempotency_key=key,
                reason=payload.reason,
            )
            if not is_new:
                response.status_code = 200
            return StockMovementDTO(
                id=mov.id,
                branch_id=mov.branch_id,
                product_id=mov.product_id,
                kind=mov.kind,
                quantity=mov.quantity,
                reason=mov.reason,
                recorded_by=mov.recorded_by,
                idempotency_key=mov.idempotency_key,
                recorded_at=mov.recorded_at,
                on_hand_quantity=on_hand,
            )
    except LookupError as exc:
        raise HTTPException(404, f"The requested {exc.args[0]} was not found.") from None
    except InactiveProductError as exc:
        raise HTTPException(409, str(exc)) from None
    except InsufficientStockError as exc:
        raise HTTPException(409, str(exc)) from None
    except IdempotencyConflictError as exc:
        raise HTTPException(409, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("/branches/{branch_id}/movements", response_model=StockMovementPageDTO)
def list_movements_endpoint(
    branch_id: UUID,
    request: Request,
    offset: int = Query(0, ge=0, le=2**63 - 1),
    limit: int = Query(50, ge=1, le=100),
    principal: InventoryActorPrincipal = Depends(_actor),
):
    if not principal.is_admin and principal.branch_id != branch_id:
        raise HTTPException(403, "Access restricted to your assigned branch.")

    try:
        with _factory(request)() as session:
            rows, total = list_stock_movements(session, branch_id=branch_id, offset=offset, limit=limit)
            items = [
                StockMovementDTO(
                    id=m.id,
                    branch_id=m.branch_id,
                    product_id=m.product_id,
                    kind=m.kind,
                    quantity=m.quantity,
                    reason=m.reason,
                    recorded_by=m.recorded_by,
                    idempotency_key=m.idempotency_key,
                    recorded_at=m.recorded_at,
                    on_hand_quantity=get_on_hand_stock(session, branch_id=m.branch_id, product_id=m.product_id),
                )
                for m in rows
            ]
            return StockMovementPageDTO(items=items, total=total)
    except LookupError:
        raise HTTPException(404, "The requested branch was not found.") from None
