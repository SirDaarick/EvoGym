"""Request and response schemas for the first cash membership sale slice."""
from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CashMembershipSaleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    member_id: UUID
    plan_version_id: UUID
    source_shift_id: UUID | None = None


class CashSaleOrderDTO(BaseModel):
    id: UUID
    branch_id: UUID
    register_id: UUID
    source_shift_id: UUID = Field(validation_alias="shift_id")
    financial_shift_id: UUID | None
    is_overtime: bool
    cash_included_in_opening: bool
    member_id: UUID
    seller_id: UUID
    currency: str
    total_minor: int
    created_at: datetime


class CashSaleItemDTO(BaseModel):
    id: UUID
    plan_version_id: UUID
    description: str = Field(validation_alias="description_snapshot")
    duration_value: int
    duration_unit: str
    quantity: int
    unit_amount_minor: int
    line_total_minor: int


class CashSalePaymentDTO(BaseModel):
    id: UUID
    method: str
    status: str
    amount_minor: int
    received_by: UUID
    received_at: datetime


class MembershipPeriodDTO(BaseModel):
    id: UUID
    member_id: UUID
    plan_version_id: UUID
    starts_on: date
    ends_on: date
    activated_by: UUID
    created_at: datetime


class CashMembershipSaleDTO(BaseModel):
    order: CashSaleOrderDTO
    item: CashSaleItemDTO
    payment: CashSalePaymentDTO
    membership: MembershipPeriodDTO
