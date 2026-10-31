from datetime import datetime, timezone
import re
from uuid import UUID, uuid4

from sqlalchemy import case, func, select, text
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    Branch,
    Product,
    RegisterInventorySnapshotItem,
    RegisterInventorySnapshot,
    StockInitialization,
    StockMovement,
)
from app.db.models.shifts import CashRegister, ShiftInventoryReview
from app.db.models.inventory import normalize_product_code, normalize_product_name

MAX_BIGINT = 2**63 - 1


class InactiveProductError(Exception):
    """Cannot record stock movement on an inactive product."""


class InsufficientStockError(Exception):
    """Waste movement would result in negative on-hand stock."""


class IdempotencyConflictError(Exception):
    """Idempotency key has already been used with different parameters."""


def list_branches(session: Session) -> list[Branch]:
    return list(session.scalars(select(Branch).order_by(Branch.name, Branch.code)).all())


def create_product(
    session: Session,
    *,
    name: str,
    created_by: UUID,
    code: str | None = None,
    category: str = "General",
    price_minor: int = 0,
    cost_minor: int = 0,
    unit: str = "piece",
    initial_quantity: int | None = None,
    initial_branch_id: UUID | None = None,
) -> Product:
    normalized_name = normalize_product_name(name)
    if code is not None and code.strip():
        normalized_code = normalize_product_code(code)
    else:
        base_slug = re.sub(r"[^a-z0-9]+", "-", normalized_name.casefold()).strip("-")
        if not base_slug:
            base_slug = "prod"
        normalized_code = f"{base_slug[:48]}-{uuid4().hex[:8]}"

    if unit != "piece":
        raise ValueError("Only piece-counted products are supported.")
    if price_minor < 0 or cost_minor < 0:
        raise ValueError("Price and cost must be nonnegative.")

    product = Product(
        code=normalized_code,
        name=normalized_name,
        category=" ".join(category.split()) if category else "General",
        price_minor=price_minor,
        cost_minor=cost_minor,
        is_active=True,
        unit=unit,
        created_by=created_by,
    )
    session.add(product)
    session.flush()

    if initial_quantity is not None:
        target_branch_id = initial_branch_id
        if target_branch_id is None:
            target_branch_id = session.scalar(select(Branch.id).order_by(Branch.id))
        if target_branch_id is not None:
            initialize_stock(
                session,
                branch_id=target_branch_id,
                product_id=product.id,
                quantity=initial_quantity,
                actor_id=created_by,
            )

    return product


def update_product(
    session: Session,
    *,
    product_id: UUID,
    name: str | None = None,
    category: str | None = None,
    price_minor: int | None = None,
    cost_minor: int | None = None,
    is_active: bool | None = None,
) -> Product:
    product = session.get(Product, product_id)
    if product is None:
        raise LookupError("product")

    if name is not None:
        product.name = normalize_product_name(name)
    if category is not None:
        normalized_cat = " ".join(category.split())
        product.category = normalized_cat if normalized_cat else "General"
    if price_minor is not None:
        if price_minor < 0 or price_minor > MAX_BIGINT:
            raise ValueError("Price must be a nonnegative integer.")
        product.price_minor = price_minor
    if cost_minor is not None:
        if cost_minor < 0 or cost_minor > MAX_BIGINT:
            raise ValueError("Cost must be a nonnegative integer.")
        product.cost_minor = cost_minor
    if is_active is not None:
        product.is_active = is_active

    session.flush()
    return product


def list_products(session: Session, *, offset: int, limit: int) -> tuple[list[Product], int]:
    _validate_page(offset, limit)
    total = session.scalar(select(func.count()).select_from(Product)) or 0
    rows = session.scalars(select(Product).order_by(Product.code, Product.id).offset(offset).limit(limit)).all()
    return list(rows), total


def initialize_stock(session: Session, *, branch_id: UUID, product_id: UUID, quantity: int, actor_id: UUID) -> StockInitialization:
    if type(quantity) is not int or not 0 <= quantity <= MAX_BIGINT:
        raise ValueError("Quantity must be a nonnegative signed 64-bit integer.")
    if session.get(Branch, branch_id) is None:
        raise LookupError("branch")
    if session.get(Product, product_id) is None:
        raise LookupError("product")
    row = StockInitialization(branch_id=branch_id, product_id=product_id, quantity=quantity,
                              initialized_by=actor_id, initialized_at=datetime.now(timezone.utc))
    session.add(row)
    session.flush()
    return row


def get_on_hand_stock(session: Session, *, branch_id: UUID, product_id: UUID) -> int:
    init_qty = session.scalar(
        select(StockInitialization.quantity).where(
            StockInitialization.branch_id == branch_id,
            StockInitialization.product_id == product_id,
        )
    )
    if init_qty is None:
        return 0
    restocked = (
        session.scalar(
            select(func.coalesce(func.sum(StockMovement.quantity), 0)).where(
                StockMovement.branch_id == branch_id,
                StockMovement.product_id == product_id,
                StockMovement.kind.in_(("restock", "return")),
            )
        )
        or 0
    )
    waste = (
        session.scalar(
            select(func.coalesce(func.sum(StockMovement.quantity), 0)).where(
                StockMovement.branch_id == branch_id,
                StockMovement.product_id == product_id,
                StockMovement.kind.in_(("waste", "sale")),
            )
        )
        or 0
    )
    return int(init_qty) + int(restocked) - int(waste)


