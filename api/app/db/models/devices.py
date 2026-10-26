"""Staff device pairing codes and paired devices models."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class StaffDevicePairingCode(Base):
    """Short-lived 6-digit numeric device pairing code for mobile binding."""

    __tablename__ = "staff_device_pairing_codes"
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="ck_staff_device_pairing_codes_expiry"),
        CheckConstraint(
            "failed_attempts >= 0 AND failed_attempts <= 3",
            name="ck_staff_device_pairing_codes_attempts",
        ),
        Index("ix_staff_device_pairing_codes_staff", "staff_id"),
        Index("ix_staff_device_pairing_codes_hash", "code_hash"),
        Index(
            "uq_staff_active_pairing_code_hash",
            "code_hash",
            unique=True,
            postgresql_where=text("used_at IS NULL AND revoked_at IS NULL"),
            sqlite_where=text("used_at IS NULL AND revoked_at IS NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    staff_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="CASCADE"), nullable=False
    )
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class StaffPairedDevice(Base):
    """Paired mobile hardware identifier for a staff member (at most 1 active)."""

    __tablename__ = "staff_paired_devices"
    __table_args__ = (
        Index("ix_staff_paired_devices_staff", "staff_id"),
        CheckConstraint(
            "profile_access_digest IS NULL OR length(profile_access_digest) = 64",
            name="ck_staff_paired_devices_profile_access_digest",
        ),
        Index("uq_staff_paired_devices_profile_access_digest", "profile_access_digest", unique=True),
        Index(
            "uq_staff_active_paired_device",
            "staff_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
            sqlite_where=text("revoked_at IS NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    staff_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="CASCADE"), nullable=False
    )
    device_identifier_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    device_name: Mapped[str] = mapped_column(String(128), nullable=False)
    paired_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    profile_access_digest: Mapped[str | None] = mapped_column(String(64))
    profile_access_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    profile_access_last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    profile_access_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
