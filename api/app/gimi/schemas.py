"""Pydantic schemas for Gimi and notification outbox HTTP endpoints."""
from pydantic import BaseModel, Field


class KnowledgeRuleInput(BaseModel):
    ref: str = Field(min_length=1, max_length=120)
    category: str = Field(pattern="^(tariffs_promos|schedules_classes|regulations|supplements_store)$")
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=10000)


class DeliverBatchInput(BaseModel):
    batch_size: int = Field(default=10, ge=1, le=50)


class GimiChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    confirmed: bool = False
    cached_draft: dict[str, object] | None = None
    cached_tool: str | None = None


class GimiChatResponse(BaseModel):
    reply_text: str
    tool_called: str
    status: str
    confidence: float
    needs_confirmation: bool
    draft_action: dict[str, object] | None = None
    data: dict[str, object] = Field(default_factory=dict)


class WhatsappSimulateInput(BaseModel):
    phone: str = Field(min_length=8, max_length=24)
    message: str = Field(min_length=1, max_length=2000)


class WhatsappSimulateResponse(BaseModel):
    phone: str
    message: str
    member_found: bool
    member_name: str | None = None
    member_number: str | None = None
    outcome: str
    tool_called: str | None = None
    reply_text: str
    outbox_id: str | None = None
