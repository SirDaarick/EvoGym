from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AdminRecoveryToken(Base):
    """Digest-only, single-use Admin recovery capability."""

    __tablename__ = "admin_recovery_tokens"
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="ck_admin_recovery_expiry"),
        CheckConstraint("delivery_status IN ('pending', 'sent', 'failed')", name="ck_admin_recovery_delivery"),
        Index("ix_admin_recovery_token_digest", "token_digest", unique=True),
        Index("ix_admin_recovery_staff", "staff_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    staff_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="CASCADE"), nullable=False)
    token_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    email_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    delivery_status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
