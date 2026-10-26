"""Admin-only piece-counted product catalog and branch stock initialization API."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import IntegrityError

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.inventory.queries import create_product, initialize_stock, list_branch_stock, list_products
from app.inventory.schemas import (ProductCreateDTO, ProductDTO, ProductPageDTO,
                                   StockInitializationCreateDTO, StockInitializationDTO,
                                   StockPageDTO, StockRowDTO)

router = APIRouter(prefix="/api/v1/inventory", tags=["inventory"])
_bearer = HTTPBearer(auto_error=False)


def _admin(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> UUID:
    factory = request.app.state.session_factory
    settings = request.app.state.settings
    if (not settings.admin_auth_configured or not settings.admin_token_signing_configured or factory is None
            or credentials is None or credentials.scheme.lower() != "bearer"):
        raise HTTPException(401, "Authentication failed.")
    try:
        actor_id, _session_id = validate_admin_session(
            factory, credentials.credentials, settings.admin_token_signing_secret.get_secret_value()
        )
        return actor_id
    except AuthorizationDenied:
        try:
            validate_session(factory, credentials.credentials, Permission.MEMBER_OPERATIONAL_READ)
        except AuthorizationDenied:
            raise HTTPException(401, "Authentication failed.") from None
        raise HTTPException(403, "Access restricted to admin.") from None


def _factory(request: Request):
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503, "Database unavailable.")
    return factory


@router.post("/products", response_model=ProductDTO, status_code=201)
def create_product_endpoint(payload: ProductCreateDTO, request: Request, actor_id: UUID = Depends(_admin)):
    factory = _factory(request)
    try:
        with factory.begin() as session:
            product = create_product(session, code=payload.code, name=payload.name, unit=payload.unit, created_by=actor_id)
            session.flush()
            return ProductDTO.model_validate(product)
    except IntegrityError as exc:
        if "products.code" not in str(exc.orig) and "uq_products_code" not in str(exc.orig):
            raise
        raise HTTPException(409, "A product with this code already exists.") from None


@router.get("/products", response_model=ProductPageDTO)
def list_products_endpoint(request: Request, offset: int = Query(0, ge=0, le=2**63 - 1), limit: int = Query(50, ge=1, le=100), actor_id: UUID = Depends(_admin)):
    with _factory(request)() as session:
        rows, total = list_products(session, offset=offset, limit=limit)
        return ProductPageDTO(items=rows, total=total)


@router.post("/branches/{branch_id}/initializations", response_model=StockInitializationDTO, status_code=201)
def initialize_endpoint(branch_id: UUID, payload: StockInitializationCreateDTO, request: Request, actor_id: UUID = Depends(_admin)):
    try:
        with _factory(request).begin() as session:
            row = initialize_stock(session, branch_id=branch_id, product_id=payload.product_id, quantity=payload.quantity, actor_id=actor_id)
            return StockInitializationDTO(id=row.id, branch_id=row.branch_id, product_id=row.product_id,
                                          quantity=row.quantity, initialized_by=row.initialized_by,
                                          initialized_at=row.initialized_at)
    except LookupError as exc:
        raise HTTPException(404, f"The requested {exc.args[0]} was not found.") from None
    except IntegrityError as exc:
        detail = str(exc.orig)
        if not ("stock_initializations.branch_id" in detail or "uq_stock_initializations_branch_product" in detail):
            raise
        raise HTTPException(409, "Stock has already been initialized for this branch and product.") from None


@router.get("/branches/{branch_id}/stock", response_model=StockPageDTO)
def list_stock_endpoint(branch_id: UUID, request: Request, offset: int = Query(0, ge=0, le=2**63 - 1), limit: int = Query(50, ge=1, le=100), actor_id: UUID = Depends(_admin)):
    try:
        with _factory(request)() as session:
            rows, total = list_branch_stock(session, branch_id=branch_id, offset=offset, limit=limit)
            items = [StockRowDTO(product_id=product.id, code=product.code, name=product.name,
                                 unit=product.unit, initialized=initialization is not None,
                                 quantity=initialization.quantity if initialization else None,
                                 initialized_at=initialization.initialized_at if initialization else None)
                     for product, initialization in rows]
            return StockPageDTO(items=items, total=total)
    except LookupError:
        raise HTTPException(404, "The requested branch was not found.") from None
