from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AdminTrustedDevice(Base):
    __tablename__ = "admin_trusted_devices"
    __table_args__ = (
        CheckConstraint("category IN ('computer', 'phone')", name="ck_admin_trusted_devices_category"),
        Index("ix_admin_trusted_devices_staff_category", "staff_id", "category"),
        Index("ix_admin_trusted_devices_cookie_digest", "cookie_digest", unique=True),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    staff_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="CASCADE"), nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    cookie_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AdminLoginApproval(Base):
    __tablename__ = "admin_login_approvals"
    __table_args__ = (
        CheckConstraint("category IN ('computer', 'phone')", name="ck_admin_login_approvals_category"),
        Index("ix_admin_login_approvals_staff_category", "staff_id", "category"),
        Index("ix_admin_login_approvals_link_digest", "approval_token_digest", unique=True),
        Index("ix_admin_login_approvals_poll_digest", "poll_token_digest", unique=True),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    staff_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="CASCADE"), nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    approval_token_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    poll_token_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