def list_branch_stock(session: Session, *, branch_id: UUID, offset: int, limit: int):
    _validate_page(offset, limit)
    if session.get(Branch, branch_id) is None:
        raise LookupError("branch")
    total = session.scalar(select(func.count()).select_from(Product)) or 0

    mov_sub = (
        select(
            StockMovement.product_id,
            func.coalesce(
                func.sum(case((StockMovement.kind.in_(("restock", "return")), StockMovement.quantity), else_=0)), 0
            ).label("restocked"),
            func.coalesce(
                func.sum(case((StockMovement.kind == "waste", StockMovement.quantity), else_=0)), 0
            ).label("waste"),
            func.coalesce(func.sum(case((StockMovement.kind == "sale", StockMovement.quantity), else_=0)), 0).label("sold"),
        )
        .where(StockMovement.branch_id == branch_id)
        .group_by(StockMovement.product_id)
        .subquery()
    )

    stmt = (
        select(
            Product,
            StockInitialization,
            func.coalesce(mov_sub.c.restocked, 0).label("restocked_quantity"),
            func.coalesce(mov_sub.c.waste, 0).label("waste_quantity"),
            func.coalesce(mov_sub.c.sold, 0).label("sold_quantity"),
        )
        .outerjoin(
            StockInitialization,
            (StockInitialization.product_id == Product.id) & (StockInitialization.branch_id == branch_id),
        )
        .outerjoin(mov_sub, mov_sub.c.product_id == Product.id)
        .order_by(Product.code, Product.id)
        .offset(offset)
        .limit(limit)
    )
    rows = session.execute(stmt).all()
    return rows, total


