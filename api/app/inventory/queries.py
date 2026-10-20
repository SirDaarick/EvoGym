from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    Branch,
    Product,
    RegisterInventorySnapshot,
    RegisterInventorySnapshotItem,
    StockInitialization,
)
from app.db.models.shifts import CashRegister
from app.db.models.inventory import normalize_product_code, normalize_product_name

MAX_BIGINT = 2**63 - 1


def create_product(session: Session, *, code: str, name: str, created_by: UUID, unit: str = "piece") -> Product:
    normalized_code = normalize_product_code(code)
    normalized_name = normalize_product_name(name)
    if unit != "piece":
        raise ValueError("Only piece-counted products are supported.")
    product = Product(code=normalized_code, name=normalized_name, unit=unit, created_by=created_by)
    session.add(product)
    session.flush()
    return product


def list_products(session: Session, *, offset: int, limit: int) -> tuple[list[Product], int]:
    _validate_page(offset, limit)
    total = session.scalar(select(func.count()).select_from(Product)) or 0
    rows = session.scalars(select(Product).order_by(Product.code, Product.id).offset(offset).limit(limit)).all()
    return rows, total


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


def list_branch_stock(session: Session, *, branch_id: UUID, offset: int, limit: int):
    _validate_page(offset, limit)
    if session.get(Branch, branch_id) is None:
        raise LookupError("branch")
    total = session.scalar(select(func.count()).select_from(Product)) or 0
    stmt = (select(Product, StockInitialization)
            .outerjoin(StockInitialization, (StockInitialization.product_id == Product.id) & (StockInitialization.branch_id == branch_id))
            .order_by(Product.code, Product.id).offset(offset).limit(limit))
    return session.execute(stmt).all(), total


def capture_register_inventory_snapshot(
    session: Session, *, register_id: UUID, actor_id: UUID
) -> RegisterInventorySnapshot:
    """Persist one complete, ordered catalog observation for a register's branch."""
    register = session.get(CashRegister, register_id)
    if register is None:
        raise LookupError("register")

    rows = session.execute(
        select(Product, StockInitialization)
        .outerjoin(
            StockInitialization,
            (StockInitialization.product_id == Product.id)
            & (StockInitialization.branch_id == register.branch_id),
        )
        .order_by(Product.code, Product.id)
    ).all()

    items = [
        RegisterInventorySnapshotItem(
            product_id=product.id,
            code=product.code,
            name=product.name,
            unit=product.unit,
            initialized=initialization is not None,
            expected_quantity=initialization.quantity if initialization else None,
            initialization_id=initialization.id if initialization else None,
            initialized_by=initialization.initialized_by if initialization else None,
            initialized_at=initialization.initialized_at if initialization else None,
        )
        for product, initialization in rows
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


def _validate_page(offset: int, limit: int) -> None:
    if type(offset) is not int or not 0 <= offset <= MAX_BIGINT:
        raise ValueError("Offset must be a nonnegative signed 64-bit integer.")
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("Limit must be between 1 and 100.")
