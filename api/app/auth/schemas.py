"""Request/response models for the admin staff-account and role-management use cases."""
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StaffAccountLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    staff_user_id: UUID


class ResolveProductSaleIntentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str


class StaffAccountItem(BaseModel):
    id: UUID
    login_identifier: str
    is_active: bool
    link_state: str
    linked_profile_id: UUID | None


class StaffAccountPage(BaseModel):
    accounts: list[StaffAccountItem]


class AdminBranchItem(BaseModel):
    id: UUID
    code: str
    name: str
    timezone: str


class AdminBranchPage(BaseModel):
    branches: list[AdminBranchItem]


class AdminRosterProfileItem(BaseModel):
    id: UUID
    full_name: str
    position: str
    is_active: bool
    staff_user_id: UUID | None
    monthly_salary_minor: int | None = None


class AdminRosterProfilePage(BaseModel):
    profiles: list[AdminRosterProfileItem]


class StaffAccountLinkResult(BaseModel):
    profile_id: UUID
    staff_user_id: UUID
    link_state: str


class ReceptionStationCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_id: UUID


class ReceptionStationItem(BaseModel):
    id: UUID
    branch_id: UUID
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None


class ReceptionStationPage(BaseModel):
    stations: list[ReceptionStationItem]


class ReceptionStationIssued(ReceptionStationItem):
    station_credential: str


class BundlePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    permissions: list[str] = Field(min_length=1, max_length=20)


class AssignmentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    staff_id: UUID
    bundle_id: UUID
    scope_kind: Literal["organization", "branch"]
    branch_id: UUID | None = None


class ReceptionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_id: UUID
