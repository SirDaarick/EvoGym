from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.db.models.inventory import normalize_product_code, normalize_product_name


class ProductCreateDTO(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    unit: str = Field(default="piece", pattern="^piece$")

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return normalize_product_code(value)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return normalize_product_name(value)


class ProductDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    name: str
    unit: str
    created_by: UUID
    created_at: datetime


class StockInitializationCreateDTO(BaseModel):
    product_id: UUID
    quantity: int = Field(strict=True, ge=0, le=2**63 - 1)


class StockRowDTO(BaseModel):
    product_id: UUID
    code: str
    name: str
    unit: str
    initialized: bool
    quantity: int | None
    initialized_at: datetime | None


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