def record_stock_movement(
    session: Session,
    *,
    branch_id: UUID,
    product_id: UUID,
    kind: str,
    quantity: int,
    actor_id: UUID,
    idempotency_key: str,
    reason: str | None = None,
) -> tuple[StockMovement, int, bool]:
    """Record a stock movement. Returns (StockMovement, on_hand_quantity, is_new)."""
    if kind not in ("restock", "waste"):
        raise ValueError("Movement kind must be 'restock' or 'waste'.")
    if type(quantity) is not int or quantity <= 0 or quantity > MAX_BIGINT:
        raise ValueError("Quantity must be a positive integer.")
    if session.get(Branch, branch_id) is None:
        raise LookupError("branch")

    product = session.get(Product, product_id)
    if product is None:
        raise LookupError("product")
    if not product.is_active:
        raise InactiveProductError("Cannot record movements for inactive products.")

    # Idempotent replay check
    existing = session.scalar(
        select(StockMovement).where(
            StockMovement.branch_id == branch_id,
            StockMovement.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if (
            existing.product_id != product_id
            or existing.kind != kind
            or existing.quantity != quantity
        ):
            raise IdempotencyConflictError("Idempotency key already used with different parameters.")
        on_hand = get_on_hand_stock(session, branch_id=branch_id, product_id=product_id)
        return existing, on_hand, False

    init_row = session.scalar(
        select(StockInitialization).where(
            StockInitialization.branch_id == branch_id,
            StockInitialization.product_id == product_id,
        ).with_for_update()
    )
    if init_row is None:
        if kind == "restock":
            init_row = StockInitialization(
                branch_id=branch_id,
                product_id=product_id,
                quantity=0,
                initialized_by=actor_id,
                initialized_at=datetime.now(timezone.utc),
            )
            session.add(init_row)
            session.flush()
        else:
            raise InsufficientStockError("Stock has not been initialized for this product.")

    current_on_hand = get_on_hand_stock(session, branch_id=branch_id, product_id=product_id)
    if kind == "waste":
        if not reason or not reason.strip():
            raise ValueError("Reason is required for waste stock movements.")
        if quantity > current_on_hand:
            raise InsufficientStockError("Waste quantity exceeds available stock.")

    new_on_hand = current_on_hand + quantity if kind == "restock" else current_on_hand - quantity
    movement = StockMovement(
        branch_id=branch_id,
        product_id=product_id,
        kind=kind,
        quantity=quantity,
        reason=reason.strip() if reason else None,
        recorded_by=actor_id,
        idempotency_key=idempotency_key,
        recorded_at=datetime.now(timezone.utc),
    )
    session.add(movement)
    session.flush()
    return movement, new_on_hand, True


def list_stock_movements(
    session: Session, *, branch_id: UUID, offset: int, limit: int
) -> tuple[list[StockMovement], int]:
    _validate_page(offset, limit)
    if session.get(Branch, branch_id) is None:
        raise LookupError("branch")
    total = (
        session.scalar(
            select(func.count()).select_from(StockMovement).where(StockMovement.branch_id == branch_id)
        )
        or 0
    )
    rows = session.scalars(
        select(StockMovement)
        .where(StockMovement.branch_id == branch_id)
        .order_by(StockMovement.recorded_at.desc(), StockMovement.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return list(rows), total


def _read_current_inventory_rows(session: Session, branch_id: UUID):
    """Read source scalar values directly so cached ORM identities cannot mask changes."""
    return session.execute(
        select(
            Product.id,
            Product.code,
            Product.name,
            Product.unit,
            StockInitialization.id,
            (StockInitialization.quantity + select(func.coalesce(func.sum(case(
                (StockMovement.kind.in_(("restock", "return")), StockMovement.quantity),
                (StockMovement.kind.in_(("waste", "sale")), -StockMovement.quantity),
                else_=0)), 0)).where(StockMovement.branch_id == branch_id,
                                     StockMovement.product_id == Product.id).correlate(Product).scalar_subquery()).label("quantity"),
            StockInitialization.initialized_by,
            StockInitialization.initialized_at,
        )
        .outerjoin(
            StockInitialization,
            (StockInitialization.product_id == Product.id)
            & (StockInitialization.branch_id == branch_id),
        )
        .order_by(Product.code, Product.id)
        .execution_options(populate_existing=True)
    ).all()


def capture_register_inventory_snapshot(
    session: Session, *, register_id: UUID, actor_id: UUID
) -> RegisterInventorySnapshot:
    """Persist one complete, ordered catalog observation for a register's branch."""
    register = session.get(CashRegister, register_id)
    if register is None:
        raise LookupError("register")

    rows = _read_current_inventory_rows(session, register.branch_id)

    items = [
        RegisterInventorySnapshotItem(
            product_id=product_id,
            code=code,
            name=name,
            unit=unit,
            initialized=initialization_id is not None,
            expected_quantity=quantity,
            initialization_id=initialization_id,
            initialized_by=initialized_by,
            initialized_at=initialized_at,
        )
        for product_id, code, name, unit, initialization_id, quantity, initialized_by, initialized_at in rows
    ]
    missing_count = sum(not item.initialized for item in items)
    source_state = (
        "empty_catalog" if not items
        else "missing_initializations" if missing_count
        else "all_initialized"
    )
    snapshot = RegisterInventorySnapshot(
        register_id=register.id,
        branch_id=register.branch_id,
        captured_by=actor_id,
        captured_at=datetime.now(timezone.utc),
        item_count=len(items),
        missing_count=missing_count,
        source_state=source_state,
        items=items,
    )
    session.add(snapshot)
    session.flush()
    return snapshot


def get_register_inventory_snapshot(
    session: Session, *, register_id: UUID, snapshot_id: UUID
) -> RegisterInventorySnapshot | None:
    statement = (
        select(RegisterInventorySnapshot)
        .where(
            RegisterInventorySnapshot.id == snapshot_id,
            RegisterInventorySnapshot.register_id == register_id,
        )
        .options(selectinload(RegisterInventorySnapshot.items))
    )
    return session.scalar(statement)


class InventorySnapshotUnavailableError(Exception):
    """The requested snapshot is outside the register scope or unavailable."""


class InventorySnapshotStaleError(Exception):
    """The live catalog or branch baseline changed after snapshot capture."""


class InventorySnapshotConsumedError(Exception):
    """The opening snapshot has already been used by another shift."""


def validate_opening_inventory_snapshot(
    session: Session, *, register_id: UUID, branch_id: UUID, snapshot_id: UUID
) -> tuple[RegisterInventorySnapshot, dict[UUID, RegisterInventorySnapshotItem]]:
    """Validate the exact immutable presentation against one current full-catalog read."""
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        session.execute(text("LOCK TABLE products, stock_initializations, stock_movements IN SHARE MODE"))

    snapshot = get_register_inventory_snapshot(session, register_id=register_id, snapshot_id=snapshot_id)
    if snapshot is None or snapshot.branch_id != branch_id:
        raise InventorySnapshotUnavailableError("Inventory snapshot was not found for this register.")

    consumed = session.scalar(
        select(ShiftInventoryReview.id).where(ShiftInventoryReview.snapshot_id == snapshot_id)
    )
    if consumed is not None:
        raise InventorySnapshotConsumedError("Inventory snapshot has already been used; capture a fresh snapshot.")

    current_rows = _read_current_inventory_rows(session, branch_id)
    current = [
        (
            product_id, code, name, unit,
            initialization_id is not None,
            quantity,
            initialization_id,
            initialized_by,
            initialized_at,
        )
        for product_id, code, name, unit, initialization_id, quantity, initialized_by, initialized_at in current_rows
    ]
    captured = [
        (
            item.product_id, item.code, item.name, item.unit, item.initialized,
            item.expected_quantity, item.initialization_id, item.initialized_by, item.initialized_at,
        )
        for item in snapshot.items
    ]
    if current != captured:
        raise InventorySnapshotStaleError("Inventory changed after presentation; capture and review it again.")
    return snapshot, {item.product_id: item for item in snapshot.items}


def _validate_page(offset: int, limit: int) -> None:
    if type(offset) is not int or not 0 <= offset <= MAX_BIGINT:
        raise ValueError("Offset must be a nonnegative signed 64-bit integer.")
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("Limit must be between 1 and 100.")
