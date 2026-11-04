"""Staff attendance request/response DTOs."""
from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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
