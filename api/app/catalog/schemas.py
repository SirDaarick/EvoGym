"""Catalog DTOs and API schemas."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator


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
    duration_value: int
    duration_unit: str
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
    duration_value: int = Field(..., gt=0, description="Duration value in duration_unit units.")
    duration_unit: str = Field(..., pattern="^(day|month|year)$", description="Duration time unit.")
    eligibility_type: str | None = Field(None, max_length=64, description="Optional special program eligibility tag.")
    restriction_notes: str | None = Field(None, description="Operational notes or schedule restrictions.")
    services: list[PlanVersionServiceCreateDTO] = Field(default_factory=list, description="Included service compositions.")


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
