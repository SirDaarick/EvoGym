"""Request and response schemas for sales, returns, and card terminal integrations."""
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt


class ProductCartLineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: UUID
    quantity: StrictInt = Field(gt=0, le=2**63 - 1)


class CashProductSaleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    member_id: UUID | None = None
    items: list[ProductCartLineRequest] = Field(min_length=1, max_length=100)
    expected_total_minor: StrictInt = Field(ge=0, le=2**63 - 1)


class CardProductSaleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    member_id: UUID | None = None
    items: list[ProductCartLineRequest] = Field(min_length=1, max_length=100)
    expected_total_minor: StrictInt = Field(ge=0, le=2**63 - 1)
    card_intent_id: str = Field(min_length=1, max_length=64)


class CreateCardIntentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount_minor: StrictInt = Field(gt=0, le=2**63 - 1)
    external_reference: str = Field(min_length=1, max_length=128)


class CardIntentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")
    id: str
    payment_intent_id: str
    device_id: str
    amount_minor: int
    status: str
    authorization_code: str | None = None
    card_brand: str | None = None
    last_four_digits: str | None = None


class ProductSaleOrderDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    branch_id: UUID
    register_id: UUID
    shift_id: UUID
    member_id: UUID | None
    seller_id: UUID
    total_minor: int
    currency: str
    created_at: datetime


class ProductSaleItemDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    product_id: UUID
    description_snapshot: str
    quantity: int
    unit_amount_minor: int
    line_total_minor: int


class ProductSalePaymentDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    method: str
    status: str
    amount_minor: int
    received_by: UUID
    received_at: datetime
    terminal_id: UUID | None = None
    card_brand: str | None = None
    card_last_four: str | None = None
    authorization_code: str | None = None


class CashProductSaleDTO(BaseModel):
    order: ProductSaleOrderDTO
    items: list[ProductSaleItemDTO]
    payment: ProductSalePaymentDTO


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


class EligibleProductReturnDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    order_item_id: UUID
    order_id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    unit_amount_minor: int
    line_total_minor: int
    original_payment_method: str
    created_at: datetime


class ProductReturnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_item_id: UUID
    reason: str = Field(min_length=1, max_length=240)
    disposition: Literal["restock", "waste"]
    payout_method: Literal["cash", "card"]


class ProductRefundDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order_item_id: UUID
    branch_id: UUID
    register_id: UUID
    shift_id: UUID
    financial_shift_id: UUID | None
    actor_id: UUID
    reason: str
    disposition: Literal["restock", "waste"]
    payout_method: Literal["cash", "card"]
    amount_minor: int
    quantity: int
    idempotency_key: str
    created_at: datetime
