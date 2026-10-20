from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, Uuid, event, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AdminPasswordCredential(Base):
    """Server-provisioned Admin password and verified recovery destination."""

    __tablename__ = "admin_password_credentials"
    __table_args__ = (
        UniqueConstraint("staff_id", name="uq_admin_password_staff"),
        CheckConstraint("failed_attempts >= 0", name="ck_admin_password_failed_attempts"),
        CheckConstraint("length(password_hash) >= 50", name="ck_admin_password_hash_nonempty"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    staff_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="CASCADE"), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    recovery_email: Mapped[str] = mapped_column(String(320), nullable=False)
    recovery_email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_attempts: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AdminAuthEvent(Base):
    """Minimal append-only audit for successful Admin authentication lifecycle mutations."""

    __tablename__ = "admin_auth_events"
    __table_args__ = (
        CheckConstraint(
            "action IN ('admin_password_login_succeeded', 'admin_password_recovered', 'admin_session_revoked')",
            name="ck_admin_auth_events_action",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    actor_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    subject_staff_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    action: Mapped[str] = mapped_column(String(48), nullable=False)
    request_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


@event.listens_for(AdminAuthEvent, "before_update")
def _reject_admin_auth_event_update(_mapper, _connection, _target) -> None:
    raise ValueError("Admin authentication events are append-only")


@event.listens_for(AdminAuthEvent, "before_delete")
def _reject_admin_auth_event_delete(_mapper, _connection, _target) -> None:
    raise ValueError("Admin authentication events are append-only")
