"""DTOs and schemas for payment terminals, cash registers, and shifts."""
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator

MAX_MINOR_UNITS = 2**63 - 1


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
    denomination_counts: list["ShiftDenominationCountDTO"] = Field(default_factory=list)
    inventory_review: "ShiftInventoryReviewDTO | None" = None
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
    opening_cash_minor: StrictInt | None = Field(
        None, ge=0, le=MAX_MINOR_UNITS, description="Optional compatibility total; must match denomination counts."
    )
    denomination_counts: list["ShiftDenominationCountDTO"] = Field(
        ..., min_length=1, max_length=64, description="Required physical bill and coin counts at opening."
    )
    inventory_snapshot_id: UUID
    inventory_observations: list["ShiftInventoryObservationInputDTO"] = Field(default_factory=list, max_length=10000)

    @model_validator(mode="after")
    def _validate_opening_total(self) -> "OpenShiftDTO":
        total = 0
        seen: set[int] = set()
        for item in self.denomination_counts:
            if item.denomination_minor in seen:
                raise ValueError("Opening denomination counts cannot contain duplicates.")
            seen.add(item.denomination_minor)
            value = item.denomination_minor * item.quantity
            if value > MAX_MINOR_UNITS or total > MAX_MINOR_UNITS - value:
                raise ValueError("Opening denomination total exceeds signed 64-bit minor units.")
            total += value
        if self.opening_cash_minor is not None and self.opening_cash_minor != total:
            raise ValueError("Opening cash total must match denomination counts.")
        self.opening_cash_minor = total
        seen_products: set[UUID] = set()
        for observation in self.inventory_observations:
            if observation.product_id in seen_products:
                raise ValueError("Inventory observations cannot contain duplicate products.")
            seen_products.add(observation.product_id)
        return self


class ShiftDenominationCountDTO(BaseModel):
    """One denomination and its counted quantity."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    denomination_minor: StrictInt = Field(..., gt=0, le=MAX_MINOR_UNITS)
    quantity: StrictInt = Field(..., ge=0, le=MAX_MINOR_UNITS)


class ShiftInventoryObservationInputDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: UUID
    physical_quantity: StrictInt = Field(..., ge=0, le=MAX_MINOR_UNITS)


class ShiftInventoryObservationDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    product_id: UUID
    code: str
    name: str
    unit: str
    physical_quantity: int


class ShiftInventoryReviewDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    snapshot_id: UUID
    confirmed_by: UUID
    confirmed_at: datetime
    mode: str
    source_state: str
    item_count: int
    missing_count: int
    observations: list[ShiftInventoryObservationDTO] = Field(default_factory=list)


ShiftDTO.model_rebuild()
OpenShiftDTO.model_rebuild()
