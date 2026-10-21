from datetime import date, datetime, time
from uuid import UUID, uuid4

from sqlalchemy import Date, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Time, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import event

from app.db.base import Base
from app.db.models.staff_roster import StaffRosterProfile

Index("uq_staff_roster_id_branch", StaffRosterProfile.id, StaffRosterProfile.branch_id, unique=True)


class StaffAttendanceRecord(Base):
    """Immutable affirmative-presence event for a branch roster profile."""

    __tablename__ = "staff_attendance_records"
    __table_args__ = (
        UniqueConstraint("branch_id", "profile_id", "business_date", name="uq_staff_attendance_branch_profile_date"),
        ForeignKeyConstraint(
            ["profile_id", "branch_id"],
            ["staff_roster_profiles.id", "staff_roster_profiles.branch_id"],
            name="fk_staff_attendance_profile_branch",
            ondelete="RESTRICT",
        ),
        Index("ix_staff_attendance_branch_date", "branch_id", "business_date", "occurred_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    profile_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    recorded_by: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    expected_entry_time: Mapped[time | None] = mapped_column(Time(), nullable=True)
    grace_tolerance_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)


class StaffAttendanceCheckout(Base):
    """Immutable checkout event associated with one attendance entry."""

    __tablename__ = "staff_attendance_checkouts"
    __table_args__ = (UniqueConstraint("attendance_id", name="uq_staff_attendance_checkout_entry"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    attendance_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_attendance_records.id", ondelete="RESTRICT"), nullable=False)
    recorded_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


@event.listens_for(StaffAttendanceRecord, "before_update")
def _reject_attendance_update(_mapper, _connection, _target) -> None:
    raise ValueError("Staff attendance records are append-only")


@event.listens_for(StaffAttendanceRecord, "before_delete")
def _reject_attendance_delete(_mapper, _connection, _target) -> None:
    raise ValueError("Staff attendance records are append-only")


@event.listens_for(StaffAttendanceCheckout, "before_update")
@event.listens_for(StaffAttendanceCheckout, "before_delete")
def _reject_checkout_mutation(_mapper, _connection, _target) -> None:
    raise ValueError("Staff attendance checkouts are append-only")
