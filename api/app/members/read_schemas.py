"""Pydantic V2 schemas for Member Reload Read Contract (v1)."""
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class MemberProfileDTO(BaseModel):
    """Core organization-shared member identity per D-001."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID = Field(..., description="Stable internal member UUIDv7/v4")
    organization_id: UUID = Field(..., description="Owning organization ID per D-001")
    home_branch_id: UUID = Field(..., description="Branch where member originally registered")
    member_number: str = Field(..., min_length=1, max_length=32, description="Human sequence identifier e.g. SOC-0001")
    full_name: str = Field(..., min_length=1, max_length=160)
    preferred_name: str | None = Field(default=None, max_length=160)
    phone: str = Field(..., min_length=1, max_length=32, description="E.164 or normalized mobile WhatsApp number")
    email: str | None = Field(default=None, max_length=320)
    birth_date: date | None = Field(default=None, description="Personal date of birth; age derived on display")
    joined_on: date = Field(..., description="Date joined gym")
    status: Literal["active", "inactive", "expired", "suspended", "pending"] = Field(...)
    photo_url: str | None = Field(default=None, max_length=512)
    emergency_contact_name: str | None = Field(default=None, max_length=160)
    emergency_contact_phone: str | None = Field(default=None, max_length=32)


class MemberPeriodReadDTO(BaseModel):
    """Stable membership period entitlement with validity interval."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID = Field(..., description="Stable membership period UUID")
    order_item_id: UUID = Field(..., description="Originating order line item UUID")
    plan_version_id: UUID = Field(..., description="Immutable published plan version UUID")
    plan_name: str = Field(..., min_length=1, max_length=120, description="Snapshot of plan name at sale")
    starts_on: date = Field(..., description="Start of validity interval (inclusive)")
    ends_on: date = Field(..., description="End of validity interval (exclusive) per D-005")
    branch_id: UUID | None = Field(
        default=None,
        description="Branch restriction UUID; NULL grants access across all branches per D-001",
    )
    is_current: bool = Field(..., description="True if today falls within [starts_on, ends_on) in branch timezone")
    access_status: Literal["eligible", "expired", "restricted_unpaid", "restricted_admin", "branch_restricted"] = Field(
        ..., description="Access status derived by evaluate_membership_access"
    )


class ClassSampleReadDTO(BaseModel):
    """Single-entry paid class sample entitlement per D-019."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID = Field(..., description="Stable sample entitlement UUID")
    order_item_id: UUID = Field(..., description="Originating order line item UUID")
    plan_version_id: UUID = Field(..., description="Plan version UUID")
    plan_name: str = Field(..., min_length=1, max_length=120)
    is_consumed: bool = Field(..., description="True if check-in has already been recorded")
    consumed_at: datetime | None = Field(default=None, description="UTC ISO instant when consumed")
    consumed_visit_id: UUID | None = Field(default=None, description="Attendance visit UUID where consumed")


class MemberDebtItemDTO(BaseModel):
    """Itemized outstanding debt originating from partial cash payments (Admin only per D-012/D-013)."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    debt_id: UUID = Field(..., description="Stable debt record UUID")
    order_id: UUID = Field(..., description="Target order UUID required for repayments")
    branch_id: UUID = Field(..., description="Branch where order was created")
    currency: Literal["MXN"] = Field(default="MXN", description="Currency per D-003")
    initial_outstanding_minor: int = Field(..., gt=0, description="Initial unpaid centavos at sale")
    remaining_balance_minor: int = Field(..., ge=0, description="Current unpaid centavos after repayments")
    created_at: datetime = Field(..., description="UTC ISO creation instant")


class MemberRentalDebtItemDTO(BaseModel):
    """Outstanding rental receivable projected to administrators."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    rental_id: UUID
    branch_id: UUID
    kind: Literal["glove", "locker"]
    asset_code: str
    outstanding_minor: int = Field(..., ge=0)
    created_at: datetime


class MemberFinancialSummaryDTO(BaseModel):
    """Financial status projection partitioned by role visibility (D-012)."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    has_pending_balance: bool = Field(..., description="Boolean flag visible to all roles per D-013")
    credit_balance_minor: int = Field(default=0, ge=0, description="Available advance credit in centavos")
    total_pending_balance_minor: int | None = Field(
        default=None, ge=0, description="Sum of unpaid debts in centavos; None for Receptionist"
    )
    currency: Literal["MXN"] = Field(default="MXN")
    debts: list[MemberDebtItemDTO] = Field(
        default_factory=list, description="Itemized debt list; empty for Receptionist"
    )
    rental_pending_balance_minor: int | None = Field(
        default=None, ge=0, description="Outstanding rental receivable; None for Receptionist"
    )
    rental_debts: list[MemberRentalDebtItemDTO] = Field(
        default_factory=list, description="Itemized rental receivables; empty for Receptionist"
    )


class MemberVisitLogDTO(BaseModel):
    """Recent check-in events strictly scoped to querying branch per D-001."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID = Field(..., description="Check-in event UUID")
    visit_id: UUID = Field(..., description="Durable visit record UUID")
    branch_id: UUID = Field(..., description="Branch where check-in occurred")
    period_id: UUID | None = Field(default=None, description="Associated period UUID if regular membership")
    sample_entitlement_id: UUID | None = Field(default=None, description="Associated sample UUID if class sample")
    occurred_at: datetime = Field(..., description="UTC ISO instant of entry")
    access_reason: str = Field(..., description="Granted access reason e.g. valid_membership, paid_sample")
    access_warnings: list[str] = Field(default_factory=list, description="Warnings e.g. pending_balance_unpaid")


class MemberReloadResponseDTO(BaseModel):
    """Root reloadable member response payload."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    profile: MemberProfileDTO
    active_periods: list[MemberPeriodReadDTO] = Field(default_factory=list)
    class_samples: list[ClassSampleReadDTO] = Field(default_factory=list)
    financial: MemberFinancialSummaryDTO
    recent_visits: list[MemberVisitLogDTO] = Field(
        default_factory=list, description="Bounded last N visits ordered desc by occurred_at"
    )
    server_time: datetime = Field(..., description="Authoritative server UTC instant")
