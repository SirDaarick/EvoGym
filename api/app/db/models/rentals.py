"""Individually identified rental assets; occupancy is not consumable stock."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RentalAsset(Base):
    __tablename__ = "rental_assets"
    __table_args__ = (
        UniqueConstraint("branch_id", "kind", "code", name="uq_rental_assets_code"),
        UniqueConstraint("branch_id", "locker_number", name="uq_rental_assets_locker_number"),
        CheckConstraint("kind IN ('glove', 'locker')", name="ck_rental_assets_kind"),
        CheckConstraint("length(code) BETWEEN 1 AND 64 AND code = lower(trim(code))", name="ck_rental_assets_code"),
        CheckConstraint("price_minor BETWEEN 0 AND 9223372036854775807", name="ck_rental_assets_price"),
        CheckConstraint("status IN ('available', 'employee', 'out_of_service') AND (status != 'employee' OR kind = 'locker')", name="ck_rental_assets_status"),
        CheckConstraint(
            "(kind = 'glove' AND color IS NOT NULL AND length(color) BETWEEN 1 AND 64 "
            "AND ounces IS NOT NULL AND ounces > 0 AND locker_number IS NULL) OR "
            "(kind = 'locker' AND locker_number IS NOT NULL AND locker_number > 0 AND color IS NULL AND ounces IS NULL)",
            name="ck_rental_assets_attributes",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="available", server_default="available")
    color: Mapped[str | None] = mapped_column(String(64))
    ounces: Mapped[int | None] = mapped_column(Integer)
    locker_number: Mapped[int | None] = mapped_column(Integer)
    created_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
