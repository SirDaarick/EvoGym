"""Request and response schemas for the first cash membership sale slice."""
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt


class CashMembershipSaleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    member_id: UUID
    plan_version_id: UUID
    source_shift_id: UUID | None = None
    cash_amount_minor: StrictInt | None = Field(default=None, gt=0)


class TransferReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["confirmed", "pending"]


class MembershipDebtPaymentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_id: UUID
    amount_minor: StrictInt = Field(gt=0)


class MembershipDebtPaymentDTO(BaseModel):
    id: UUID
    debt_id: UUID
    order_id: UUID
    member_id: UUID
    branch_id: UUID
    register_id: UUID
    shift_id: UUID
    amount_minor: int
    remaining_balance_minor: int = Field(validation_alias="remaining_after_minor")
    received_by: UUID
    received_at: datetime = Field(validation_alias="created_at")


class RegisterMemberOpenDebtDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    debt_id: UUID
    order_id: UUID
    member_id: UUID
    branch_id: UUID
    currency: str
    description_snapshot: str
    initial_outstanding_minor: int
    paid_amount_minor: int
    remaining_balance_minor: int
    created_at: datetime


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
    duration_value: int | None
    duration_unit: str | None
    entitlement_mode: Literal["period", "single_entry"] = "period"
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


class ClassSampleEntitlementDTO(BaseModel):
    id: UUID
    member_id: UUID
    order_item_id: UUID
    plan_version_id: UUID
    created_at: datetime


class CashMembershipSaleDTO(BaseModel):
    order: CashSaleOrderDTO
    item: CashSaleItemDTO
    payment: CashSalePaymentDTO
    membership: MembershipPeriodDTO | None
    sample_entitlement: ClassSampleEntitlementDTO | None = None
