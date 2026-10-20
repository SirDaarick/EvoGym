from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Uuid, event, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuditEvent(Base):
    """Minimal append-only application audit record; transaction owned by caller."""

    __tablename__ = "audit_events"
    __table_args__ = (
        CheckConstraint("action IN ('member_read', 'member_write', 'finance_read', 'shift_post', 'staff_authorization_changed')", name="ck_audit_events_action"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    actor_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    request_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


@event.listens_for(AuditEvent, "before_update")
def _reject_audit_update(_mapper, _connection, _target) -> None:
    raise ValueError("Audit events are append-only")


@event.listens_for(AuditEvent, "before_delete")
def _reject_audit_delete(_mapper, _connection, _target) -> None:
    raise ValueError("Audit events are append-only")
