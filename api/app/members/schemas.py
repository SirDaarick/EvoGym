"""Member DTOs and API schemas."""
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator


class MemberListItemDTO(BaseModel):
    """Operational member list item representation."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    member_number: str
    full_name: str
    preferred_name: str | None = None
    phone: str
    status: str
    joined_on: date | str
    credit_balance_minor: int
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    photo_url: str | None = None

    @field_validator("id", mode="before")
    @classmethod
    def _coerce_id(cls, value: object) -> str:
        return str(value)


class MemberDetailDTO(MemberListItemDTO):
    """Detailed member view with sensitive notes subject to role-based filtering."""

    email: str | None = None
    birth_date: date | str | None = None
    notes: str | None = None
    pending_balance_minor: int = 0
    has_pending_balance: bool = False


class MemberListResponseDTO(BaseModel):
    """Paginated response payload for members list."""

    items: list[MemberListItemDTO]
    total: int
    page: int
    limit: int
    pages: int


class MemberNoteDTO(BaseModel):
    """Member note DTO representation."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    member_id: str
    author_id: str
    body: str
    created_at: datetime | str
    voided_at: datetime | str | None = None
    voided_by: str | None = None
    is_voided: bool = False

    @field_validator("id", "member_id", "author_id", mode="before")
    @classmethod
    def _coerce_uuids(cls, value: object) -> str:
        return str(value)

    @field_validator("voided_by", mode="before")
    @classmethod
    def _coerce_opt_uuid(cls, value: object) -> str | None:
        return str(value) if value is not None else None


class CreateMemberNoteDTO(BaseModel):
    """Payload to create a new restricted member note."""

    body: str = Field(..., min_length=1, max_length=5000)


class MemberEligibilityDTO(BaseModel):
    """Member eligibility attestation record representation."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    member_id: str
    eligibility_type: str
    verified_by: str
    verified_at: datetime | str
    valid_until: date | str | None = None
    notes: str | None = None
    is_valid: bool = True
    revoked_at: datetime | str | None = None
    revoked_by: str | None = None

    @field_validator("id", "member_id", "verified_by", mode="before")
    @classmethod
    def _coerce_uuids(cls, value: object) -> str:
        return str(value)

    @field_validator("revoked_by", mode="before")
    @classmethod
    def _coerce_opt_uuid(cls, value: object) -> str | None:
        return str(value) if value is not None else None


class CreateMemberEligibilityDTO(BaseModel):
    """Payload to register a new eligibility attestation."""

    eligibility_type: str = Field(..., min_length=1, max_length=64)
    valid_until: date | None = None
    notes: str | None = None


class CreateMemberDTO(BaseModel):
    """Payload to register a new member."""

    member_number: str = Field(..., min_length=1, max_length=32)
    full_name: str = Field(..., min_length=1, max_length=160)
    preferred_name: str | None = Field(None, max_length=160)
    phone: str = Field(..., min_length=1, max_length=32)
    email: str | None = Field(None, max_length=320)
    birth_date: date | None = None
    emergency_contact_name: str | None = Field(None, max_length=160)
    emergency_contact_phone: str | None = Field(None, max_length=32)
    photo_url: str | None = Field(None, max_length=512)
    joined_on: date | None = None
    initial_notes: str | None = Field(None, max_length=5000)


class UpdateMemberDTO(BaseModel):
    """Payload to update member demographic and operational information."""

    full_name: str | None = Field(None, min_length=1, max_length=160)
    preferred_name: str | None = Field(None, max_length=160)
    phone: str | None = Field(None, min_length=1, max_length=32)
    email: str | None = Field(None, max_length=320)
    birth_date: date | None = None
    emergency_contact_name: str | None = Field(None, max_length=160)
    emergency_contact_phone: str | None = Field(None, max_length=32)
    photo_url: str | None = Field(None, max_length=512)
    status: str | None = Field(None, pattern=r"^(active|inactive|expired|suspended|pending)$")


