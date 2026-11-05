"""Pydantic schemas for Gimi and notification outbox HTTP endpoints."""
from pydantic import BaseModel, Field


class KnowledgeRuleInput(BaseModel):
    ref: str = Field(min_length=1, max_length=120)
    category: str = Field(pattern="^(tariffs_promos|schedules_classes|regulations|supplements_store)$")
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=10000)


class DeliverBatchInput(BaseModel):
    batch_size: int = Field(default=10, ge=1, le=50)
