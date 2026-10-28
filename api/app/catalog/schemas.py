"""Catalog DTOs and API schemas."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ServiceDTO(BaseModel):
    """Commercial service DTO representation."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    code: str
    name: str
    status: str
    created_at: datetime | str
    updated_at: datetime | str

    @field_validator("id", mode="before")
    @classmethod
    def _coerce_id(cls, value: object) -> str:
        return str(value)


class CreateServiceDTO(BaseModel):
    """Payload to create a commercial service."""

    code: str = Field(..., min_length=1, max_length=32, description="Unique alphanumeric identifier (e.g. gym, box).")
    name: str = Field(..., min_length=1, max_length=160, description="Display name of the service.")
    status: str = Field("active", pattern="^(active|inactive)$", description="Operational status.")


class PlanServiceLinkDTO(BaseModel):
    """Commercial service composition link inside a plan version."""

    model_config = ConfigDict(from_attributes=True)

    service_id: str
    service_code: str
    service_name: str
    session_limit: int | None = None

    @field_validator("service_id", mode="before")
    @classmethod
    def _coerce_service_id(cls, value: object) -> str:
        return str(value)


class PlanVersionServiceCreateDTO(BaseModel):
    """Link payload defining included service and optional session limit."""

    service_id: str = Field(..., description="UUID of the service to include.")
    session_limit: int | None = Field(None, gt=0, description="Optional cap on sessions/visits.")


class PlanVersionDTO(BaseModel):
    """Immutable published plan version with commercial terms."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    plan_id: str
    version_number: int
    name: str
    price_minor: int
    currency: str = "MXN"
    reference_amount_minor: int | None = None
    duration_value: int | None
    duration_unit: str | None
    entitlement_mode: str = "period"
    eligibility_type: str | None = None
    restriction_notes: str | None = None
    is_active: bool = True
    published_at: datetime | str
    services: list[PlanServiceLinkDTO] = Field(default_factory=list)

    @field_validator("id", "plan_id", mode="before")
    @classmethod
    def _coerce_uuids(cls, value: object) -> str:
        return str(value)


class PublishPlanVersionDTO(BaseModel):
    """Payload to publish a new immutable version of a plan."""

    name: str = Field(..., min_length=1, max_length=160, description="Version display name (e.g. Mensualidad General 2026).")
    price_minor: int = Field(..., ge=0, description="Commercial price in minor units (centavos MXN).")
    currency: str = Field("MXN", min_length=3, max_length=3, description="ISO-4217 currency code.")
    reference_amount_minor: int | None = Field(None, ge=0, description="Optional regular/strikethrough price.")
    duration_value: int | None = Field(None, gt=0, description="Duration value for period entitlements.")
    duration_unit: str | None = Field(None, pattern="^(day|month|year)$", description="Duration time unit for period entitlements.")
    entitlement_mode: str = Field("period", pattern="^(period|single_entry)$")
    eligibility_type: str | None = Field(None, max_length=64, description="Optional special program eligibility tag.")
    restriction_notes: str | None = Field(None, description="Operational notes or schedule restrictions.")
    services: list[PlanVersionServiceCreateDTO] = Field(default_factory=list, description="Included service compositions.")

    @model_validator(mode="after")
    def validate_entitlement_duration(self):
        if self.entitlement_mode == "period" and (self.duration_value is None or self.duration_unit is None):
            raise ValueError("Period entitlements require a duration and unit.")
        if self.entitlement_mode == "single_entry" and (self.duration_value is not None or self.duration_unit is not None):
            raise ValueError("Single-entry entitlements cannot have a period duration.")
        return self


class PlanDTO(BaseModel):
    """Commercial plan representation with its version history."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    code: str
    name: str
    kind: str
    status: str
    created_at: datetime | str
    updated_at: datetime | str
    current_version: PlanVersionDTO | None = None
    versions: list[PlanVersionDTO] = Field(default_factory=list)

    @field_validator("id", mode="before")
    @classmethod
    def _coerce_id(cls, value: object) -> str:
        return str(value)


class CreatePlanDTO(BaseModel):
    """Payload to create a plan with optional initial published version."""

    code: str = Field(..., min_length=1, max_length=48, description="Unique plan code (e.g. gym_month, combo_month).")
    name: str = Field(..., min_length=1, max_length=160, description="Display name of the plan.")
    kind: str = Field("membership", pattern="^(membership|visit)$", description="Plan kind.")
    initial_version: PublishPlanVersionDTO | None = Field(None, description="Optional initial version to publish immediately.")

class PatchPlanDTO(BaseModel):
    """Mutable plan metadata and availability; published terms stay immutable."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(None, min_length=1, max_length=160)
    status: str | None = Field(None, pattern="^(active|inactive)$")

    @model_validator(mode="after")
    def require_changes(self):
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Plan name cannot be null.")
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("Plan status cannot be null.")
        if self.name is None and self.status is None:
            raise ValueError("At least one plan field must be provided.")
        return self