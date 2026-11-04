"""Wire schemas for membership access decisions and member check-ins."""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class AccessDecisionRequest(BaseModel):
    action: str = Field(pattern="^(restrict|restore)$")
    reason: str = Field(min_length=1, max_length=240)


class MemberCheckInResponse(BaseModel):
    id: UUID
    visit_id: UUID
    member_id: UUID
    period_id: UUID
    branch_id: UUID
    recorded_by: UUID
    occurred_at: datetime
    access_reason: str
    access_warnings: list[str]
    replayed: bool


class ClassSampleCheckInResponse(BaseModel):
    id: UUID
    entitlement_id: UUID
    member_id: UUID
    branch_id: UUID
    recorded_by: UUID
    occurred_at: datetime
    access_reason: str
    access_warnings: list[str]
    replayed: bool
