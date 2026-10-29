from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.db.models.inventory import normalize_product_code, normalize_product_name


class BranchDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    name: str


class ProductCreateDTO(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    code: str | None = Field(default=None, max_length=64)
    category: str = Field(default="General", max_length=64)
    price_minor: int = Field(default=0, ge=0, le=2**63 - 1)
    cost_minor: int = Field(default=0, ge=0, le=2**63 - 1)
    unit: str = Field(default="piece", pattern="^piece$")
    initial_quantity: int | None = Field(default=None, ge=0, le=2**63 - 1)
    initial_branch_id: UUID | None = None

    @field_validator("code")
    @classmethod
    def normalize_code_validator(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_product_code(value)

    @field_validator("name")
    @classmethod
    def normalize_name_validator(cls, value: str) -> str:
        return normalize_product_name(value)

    @field_validator("category")
    @classmethod
    def normalize_category_validator(cls, value: str) -> str:
        normalized = " ".join(value.split())
        return normalized if normalized else "General"


class ProductUpdateDTO(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    category: str | None = Field(default=None, max_length=64)
    price_minor: int | None = Field(default=None, ge=0, le=2**63 - 1)
    cost_minor: int | None = Field(default=None, ge=0, le=2**63 - 1)
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def normalize_name_validator(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_product_name(value)

    @field_validator("category")
    @classmethod
    def normalize_category_validator(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized if normalized else "General"


class ProductDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    name: str
    category: str = "General"
    price_minor: int = 0
    cost_minor: int = 0
    is_active: bool = True
    unit: str = "piece"
    created_by: UUID
    created_at: datetime


class StockInitializationCreateDTO(BaseModel):
    product_id: UUID
    quantity: int = Field(strict=True, ge=0, le=2**63 - 1)


class StockRowDTO(BaseModel):
    product_id: UUID
    code: str
    name: str
    category: str = "General"
    price_minor: int = 0
    cost_minor: int = 0
    is_active: bool = True
    unit: str = "piece"
    initialized: bool
    opening_quantity: int | None = None
    restocked_quantity: int = 0
    waste_quantity: int = 0
    quantity: int | None = None
    initialized_at: datetime | None = None


class ProductPageDTO(BaseModel):
    items: list[ProductDTO]
    total: int


class StockPageDTO(BaseModel):
    items: list[StockRowDTO]
    total: int


class StockInitializationDTO(BaseModel):
    id: UUID
    branch_id: UUID
    product_id: UUID
    quantity: int
    initialized_by: UUID
    initialized_at: datetime


class StockMovementCreateDTO(BaseModel):
    product_id: UUID
    kind: str = Field(pattern="^(restock|waste)$")
    quantity: int = Field(gt=0, le=2**63 - 1)
    reason: str | None = Field(default=None, max_length=240)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def validate_waste_reason(self) -> "StockMovementCreateDTO":
        if self.kind == "waste":
            if not self.reason or not self.reason.strip():
                raise ValueError("Reason is required for waste stock movements.")
            self.reason = self.reason.strip()
        elif self.reason:
            self.reason = self.reason.strip()
        return self


class StockMovementDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    branch_id: UUID
    product_id: UUID
    kind: str
    quantity: int
    reason: str | None
    recorded_by: UUID
    idempotency_key: str
    recorded_at: datetime
    on_hand_quantity: int


class StockMovementPageDTO(BaseModel):
    items: list[StockMovementDTO]
    total: int


class InventorySnapshotItemDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    product_id: UUID
    code: str
    name: str
    unit: str
    initialized: bool
    expected_quantity: int | None
    initialization_id: UUID | None
    initialized_by: UUID | None
    initialized_at: datetime | None


class RegisterInventorySnapshotDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    register_id: UUID
    branch_id: UUID
    captured_by: UUID
    captured_at: datetime
    item_count: int
    missing_count: int
    source_state: str
    items: list[InventorySnapshotItemDTO]
