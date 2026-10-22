from datetime import date, datetime, time, timezone
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, JSON, String, Time, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class StaffScheduleSeries(Base):
    """Branch-local weekly schedule rule for a roster profile."""

    __tablename__ = "staff_schedule_series"
    __table_args__ = (
        ForeignKeyConstraint(["profile_id", "branch_id"], ["staff_roster_profiles.id", "staff_roster_profiles.branch_id"],
                             name="fk_staff_schedule_profile_branch", ondelete="RESTRICT"),
        CheckConstraint("json_array_length(weekdays) > 0", name="ck_staff_schedule_weekdays_present"),
        CheckConstraint("(end_date IS NULL) OR end_date >= start_date", name="ck_staff_schedule_date_order"),
        CheckConstraint("(occurrence_count IS NULL) OR occurrence_count > 0", name="ck_staff_schedule_count_positive"),
        CheckConstraint("NOT (end_date IS NOT NULL AND occurrence_count IS NOT NULL)", name="ck_staff_schedule_one_termination"),
        Index("ix_staff_schedule_profile_branch", "profile_id", "branch_id", "start_date"),
        Index("ix_staff_schedule_branch_dates", "branch_id", "start_date", "end_date"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    profile_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    weekdays: Mapped[list[int]] = mapped_column(JSON, nullable=False)
    start_time: Mapped[time] = mapped_column(Time(), nullable=False)
    end_time: Mapped[time] = mapped_column(Time(), nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    occurrence_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cancelled_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    timezone_rules_digest: Mapped[str] = mapped_column(String(64), nullable=False, default="unknown", server_default="unknown")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class StaffScheduleException(Base):
    """Append-only edit/skip of one local-date occurrence, including original values."""

    __tablename__ = "staff_schedule_exceptions"
    __table_args__ = (
        UniqueConstraint("series_id", "local_date", name="uq_staff_schedule_exception_occurrence"),
        CheckConstraint("action IN ('skip', 'override')", name="ck_staff_schedule_exception_action"),
        CheckConstraint("(action = 'skip') OR (override_start_time IS NOT NULL AND override_end_time IS NOT NULL)",
                        name="ck_staff_schedule_exception_override_times"),
        Index("ix_staff_schedule_exception_series_date", "series_id", "local_date"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    series_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_schedule_series.id", ondelete="RESTRICT"), nullable=False)
    local_date: Mapped[date] = mapped_column(Date, nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    original_start_time: Mapped[time] = mapped_column(Time(), nullable=False)
    original_end_time: Mapped[time] = mapped_column(Time(), nullable=False)
    override_start_time: Mapped[time | None] = mapped_column(Time(), nullable=True)
    override_end_time: Mapped[time | None] = mapped_column(Time(), nullable=True)
    recorded_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
