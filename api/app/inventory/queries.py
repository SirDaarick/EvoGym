from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Branch, Product, StockInitialization
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


def _validate_page(offset: int, limit: int) -> None:
    if type(offset) is not int or not 0 <= offset <= MAX_BIGINT:
        raise ValueError("Offset must be a nonnegative signed 64-bit integer.")
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("Limit must be between 1 and 100.")
