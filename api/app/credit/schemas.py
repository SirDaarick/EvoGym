from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt


class MemberCreditDepositRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    member_id: UUID
    amount_minor: StrictInt = Field(gt=0)


class MemberCreditMovementDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    member_id: UUID
    branch_id: UUID
    register_id: UUID
    shift_id: UUID
    kind: Literal["deposit", "apply"]
    amount_minor: int
    balance_after_minor: int
    order_id: UUID | None
    debt_id: UUID | None
    rental_charge_id: UUID | None
    received_by: UUID
    created_at: datetime


class MemberCreditMovementPage(BaseModel):
    total_items: int
    items: list[MemberCreditMovementDTO]
