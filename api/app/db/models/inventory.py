from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
        CheckConstraint("price_minor >= 0", name="ck_products_price_minor_nonnegative"),
        CheckConstraint("cost_minor >= 0", name="ck_products_cost_minor_nonnegative"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="General", server_default="General")
    price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    cost_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
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


class StockMovement(Base):
    """Append-only ledger of physical stock adjustments (restocks and waste)."""

    __tablename__ = "stock_movements"
    __table_args__ = (
        CheckConstraint("kind IN ('restock', 'waste')", name="ck_stock_movements_kind"),
        CheckConstraint("quantity > 0", name="ck_stock_movements_quantity_positive"),
        CheckConstraint(
            "kind != 'waste' OR (reason IS NOT NULL AND length(trim(reason)) > 0)",
            name="ck_stock_movements_waste_reason",
        ),
        UniqueConstraint("branch_id", "idempotency_key", name="uq_stock_movements_branch_idempotency"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True)
    product_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    recorded_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class RegisterInventorySnapshot(Base):
    """Immutable, server-captured view of a register branch's complete piece catalog."""

    __tablename__ = "register_inventory_snapshots"
    __table_args__ = (
        Index("ix_register_inventory_snapshots_register_captured", "register_id", "captured_at", "id"),
        CheckConstraint("item_count >= 0", name="ck_register_inventory_snapshots_item_count"),
        CheckConstraint("missing_count >= 0 AND missing_count <= item_count", name="ck_register_inventory_snapshots_missing_count"),
        CheckConstraint(
            "(source_state = 'empty_catalog' AND item_count = 0 AND missing_count = 0) OR "
            "(source_state = 'missing_initializations' AND item_count > 0 AND missing_count > 0) OR "
            "(source_state = 'all_initialized' AND item_count > 0 AND missing_count = 0)",
            name="ck_register_inventory_snapshots_source_state",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    register_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("cash_registers.id", ondelete="RESTRICT"), nullable=False)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    captured_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    item_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    missing_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source_state: Mapped[str] = mapped_column(String(32), nullable=False)
    items: Mapped[list["RegisterInventorySnapshotItem"]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan", order_by="RegisterInventorySnapshotItem.code, RegisterInventorySnapshotItem.product_id", lazy="selectin"
    )


class RegisterInventorySnapshotItem(Base):
    """Copied product and baseline observation retained as captured, even after catalog changes."""

    __tablename__ = "register_inventory_snapshot_items"
    __table_args__ = (
        CheckConstraint(
            "(initialized = false AND expected_quantity IS NULL AND initialization_id IS NULL "
            "AND initialized_by IS NULL AND initialized_at IS NULL) OR "
            "(initialized = true AND expected_quantity IS NOT NULL AND expected_quantity >= 0 AND initialization_id IS NOT NULL "
            "AND initialized_by IS NOT NULL AND initialized_at IS NOT NULL)",
            name="ck_register_inventory_snapshot_items_initialization_state",
        ),
        UniqueConstraint("snapshot_id", "product_id", name="uq_register_inventory_snapshot_items_product"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    snapshot_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("register_inventory_snapshots.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    unit: Mapped[str] = mapped_column(String(16), nullable=False)
    initialized: Mapped[bool] = mapped_column(Boolean, nullable=False)
    expected_quantity: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    initialization_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    initialized_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    initialized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    snapshot: Mapped[RegisterInventorySnapshot] = relationship(back_populates="items")
