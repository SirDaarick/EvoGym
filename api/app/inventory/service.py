"""Inventory use cases: branch scope, orchestration, commits and error mapping.

SQL lives in `app.inventory.queries`; HTTP transport lives in `app.api.inventory`. Failures are
raised as typed `AppError`s (never HTTPException). Every use case takes the session `factory`.
"""
from datetime import datetime, timezone
import hashlib
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import func, select

from sqlalchemy.exc import IntegrityError

from app.errors import AppError, HttpStatusError, http_errors
from app.inventory import queries as q
from app.inventory.queries import IdempotencyConflictError, InactiveProductError, InsufficientStockError
from app.db.models import Branch, Expense, InventoryPurchase, Product, StaffUser, StockMovement
from app.api.deps import FinancePrincipal
from app.expenses import queries as expense_queries
from app.finance.service import authorized_branches
from app.rentals.payments import clean_idempotency_key, fingerprint
from app.rentals.service import require_receptionist
from app.shifts.queries import expected_cash_for_shift
from app.inventory.schemas import (
    BranchDTO, InventoryWasteBatchDTO, ProductDTO, ProductPageDTO, StockInitializationDTO, StockMovementDTO,
    StockMovementPageDTO, StockPageDTO, StockRowDTO,
)


class Principal(Protocol):
    staff_id: UUID
    is_admin: bool
    branch_id: UUID | None


class InventoryPurchaseRejected(AppError):
    code = "inventory_purchase_rejected"
    status = 409
    message = "The purchase could not be recorded because the drawer is unavailable or has insufficient cash."


class PurchaseCancellationRequiresReview(AppError):
    code = "purchase_cancellation_requires_review"
    status = 409
    message = "Purchase has products already sold or consumed; administrator review is required."


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


def create_waste_batch(factory, principal: Principal, branch_id: UUID, payload, header_key: str | None):
    """Atomically record one or more waste movements under one idempotency key. Returns (InventoryWasteBatchDTO, is_new)."""
    _require_own_branch(principal, branch_id)
    try:
        key = clean_idempotency_key(header_key)
    except ValueError:
        raise HttpStatusError(422) from None
    prefix = f"w:{hashlib.sha256(key.encode('utf-8')).hexdigest()}:"
    sorted_items = sorted(payload.items, key=lambda line: str(line.product_id))
    with http_errors(*_STOCK_ERRORS, (IntegrityError, 409)), factory.begin() as session:
        if session.get(Branch, branch_id) is None:
            raise LookupError("branch")
        existing = session.scalars(
            select(StockMovement).where(
                StockMovement.branch_id == branch_id,
                StockMovement.idempotency_key.like(f"{prefix}%"),
            )
        ).all()
        if existing:
            by_key = {mov.idempotency_key: mov for mov in existing}
            if len(existing) != len(sorted_items):
                raise IdempotencyConflictError("Idempotency key already used with different parameters.")
            dtos = []
            for index, line in enumerate(sorted_items):
                mov = by_key.get(f"{prefix}{index}")
                if (
                    mov is None
                    or mov.recorded_by != principal.staff_id
                    or mov.product_id != line.product_id
                    or mov.kind != "waste"
                    or mov.quantity != line.quantity
                    or mov.reason != payload.reason
                ):
                    raise IdempotencyConflictError("Idempotency key already used with different parameters.")
                dtos.append(_movement_dto(mov, q.get_on_hand_stock(session, branch_id=branch_id, product_id=line.product_id)))
            return InventoryWasteBatchDTO(items=dtos), False

        recorded = [
            _movement_dto(
                *q.record_stock_movement(
                    session,
                    branch_id=branch_id,
                    product_id=line.product_id,
                    kind="waste",
                    quantity=line.quantity,
                    actor_id=principal.staff_id,
                    idempotency_key=f"{prefix}{index}",
                    reason=payload.reason,
                )[:2]
            )
            for index, line in enumerate(sorted_items)
        ]
        return InventoryWasteBatchDTO(items=recorded), True


