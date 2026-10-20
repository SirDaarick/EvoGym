from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def normalize_product_code(value: str) -> str:
    if not isinstance(value, str) or "\x00" in value:
        raise ValueError("Product code must be text without NUL characters.")
    normalized = " ".join(value.split()).casefold()
    if not normalized:
        raise ValueError("Product code must not be blank.")
    if len(normalized) > 64:
        raise ValueError("Normalized product code must be at most 64 characters.")
    return normalized


def normalize_product_name(value: str) -> str:
    if not isinstance(value, str) or "\x00" in value:
        raise ValueError("Product name must be text without NUL characters.")
    normalized = " ".join(value.split())
    if not normalized:
        raise ValueError("Product name must not be blank.")
    if len(normalized) > 160:
        raise ValueError("Normalized product name must be at most 160 characters.")
    return normalized


class Product(Base):
    """Organization-wide product definition, initially limited to piece counts."""

    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("length(code) BETWEEN 1 AND 64 AND code = lower(trim(code))", name="ck_products_code_normalized"),
        CheckConstraint("length(name) BETWEEN 1 AND 160 AND name = trim(name)", name="ck_products_name_normalized"),
        CheckConstraint("unit = 'piece'", name="ck_products_unit_piece"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    unit: Mapped[str] = mapped_column(String(16), nullable=False, default="piece", server_default="piece")
    created_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class StockInitialization(Base):
    """Immutable, explicitly entered starting quantity for one product at one branch."""

    __tablename__ = "stock_initializations"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="ck_stock_initializations_quantity_nonnegative"),
        UniqueConstraint("branch_id", "product_id", name="uq_stock_initializations_branch_product"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    product_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    quantity: Mapped[int] = mapped_column(BigInteger, nullable=False)
    initialized_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    initialized_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
