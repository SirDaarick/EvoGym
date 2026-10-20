"""Staff enrollment codes table model for staff provisioning."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class StaffEnrollmentCode(Base):
    """One-time cryptographic enrollment code issued by Admin to provision staff."""

    __tablename__ = "staff_enrollment_codes"
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="ck_staff_enrollment_codes_expiry"),
        CheckConstraint("role IN ('admin', 'receptionist')", name="ck_staff_enrollment_codes_role"),
        CheckConstraint(
            "(role != 'receptionist') OR (branch_id IS NOT NULL)",
            name="ck_staff_enrollment_codes_receptionist_branch",
        ),
        Index("ix_staff_enrollment_codes_lookup", "code_hash", unique=True),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    login_identifier: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    branch_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
