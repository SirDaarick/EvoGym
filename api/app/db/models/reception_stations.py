from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ReceptionStation(Base):
    """Server-issued branch-bound credential for a fixed reception device."""

    __tablename__ = "reception_stations"
    __table_args__ = (
        CheckConstraint("length(credential_digest) = 64", name="ck_reception_stations_digest"),
        Index("uq_reception_stations_credential_digest", "credential_digest", unique=True),
        Index("ix_reception_stations_branch_active", "branch_id", "revoked_at", "expires_at"),
        Index(
            "uq_reception_stations_admin_device_branch_active",
            "source_admin_device_id",
            "branch_id",
            unique=True,
            postgresql_where=text("source_admin_device_id IS NOT NULL AND revoked_at IS NULL"),
            sqlite_where=text("source_admin_device_id IS NOT NULL AND revoked_at IS NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False
    )
    created_by: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False
    )
    source_admin_device_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("admin_trusted_devices.id", ondelete="RESTRICT")
    )
    credential_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
