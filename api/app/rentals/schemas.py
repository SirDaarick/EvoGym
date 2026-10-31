from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator

from app.db.models.inventory import normalize_product_code


class RentalAssetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_id: UUID
    kind: Literal["glove", "locker"]
    code: str
    price_minor: StrictInt = Field(ge=0, le=2**63 - 1)
    status: Literal["available", "employee", "out_of_service"] = "available"
    color: str | None = None
    ounces: StrictInt | None = Field(default=None, gt=0, le=2**31 - 1)
    locker_number: StrictInt | None = Field(default=None, gt=0, le=2**31 - 1)

    @field_validator("code")
    @classmethod
    def clean_code(cls, value: str) -> str:
        return normalize_product_code(value)

    @field_validator("color")
    @classmethod
    def clean_color(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value or len(value) > 64 or "\x00" in value:
                raise ValueError("Color must contain 1 to 64 valid characters.")
        return value

    @model_validator(mode="after")
    def check_attributes(self):
        if self.kind == "glove":
            if not self.color or self.ounces is None or self.locker_number is not None or self.status == "employee":
                raise ValueError("Gloves require color and ounces, without a locker number or employee assignment.")
        elif self.locker_number is None or self.color is not None or self.ounces is not None:
            raise ValueError("Lockers require a number, without glove attributes.")
        return self


class RentalAssetPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str | None = None
    price_minor: StrictInt | None = Field(default=None, ge=0, le=2**63 - 1)
    status: Literal["available", "employee", "out_of_service"] | None = None
    color: str | None = None
    ounces: StrictInt | None = Field(default=None, gt=0, le=2**31 - 1)
    locker_number: StrictInt | None = Field(default=None, gt=0, le=2**31 - 1)

    @model_validator(mode="before")
    @classmethod
    def reject_nulls(cls, value):
        if isinstance(value, dict) and (not value or any(item is None for item in value.values())):
            raise ValueError("Provide at least one non-null field.")
        return value


class RentalAssetDTO(RentalAssetInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class RentalAssetPage(BaseModel):
    items: list[RentalAssetDTO]
    total: int
