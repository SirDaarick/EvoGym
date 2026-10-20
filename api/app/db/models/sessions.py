from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Uuid, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class StaffSession(Base):
    __tablename__ = "staff_sessions"
    __table_args__ = (
        CheckConstraint("expires_at > issued_at", name="ck_staff_sessions_expiry_after_issue"),
        CheckConstraint(
            "(scope_kind = 'branch' AND branch_id IS NOT NULL AND auth_method = 'pin') OR "
            "(scope_kind = 'organization' AND branch_id IS NULL AND auth_method = 'admin_password')",
            name="ck_staff_sessions_scope_method",
        ),
        Index("ix_staff_sessions_token_digest", "token_digest", unique=True),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    staff_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="CASCADE"), nullable=False)
    branch_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"))
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False, default="branch", server_default="branch")
    auth_method: Mapped[str] = mapped_column(String(24), nullable=False, default="pin", server_default="pin")
    token_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
