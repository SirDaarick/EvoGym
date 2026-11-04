"""Finance request/response models."""
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer


class PendingMoneyItem(BaseModel):
    item_type: str
    branch_id: UUID
    branch_name: str
    member_id: UUID
    member_number: str
    member_name: str
    order_id: UUID | None
    amount_minor: int
    currency: str
    source_event_id: UUID
    source_event_at: datetime
    status: str
    status_event_id: UUID | None
    status_event_at: datetime | None
    initial_amount_minor: int | None = None
    paid_amount_minor: int | None = None
    rental_id: UUID | None = None
    rental_charge_id: UUID | None = None

    @model_serializer(mode="wrap")
    def _strip_unset_rental_fields(self, handler):
        data = handler(self)
        if data.get("rental_id") is None:
            data.pop("rental_id", None)
        if data.get("rental_charge_id") is None:
            data.pop("rental_charge_id", None)
        return data


class PendingMoneyResponse(BaseModel):
    items: list[PendingMoneyItem]
    total_items: int
    total_pending_minor: int


class PayrollInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_id: UUID
    staff_profile_id: UUID
    week_start: date

    @field_validator("week_start")
    @classmethod
    def monday(cls, value: date) -> date:
        if value.weekday() != 0:
            raise ValueError("Week must start on Monday.")
        return value


class AdvanceInput(PayrollInput):
    amount_minor: int = Field(gt=0, le=9223372036854775807, strict=True)
    notes: str | None = Field(default=None, max_length=255)


class PaymentInput(PayrollInput):
    payment_method: Literal["transfer", "cash"]
