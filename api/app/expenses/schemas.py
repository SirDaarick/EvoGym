"""Expense request models."""
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt

Category = Literal["consumibles", "limpieza", "mantenimiento_piso", "mantenimiento_peso", "mantenimiento_cardio", "mantenimiento_box", "servicios", "general"]


class MovementInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    concept: str = Field(min_length=1, max_length=255)
    amount_minor: StrictInt = Field(gt=0, le=2**63 - 1)


class ExpenseInput(MovementInput):
    category: Category
    payee_name: str = Field(min_length=1, max_length=160)
    voucher_reference: str | None = Field(default=None, max_length=120)
    evidence_key: str | None = Field(default=None, max_length=255)


class ContributionInput(MovementInput):
    contributor_name: str = Field(min_length=1, max_length=160)


class BusinessExpenseInput(ExpenseInput):
    branch_id: UUID
    payment_method: Literal["cash", "card", "transfer"]


class VoidInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    reason: str = Field(min_length=1, max_length=500)


class EvidenceUploadInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_id: UUID
    content_type: Literal["image/webp"]
    file_size_bytes: StrictInt = Field(gt=0, le=1048576)
