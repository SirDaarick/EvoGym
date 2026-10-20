"""DTOs and schemas for payment terminals, cash registers, and shifts."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator


class PaymentTerminalDTO(BaseModel):
    """Payment terminal DTO."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    branch_id: str
    code: str
    name: str
    provider: str
    device_id: str
    mp_store_id: str | None = None
    mp_pos_id: str | None = None
    status: str
    created_at: datetime | str
    updated_at: datetime | str

    @field_validator("id", "branch_id", mode="before")
    @classmethod
    def _coerce_uuid(cls, value: object) -> str:
        return str(value)


class CreatePaymentTerminalDTO(BaseModel):
    """Payload to create a payment terminal."""

    branch_id: str = Field(..., description="UUID of the branch.")
    code: str = Field(..., min_length=1, max_length=32, description="Unique code within branch.")
    name: str = Field(..., min_length=1, max_length=160, description="Display name for terminal.")
    device_id: str = Field(..., min_length=1, max_length=64, description="Point serial or device ID.")
    provider: str = Field("mercado_pago", max_length=32, description="Payment provider identifier.")
    mp_store_id: str | None = Field(None, max_length=64, description="Mercado Pago store ID.")
    mp_pos_id: str | None = Field(None, max_length=64, description="Mercado Pago POS ID.")


class CashRegisterDTO(BaseModel):
    """Cash register DTO representation."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    branch_id: str
    code: str
    name: str
    default_terminal_id: str | None = None
    status: str
    has_open_shift: bool = False
    created_at: datetime | str
    updated_at: datetime | str

    @field_validator("id", "branch_id", mode="before")
    @classmethod
    def _coerce_uuid(cls, value: object) -> str:
        return str(value)

    @field_validator("default_terminal_id", mode="before")
    @classmethod
    def _coerce_optional_uuid(cls, value: object) -> str | None:
        return str(value) if value is not None else None


class CreateCashRegisterDTO(BaseModel):
    """Payload to create a cash register."""

    branch_id: str = Field(..., description="UUID of the branch.")
    code: str = Field(..., min_length=1, max_length=32, description="Unique code within branch.")
    name: str = Field(..., min_length=1, max_length=160, description="Display name for cash register.")
    default_terminal_id: str | None = Field(None, description="Optional default payment terminal UUID.")


class ShiftDTO(BaseModel):
    """Shift DTO representation."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    cash_register_id: str
    opened_by: str
    closed_by: str | None = None
    opened_at: datetime | str
    closed_at: datetime | str | None = None
    status: str
    opening_cash_minor: int
    expected_cash_at_close_minor: int | None = None
    counted_cash_minor: int | None = None
    difference_minor: int | None = None
    closing_notes: str | None = None

    @field_validator("id", "cash_register_id", "opened_by", mode="before")
    @classmethod
    def _coerce_uuid(cls, value: object) -> str:
        return str(value)

    @field_validator("closed_by", mode="before")
    @classmethod
    def _coerce_optional_uuid(cls, value: object) -> str | None:
        return str(value) if value is not None else None


class OpenShiftDTO(BaseModel):
    """Payload to open a new operational shift."""

    cash_register_id: str = Field(..., description="UUID of the cash register to open.")
    opening_cash_minor: int = Field(..., ge=0, description="Initial float cash in minor units.")
