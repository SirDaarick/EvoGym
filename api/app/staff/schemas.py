"""Staff attendance, roster and schedule request/response DTOs."""
from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.staff.recurrence import validate_rule_values


class StaffAttendanceItem(BaseModel):
    id: UUID
    profile_id: UUID
    branch_id: UUID
    full_name: str
    position: str
    recorded_by: str
    occurred_at: datetime
    business_date: date
    status: str | None = None
    expected_entry_time: time | None = None
    grace_tolerance_minutes: int | None = None
    checkout_at: datetime | None = None
    checkout_recorded_by: UUID | None = None

    # STAFF-2 / P6.2 / P6.3 fields
    series_id: UUID | None = None
    occurrence_date: date | None = None
    device_captured_at: datetime | None = None
    server_received_at: datetime | None = None
    idempotency_key: str | None = None
    covered_profile_id: UUID | None = None
    notes: str | None = None
    scheduled_start_time: time | None = None
    scheduled_end_time: time | None = None
    clock_skew_seconds: int | None = None
    clock_validation_status: str = "trusted"
    review_required: bool = False
    schedule_conflict: bool = False


class StaffAttendanceCheckoutItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    attendance_id: UUID
    recorded_by: UUID
    occurred_at: datetime


class StaffAttendanceCorrectionItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    attendance_id: UUID
    corrected_by: UUID
    field_name: str
    original_value: str
    corrected_value: str
    reason: str
    corrected_at: datetime


class StaffAttendanceCreateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    series_id: UUID | None = None
    occurrence_date: date | None = None
    device_captured_at: datetime | None = None
    idempotency_key: str | None = None
    covered_profile_id: UUID | None = None
    notes: str | None = None


class StaffAttendanceCorrectionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    field_name: str = Field(min_length=1, max_length=32)
    corrected_value: str = Field(min_length=1, max_length=255)
    reason: str = Field(min_length=5, max_length=255)


class StaffCheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    device_captured_at: datetime | None = None
    idempotency_key: str | None = None


class StaffAttendancePage(BaseModel):
    items: list[StaffAttendanceItem]
    total: int


# --- roster ---

class StaffRosterCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str = Field(min_length=1, max_length=160)
    position: str = Field(min_length=1, max_length=80)


class StaffRosterUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str | None = Field(default=None, min_length=1, max_length=160)
    position: str | None = Field(default=None, min_length=1, max_length=80)
    is_active: bool | None = None
    expected_entry_time: time | None = None
    grace_tolerance_minutes: int | None = Field(default=None, ge=0, le=1440)
    monthly_salary_minor: int | None = Field(default=None, ge=0, le=9223372036854775807, strict=True)


class StaffRosterItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    branch_id: UUID
    full_name: str
    position: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    expected_entry_time: time | None = None
    grace_tolerance_minutes: int | None = None


class StaffRosterPage(BaseModel):
    items: list[StaffRosterItem]
    total: int


class StaffRosterPatchResult(StaffRosterItem):
    monthly_salary_minor: int | None = None


# --- schedules ---

class SeriesCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_date: date
    weekdays: list[int] = Field(min_length=1, max_length=7)
    start_time: time
    end_time: time
    end_date: date | None = None
    occurrence_count: int | None = Field(default=None, ge=1, le=100000)

    @model_validator(mode="after")
    def validate_rule(self):
        validate_rule_values(self.start_date, self.weekdays, self.start_time, self.end_time,
                             self.end_date, self.occurrence_count)
        return self


class OccurrenceEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str
    start_time: time | None = None
    end_time: time | None = None

    @model_validator(mode="after")
    def validate_edit(self):
        if self.action == "skip":
            if self.start_time is not None or self.end_time is not None:
                raise ValueError("Skipped occurrences cannot include override times")
        elif self.action == "override":
            if self.start_time is None or self.end_time is None:
                raise ValueError("Override requires start_time and end_time")
        else:
            raise ValueError("action must be skip or override")
        if self.start_time is not None and self.start_time.tzinfo is not None:
            raise ValueError("Schedule times must be local wall times without offsets")
        if self.end_time is not None and self.end_time.tzinfo is not None:
            raise ValueError("Schedule times must be local wall times without offsets")
        return self


class SeriesEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    effective_date: date
    scope: str
    weekdays: list[int] | None = Field(default=None, min_length=1, max_length=7)
    start_time: time | None = None
    end_time: time | None = None
    end_date: date | None = None
    occurrence_count: int | None = Field(default=None, ge=1, le=100000)

    @model_validator(mode="after")
    def validate_scope(self):
        # all_future is an alias of series ("Toda la serie" in the frontend).
        if self.scope not in {"this_and_future", "series", "all_future"}:
            raise ValueError("scope must be this_and_future or series")
        if self.end_date is not None and self.occurrence_count is not None:
            raise ValueError("Choose either end_date or occurrence_count")
        if self.weekdays is not None and (len(set(self.weekdays)) != len(self.weekdays)
                                          or any(day < 0 or day > 6 for day in self.weekdays)):
            raise ValueError("weekdays must contain unique ISO weekday values from 0 to 6")
        if self.start_time is not None and self.start_time.tzinfo is not None:
            raise ValueError("Schedule times must be local wall times without offsets")
        if self.end_time is not None and self.end_time.tzinfo is not None:
            raise ValueError("Schedule times must be local wall times without offsets")
        return self
