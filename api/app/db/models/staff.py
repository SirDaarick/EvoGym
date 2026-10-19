from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.db.base import Base


class StaffUser(Base):
    __tablename__ = "staff_users"
    __table_args__ = (
        CheckConstraint(
            "length(login_identifier) > 0 AND login_identifier = lower(trim(login_identifier))",
            name="ck_staff_users_login_identifier_normalized",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    login_identifier: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    credentials: Mapped[list["StaffCredential"]] = relationship(back_populates="staff", cascade="all, delete-orphan")

    @validates("login_identifier")
    def normalize_login_identifier(self, _key: str, value: str) -> str:
        if not isinstance(value, str):
            raise TypeError("Login identifier must be text")
        normalized = value.strip().casefold()
        if not normalized:
            raise ValueError("Login identifier must not be empty")
        return normalized


class StaffCredential(Base):
    __tablename__ = "staff_credentials"
    __table_args__ = (
        UniqueConstraint("staff_id", "method", name="uq_staff_credentials_staff_method"),
        CheckConstraint("method = 'pin'", name="ck_staff_credentials_supported_method"),
        CheckConstraint("failed_attempts >= 0 AND failed_attempts <= 5", name="ck_staff_credentials_failed_attempts"),
        CheckConstraint("length(secret_hash) >= 50", name="ck_staff_credentials_hash_nonempty"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    staff_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="CASCADE"), nullable=False)
    method: Mapped[str] = mapped_column(String(16), nullable=False, default="pin", server_default="pin")
    secret_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    failed_attempts: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    staff: Mapped[StaffUser] = relationship(back_populates="credentials")


class SecurityEvent(Base):
    __tablename__ = "security_events"
    __table_args__ = (
        CheckConstraint("reason = 'staff_pin_lockout'", name="ck_security_events_reason"),
        CheckConstraint("delivery_status = 'pending'", name="ck_security_events_pending_delivery"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    staff_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    locked_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[str] = mapped_column(String(32), nullable=False, default="staff_pin_lockout", server_default="staff_pin_lockout")
    delivery_status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
