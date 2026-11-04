"""Inventory use cases: branch scope, orchestration, commits and error mapping.

SQL lives in `app.inventory.queries`; HTTP transport lives in `app.api.inventory`. Failures are
raised as typed `AppError`s (never HTTPException). Every use case takes the session `factory`.
"""
from typing import Protocol
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.errors import HttpStatusError, http_errors
from app.inventory import queries as q
from app.inventory.queries import IdempotencyConflictError, InactiveProductError, InsufficientStockError
from app.inventory.schemas import (
    BranchDTO, ProductDTO, ProductPageDTO, StockInitializationDTO, StockMovementDTO,
    StockMovementPageDTO, StockPageDTO, StockRowDTO,
)


class Principal(Protocol):
    staff_id: UUID
    is_admin: bool
    branch_id: UUID | None


_NOT_FOUND = (LookupError, 404)
_STOCK_ERRORS = (_NOT_FOUND, ((InactiveProductError, InsufficientStockError, IdempotencyConflictError), 409),
                 (ValueError, 422))


def _require_own_branch(principal: Principal, branch_id: UUID) -> None:
    if not principal.is_admin and principal.branch_id != branch_id:
        raise HttpStatusError(403)


def _movement_dto(mov, on_hand) -> StockMovementDTO:
    return StockMovementDTO(
        id=mov.id, branch_id=mov.branch_id, product_id=mov.product_id, kind=mov.kind,
        quantity=mov.quantity, reason=mov.reason, recorded_by=mov.recorded_by,
        idempotency_key=mov.idempotency_key, recorded_at=mov.recorded_at, on_hand_quantity=on_hand,
    )


def list_branches(factory) -> list[BranchDTO]:
    with factory() as session:
        return [BranchDTO.model_validate(b) for b in q.list_branches(session)]


def create_product(factory, actor_id: UUID, payload) -> ProductDTO:
    try:
        with factory.begin() as session:
            product = q.create_product(
                session, code=payload.code, name=payload.name, category=payload.category,
                price_minor=payload.price_minor, cost_minor=payload.cost_minor, unit=payload.unit,
                servings_per_container=payload.servings_per_container,
                container_product_id=payload.container_product_id,
                initial_quantity=payload.initial_quantity, initial_branch_id=payload.initial_branch_id,
                created_by=actor_id,
            )
            session.flush()
            return ProductDTO.model_validate(product)
    except IntegrityError as exc:
        msg = str(exc.orig)
        if "products.code" in msg or "uq_products_code" in msg:
            raise HttpStatusError(409) from None
        raise
    except ValueError:
        raise HttpStatusError(422) from None


def update_product(factory, product_id: UUID, payload) -> ProductDTO:
    with http_errors(_NOT_FOUND, (ValueError, 422)), factory.begin() as session:
        product = q.update_product(
            session, product_id=product_id, name=payload.name, category=payload.category,
            price_minor=payload.price_minor, cost_minor=payload.cost_minor, is_active=payload.is_active,
            unit=payload.unit, servings_per_container=payload.servings_per_container,
            servings_provided="servings_per_container" in payload.model_fields_set,
            container_product_id=payload.container_product_id,
            container_provided="container_product_id" in payload.model_fields_set,
        )
        return ProductDTO.model_validate(product)


def list_products(factory, offset: int, limit: int) -> ProductPageDTO:
    with factory() as session:
        rows, total = q.list_products(session, offset=offset, limit=limit)
        return ProductPageDTO(items=[ProductDTO.model_validate(r) for r in rows], total=total)


def initialize_stock(factory, actor_id: UUID, branch_id: UUID, payload) -> StockInitializationDTO:
    try:
        with http_errors(_NOT_FOUND), factory.begin() as session:
            row = q.initialize_stock(
                session, branch_id=branch_id, product_id=payload.product_id,
                quantity=payload.quantity, actor_id=actor_id,
            )
            return StockInitializationDTO(
                id=row.id, branch_id=row.branch_id, product_id=row.product_id, quantity=row.quantity,
                initialized_by=row.initialized_by, initialized_at=row.initialized_at,
            )
    except IntegrityError as exc:
        detail = str(exc.orig)
        if not ("stock_initializations.branch_id" in detail or "uq_stock_initializations_branch_product" in detail):
            raise
        raise HttpStatusError(409) from None


def list_stock(factory, principal: Principal, branch_id: UUID, offset: int, limit: int) -> StockPageDTO:
    with http_errors(_NOT_FOUND), factory() as session:
        if (not principal.is_admin and principal.branch_id != branch_id
                and not q.has_receptionist_grant(session, staff_id=principal.staff_id, branch_id=principal.branch_id)):
            raise HttpStatusError(403)
        rows, total = q.list_branch_stock(session, branch_id=branch_id, offset=offset, limit=limit)
        items = []
        for product, initialization, restocked, waste, sold in rows:
            initialized = initialization is not None
            opening_qty = initialization.quantity if initialized else None
            items.append(StockRowDTO(
                product_id=product.id, code=product.code, name=product.name, category=product.category,
                price_minor=product.price_minor, cost_minor=product.cost_minor, is_active=product.is_active,
                unit=product.unit, servings_per_container=product.servings_per_container,
                container_product_id=product.container_product_id, initialized=initialized,
                opening_quantity=opening_qty, restocked_quantity=restocked, waste_quantity=waste,
                quantity=(opening_qty + restocked - waste - sold) if initialized else None,
                initialized_at=initialization.initialized_at if initialized else None,
            ))
        return StockPageDTO(items=items, total=total)


def open_container(factory, principal: Principal, branch_id: UUID, payload) -> bool:
    """Returns True when newly opened, False on idempotent replay."""
    _require_own_branch(principal, branch_id)
    if not payload.idempotency_key.strip():
        raise HttpStatusError(422)
    with http_errors(*_STOCK_ERRORS), factory.begin() as session:
        return q.open_container(
            session, branch_id=branch_id, product_id=payload.product_id, actor_id=principal.staff_id,
            idempotency_key=payload.idempotency_key.strip(),
        )


def record_movement(factory, principal: Principal, branch_id: UUID, payload, header_key: str | None):
    """Returns (StockMovementDTO, is_new)."""
    _require_own_branch(principal, branch_id)
    key = payload.idempotency_key or header_key
    if not key or not key.strip():
        raise HttpStatusError(422)
    key = key.strip()
    with http_errors(*_STOCK_ERRORS), factory.begin() as session:
        mov, on_hand, is_new = q.record_stock_movement(
            session, branch_id=branch_id, product_id=payload.product_id, kind=payload.kind,
            quantity=payload.quantity, actor_id=principal.staff_id, idempotency_key=key, reason=payload.reason,
        )
        return _movement_dto(mov, on_hand), is_new


def list_movements(factory, principal: Principal, branch_id: UUID, offset: int, limit: int) -> StockMovementPageDTO:
    _require_own_branch(principal, branch_id)
    with http_errors(_NOT_FOUND), factory() as session:
        rows, total = q.list_stock_movements(session, branch_id=branch_id, offset=offset, limit=limit)
        items = [
            _movement_dto(m, q.get_on_hand_stock(session, branch_id=m.branch_id, product_id=m.product_id))
            for m in rows
        ]
        return StockMovementPageDTO(items=items, total=total)
