from datetime import date, datetime, time, timezone
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Time,
    UniqueConstraint,
    Uuid,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.staff_roster import StaffRosterProfile

Index("uq_staff_roster_id_branch", StaffRosterProfile.id, StaffRosterProfile.branch_id, unique=True)


class StaffAttendanceRecord(Base):
    """Immutable affirmative-presence event for a branch roster profile."""

    __tablename__ = "staff_attendance_records"
    __table_args__ = (
        UniqueConstraint("branch_id", "profile_id", "series_id", "occurrence_date", name="uq_staff_attendance_series_occurrence"),
        UniqueConstraint("branch_id", "idempotency_key", name="uq_staff_attendance_idempotency"),
        ForeignKeyConstraint(
            ["profile_id", "branch_id"],
            ["staff_roster_profiles.id", "staff_roster_profiles.branch_id"],
            name="fk_staff_attendance_profile_branch",
            ondelete="RESTRICT",
        ),
        Index("ix_staff_attendance_branch_date", "branch_id", "business_date", "occurred_at"),
        Index("ix_staff_attendance_branch_occurrence", "branch_id", "occurrence_date", "profile_id"),
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

    # STAFF-2 / P6.2 / P6.3 occurrence-linked and integrity fields
    series_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_schedule_series.id", ondelete="RESTRICT"), nullable=True
    )
    occurrence_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    device_captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    server_received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=func.now()
    )
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    scheduled_start_time: Mapped[time | None] = mapped_column(Time(), nullable=True)
    scheduled_end_time: Mapped[time | None] = mapped_column(Time(), nullable=True)
    clock_skew_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    clock_validation_status: Mapped[str] = mapped_column(String(32), nullable=False, default="trusted", server_default="trusted")
    review_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    schedule_conflict: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")


class StaffAttendanceCheckout(Base):
    """Immutable checkout event associated with one attendance entry."""

    __tablename__ = "staff_attendance_checkouts"
    __table_args__ = (UniqueConstraint("attendance_id", name="uq_staff_attendance_checkout_entry"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    attendance_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_attendance_records.id", ondelete="RESTRICT"), nullable=False)
    recorded_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class StaffAttendanceCorrection(Base):
    """Append-only correction audit for an attendance entry."""

    __tablename__ = "staff_attendance_corrections"
    __table_args__ = (
        Index("ix_staff_attendance_corrections_attendance_id", "attendance_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    attendance_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_attendance_records.id", ondelete="RESTRICT"), nullable=False
    )
    corrected_by: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False
    )
    field_name: Mapped[str] = mapped_column(String(32), nullable=False)
    original_value: Mapped[str] = mapped_column(String(255), nullable=False)
    corrected_value: Mapped[str] = mapped_column(String(255), nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    corrected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=func.now()
    )


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


@event.listens_for(StaffAttendanceCorrection, "before_update")
@event.listens_for(StaffAttendanceCorrection, "before_delete")
def _reject_correction_mutation(_mapper, _connection, _target) -> None:
    raise ValueError("Staff attendance corrections are append-only")


__all__ = [
    "StaffAttendanceRecord",
    "StaffAttendanceCheckout",
    "StaffAttendanceCorrection",
]