def create_purchase(factory, principal: Principal, branch_id: UUID, payload, key: str | None):
    _require_own_branch(principal, branch_id)
    try:
        clean_idempotency_key(key)
    except ValueError:
        raise HttpStatusError(422) from None
    assert key is not None
    request_hash = fingerprint(str(branch_id), payload.model_dump(mode="json"))
    with http_errors(*_STOCK_ERRORS, (IntegrityError, 409)), factory.begin() as session:
        actor = session.scalar(select(StaffUser).where(StaffUser.id == principal.staff_id).with_for_update())
        if actor is None or not actor.is_active:
            raise HttpStatusError(403)
        require_receptionist(session, branch_id, principal)
        branch = session.get(Branch, branch_id)
        if branch is None or not branch.is_active:
            raise HttpStatusError(404)
        previous = session.scalar(select(InventoryPurchase).where(
            InventoryPurchase.branch_id == branch_id,
            InventoryPurchase.idempotency_key == key,
        ))
        if previous is not None:
            if previous.recorded_by != principal.staff_id or previous.request_fingerprint != request_hash:
                raise HttpStatusError(409)
            return {"id": str(previous.id), "total_minor": previous.total_minor, "expense_id": str(previous.expense_id)}, False

        total = sum(line.cost_minor for line in payload.items)
        shift = None
        if payload.pay_from_drawer:
            register = expense_queries.get_register(session, payload.register_id, lock=True)
            if register is None or register.branch_id != branch_id or register.status != "active":
                raise HttpStatusError(404)
            shift = expense_queries.open_shift(session, payload.register_id, lock=True)
            if shift is None or expected_cash_for_shift(session, shift) < total:
                raise InventoryPurchaseRejected()

        purchase_id = uuid4()
        now_utc = datetime.now(timezone.utc)
        lines = []
        for index, line in enumerate(sorted(payload.items, key=lambda item: str(item.product_id))):
            product = session.scalar(select(Product).where(Product.id == line.product_id).with_for_update())
            if product is None:
                raise LookupError("product")
            old_cost = product.cost_minor
            q.record_stock_movement(session, branch_id=branch_id, product_id=line.product_id,
                                    kind="restock", quantity=line.quantity, actor_id=principal.staff_id,
                                    idempotency_key=f"inventory-purchase:{purchase_id.hex}:{index}")
            quotient, remainder = divmod(line.cost_minor, line.quantity)
            product.cost_minor = quotient + (1 if remainder * 2 >= line.quantity else 0)
            lines.append({"product_id": str(line.product_id), "quantity": line.quantity,
                          "cost_minor": line.cost_minor, "unit_cost_minor": product.cost_minor,
                          "previous_cost_minor": old_cost})

        expense = Expense(branch_id=branch_id, shift_id=shift.id if shift is not None else None,
                          category="consumibles", concept="Inventory purchase", payee_name="Not provided",
                          amount_minor=total, payment_method="cash", recorded_by_id=principal.staff_id,
                          idempotency_key=f"inventory-purchase:{purchase_id.hex}", request_fingerprint=request_hash,
                          created_at=now_utc)
        session.add(expense)
        session.flush()
        purchase = InventoryPurchase(id=purchase_id, branch_id=branch_id, recorded_by=principal.staff_id,
                                     expense_id=expense.id, idempotency_key=key, request_fingerprint=request_hash,
                                     total_minor=total, lines=lines, recorded_at=now_utc)
        session.add(purchase)
        session.flush()
        return {"id": str(purchase.id), "total_minor": total, "expense_id": str(expense.id)}, True


def assert_and_reverse_purchase_inventory(session, purchase: InventoryPurchase, actor_id: UUID, reason: str) -> None:
    for index, line in enumerate(purchase.lines):
        pid = UUID(line["product_id"])
        qty = line["quantity"]
        on_hand = q.get_on_hand_stock(session, branch_id=purchase.branch_id, product_id=pid)
        if on_hand < qty:
            raise PurchaseCancellationRequiresReview()
        restock_mov = session.scalar(
            select(StockMovement).where(
                StockMovement.branch_id == purchase.branch_id,
                StockMovement.idempotency_key == f"inventory-purchase:{purchase.id.hex}:{index}",
            )
        )
        baseline_time = restock_mov.recorded_at if restock_mov is not None else purchase.recorded_at
        sold_or_consumed = session.scalar(
            select(func.count(StockMovement.id)).where(
                StockMovement.branch_id == purchase.branch_id,
                StockMovement.product_id == pid,
                StockMovement.kind.in_(("sale", "waste", "open_out")),
                StockMovement.recorded_at >= baseline_time,
            )
        )
        if sold_or_consumed is not None and sold_or_consumed > 0:
            raise PurchaseCancellationRequiresReview()

    for index, line in enumerate(sorted(purchase.lines, key=lambda item: str(item["product_id"]))):
        pid = UUID(line["product_id"])
        qty = line["quantity"]
        q.record_stock_movement(
            session,
            branch_id=purchase.branch_id,
            product_id=pid,
            kind="waste",
            quantity=qty,
            actor_id=actor_id,
            idempotency_key=f"inventory-purchase-void:{purchase.id.hex}:{index}",
            reason=f"Purchase voided: {reason}",
        )
        product = session.scalar(select(Product).where(Product.id == pid).with_for_update())
        if product is not None and product.cost_minor == line["unit_cost_minor"]:
            product.cost_minor = line["previous_cost_minor"]


def list_purchase_cost_alerts(factory, actor_id: UUID, branch_id: UUID):
    with factory() as session:
        authorized_branches(session, FinancePrincipal(actor_id, True, None), branch_id)
        purchases = session.scalars(
            select(InventoryPurchase)
            .join(Expense, InventoryPurchase.expense_id == Expense.id)
            .where(
                InventoryPurchase.branch_id == branch_id,
                Expense.voided_at.is_(None),
            )
            .order_by(InventoryPurchase.recorded_at.desc(), InventoryPurchase.id.desc())
        ).all()
        product_ids = {UUID(line["product_id"]) for purchase in purchases for line in purchase.lines}
        names = {str(product.id): product.name for product in session.scalars(
            select(Product).where(Product.id.in_(product_ids))
        )} if product_ids else {}
        alerts = []
        for purchase in purchases:
            for line in purchase.lines:
                if line["previous_cost_minor"] > 0 and line["unit_cost_minor"] > line["previous_cost_minor"]:
                    alerts.append({"purchase_id": str(purchase.id), "product_id": line["product_id"],
                                   "product_name": names.get(line["product_id"], "Unknown product"),
                                   "previous_cost_minor": line["previous_cost_minor"],
                                   "unit_cost_minor": line["unit_cost_minor"],
                                   "recorded_at": purchase.recorded_at.isoformat()})
        return {"items": alerts}


def list_movements(factory, principal: Principal, branch_id: UUID, offset: int, limit: int) -> StockMovementPageDTO:
    _require_own_branch(principal, branch_id)
    with http_errors(_NOT_FOUND), factory() as session:
        rows, total = q.list_stock_movements(session, branch_id=branch_id, offset=offset, limit=limit)
        items = [
            _movement_dto(m, q.get_on_hand_stock(session, branch_id=m.branch_id, product_id=m.product_id))
            for m in rows
        ]
        return StockMovementPageDTO(items=items, total=total)
