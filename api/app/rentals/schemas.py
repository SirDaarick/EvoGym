from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator

from app.db.models.inventory import normalize_product_code

TenderMethod = Literal["cash", "transfer"]


class RentalAssetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_id: UUID
    kind: Literal["glove", "locker"]
    code: str
    price_minor: StrictInt = Field(ge=0, le=2**63 - 1)
    status: Literal["available", "employee", "out_of_service"] = "available"
    color: str | None = None
    ounces: StrictInt | None = Field(default=None, gt=0, le=2**31 - 1)
    locker_number: StrictInt | None = Field(default=None, gt=0, le=2**31 - 1)

    @field_validator("code")
    @classmethod
    def clean_code(cls, value: str) -> str:
        return normalize_product_code(value)

    @field_validator("color")
    @classmethod
    def clean_color(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value or len(value) > 64 or "\x00" in value:
                raise ValueError("Color must contain 1 to 64 valid characters.")
        return value

    @model_validator(mode="after")
    def check_attributes(self):
        if self.kind == "glove":
            if not self.color or self.ounces is None or self.locker_number is not None or self.status == "employee":
                raise ValueError("Gloves require color and ounces, without a locker number or employee assignment.")
        elif self.locker_number is None or self.color is not None or self.ounces is not None:
            raise ValueError("Lockers require a number, without glove attributes.")
        return self


class RentalAssetPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str | None = None
    price_minor: StrictInt | None = Field(default=None, ge=0, le=2**63 - 1)
    status: Literal["available", "employee", "out_of_service"] | None = None
    color: str | None = None
    ounces: StrictInt | None = Field(default=None, gt=0, le=2**31 - 1)
    locker_number: StrictInt | None = Field(default=None, gt=0, le=2**31 - 1)

    @model_validator(mode="before")
    @classmethod
    def reject_nulls(cls, value):
        if isinstance(value, dict) and (not value or any(item is None for item in value.values())):
            raise ValueError("Provide at least one non-null field.")
        return value


class RentalAssetDTO(RentalAssetInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    active_rental_id: UUID | None = None


class RentalAssetPage(BaseModel):
    items: list[RentalAssetDTO]
    total: int


class TenderComponentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    method: TenderMethod
    amount_minor: StrictInt = Field(gt=0, le=2**63 - 1)


class RentalCreateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_id: UUID
    asset_id: UUID
    member_id: UUID
    register_id: UUID
    components: list[TenderComponentInput] = Field(default_factory=list, max_length=8)
    expected_total_minor: StrictInt = Field(ge=0, le=2**63 - 1)
    accepted_shortfall_minor: StrictInt = Field(ge=0, le=2**63 - 1)


class RentalRenewalInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    register_id: UUID
    components: list[TenderComponentInput] = Field(default_factory=list, max_length=8)
    expected_total_minor: StrictInt = Field(ge=0, le=2**63 - 1)
    accepted_shortfall_minor: StrictInt = Field(ge=0, le=2**63 - 1)


class ReceivablePaymentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    register_id: UUID
    method: TenderMethod
    amount_minor: StrictInt = Field(gt=0, le=2**63 - 1)


class CancellationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    register_id: UUID
    preview_token: str = Field(min_length=64, max_length=64)
    refund_amount_minor: StrictInt = Field(ge=0, le=2**63 - 1)
    refund_method: Literal["cash", "card"]
    reason: str = Field(min_length=1, max_length=240)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Reason must contain 1 to 240 characters.")
        return value


class CardAttemptInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    register_id: UUID
    amount_minor: StrictInt = Field(gt=0, le=2**63 - 1)
    terminal_id: UUID | None = None


class RentalChargeDTO(BaseModel):
    id: UUID
    charge_kind: Literal["initial", "renewal"]
    amount_minor: int
    starts_on: date
    ends_on: date
    outstanding_minor: int


class RentalDTO(BaseModel):
    id: UUID
    branch_id: UUID
    asset_id: UUID
    asset_code: str
    member_id: UUID
    member_name: str
    member_number: str
    kind: Literal["glove", "locker"]
    status: Literal["active", "returned", "released", "cancelled"]
    starts_on: date | None = None
    ends_on: date | None = None
    paid_minor: int
    outstanding_minor: int
    cancelled_debt_minor: int = 0
    assigned_by_name: str
    charges: list[RentalChargeDTO] = Field(default_factory=list)
    created_at: datetime


class RentalPage(BaseModel):
    items: list[RentalDTO]
    total: int


class ReceivableAllocationDTO(BaseModel):
    charge_id: UUID
    amount_minor: int


class ReceivablePaymentDTO(BaseModel):
    id: UUID
    rental_id: UUID
    charge_id: UUID
    method: TenderMethod
    status: str
    amount_minor: int
    remaining_minor: int
    allocations: list[ReceivableAllocationDTO] = Field(default_factory=list)


class CancellationPeriodDTO(BaseModel):
    charge_id: UUID
    amount_minor: int
    starts_on: date
    ends_on: date
    outstanding_minor: int


class CancellationPreviewDTO(BaseModel):
    can_cancel: bool
    preview_token: str
    settled_minor: int
    max_refundable_minor: int
    suggested_refund_minor: int
    outstanding_minor: int
    cancelled_debt_minor: int
    periods: list[CancellationPeriodDTO] = Field(default_factory=list)


class RentalCancellationDTO(BaseModel):
    id: UUID
    rental_id: UUID
    member_id: UUID
    member_name: str
    member_number: str
    asset_id: UUID
    asset_code: str
    actor_id: UUID
    actor_name: str | None = None
    reason: str
    refund_method: Literal["cash", "card"]
    refund_amount_minor: int
    suggested_refund_minor: int
    settled_minor: int
    cancelled_debt_minor: int
    reviewed: bool
    reviewed_by: UUID | None = None
    reviewed_by_name: str | None = None
    reviewed_at: datetime | None = None
    created_at: datetime


class RentalAlertPage(BaseModel):
    items: list[RentalCancellationDTO]
    total: int


class CardAttemptDTO(BaseModel):
    id: UUID
    rental_id: UUID
    charge_id: UUID
    amount_minor: int
    status: Literal["pending", "confirmed", "failed", "unknown", "cancelled"]
    payment_id: UUID | None = None
    failure_reason: str | None = None
    created_at: datetime


class TransferReviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["confirmed", "pending"]


class RentalTransferReviewDTO(BaseModel):
    payment_id: UUID
    rental_id: UUID
    status: Literal["pending", "confirmed"]
    amount_minor: int


class MemberReceivableDTO(BaseModel):
    rental_id: UUID
    branch_id: UUID
    kind: Literal["glove", "locker"]
    asset_code: str
    outstanding_minor: int
    created_at: datetime


class MemberReceivablePage(BaseModel):
    items: list[MemberReceivableDTO]
    total_outstanding_minor: int
