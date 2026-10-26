from datetime import datetime, time
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, Time, UniqueConstraint, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column, validates

from app.db.base import Base


class StaffRosterProfile(Base):
    """Branch-owned employee identity, independent of staff login accounts."""

    __tablename__ = "staff_roster_profiles"
    __table_args__ = (
        UniqueConstraint("staff_user_id", "branch_id", name="uq_staff_roster_staff_user_branch"),
        CheckConstraint("length(full_name) > 0 AND full_name = trim(full_name)", name="ck_staff_roster_full_name"),
        CheckConstraint("length(position) > 0 AND position = trim(position)", name="ck_staff_roster_position"),
        CheckConstraint("(expected_entry_time IS NULL) = (grace_tolerance_minutes IS NULL)", name="ck_staff_roster_schedule_complete"),
        CheckConstraint("grace_tolerance_minutes IS NULL OR grace_tolerance_minutes BETWEEN 0 AND 1440", name="ck_staff_roster_tolerance_range"),
        Index("uq_staff_roster_branch_name", "branch_id", text("lower(full_name)"), unique=True),
        Index("ix_staff_roster_branch_active_name", "branch_id", "is_active", "full_name"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False
    )
    staff_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=True
    )
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    position: Mapped[str] = mapped_column(String(80), nullable=False)
    expected_entry_time: Mapped[time | None] = mapped_column(Time(), nullable=True)
    grace_tolerance_minutes: Mapped[int | None] = mapped_column(nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    @validates("full_name", "position")
    def normalize_text(self, key: str, value: str) -> str:
        label = "Full name" if key == "full_name" else "Position"
        if not isinstance(value, str):
            raise TypeError(f"{label} must be text")
        normalized = value.strip()
        if not normalized:
            raise ValueError(f"{label} must not be empty")
        if len(normalized) > (160 if key == "full_name" else 80):
            raise ValueError(f"{label} is too long")
        return normalized
