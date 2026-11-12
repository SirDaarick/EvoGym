"""Contingency event envelope, strict per-type payloads and canonical JSON hashing (shared contract F5)."""

import hashlib
import json
import math
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator

EVENT_ID_PATTERN = r"^[A-Z]+-[A-Z0-9]{2,8}-[0-9]{5,}$"
MAX_SAFE_INTEGER = 2**53 - 1  # JS Number.MAX_SAFE_INTEGER; both canonicalizers must agree on this bound
IDEMPOTENCY_KEY_PATTERN = r"^[A-Za-z0-9._:-]+$"

EventType = Literal["attendance.check_in", "pos.cash_sale", "shift.arqueo_close", "shift.open"]


def _check(value: Any, path: str = "$") -> None:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            raise ValueError(f"integers beyond 2**53-1 are not allowed in canonical JSON ({path})")
        return
    if isinstance(value, float):
        raise ValueError(f"floats are not allowed in canonical JSON ({path})")
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _check(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError(f"object keys must be strings ({path})")
            _check(item, f"{path}.{key}")
        return
    raise ValueError(f"unsupported type {type(value).__name__} in canonical JSON ({path})")


def canonical_json(obj: Any) -> str:
    """Sorted keys, no whitespace, raw UTF-8; integers only (no floats/NaN/Infinity)."""
    _check(obj)
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def payload_hash(obj: Any) -> str:
    return hashlib.sha256(canonical_json(obj).encode("utf-8")).hexdigest()


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CheckInPayload(_Strict):
    member_id: UUID
    period_id: UUID
    branch_id: UUID
    local_access_decision: Literal["valid", "valid_with_outstanding_balance", "denied"]
    online_idempotency_key: str | None = Field(default=None, min_length=1, max_length=128, pattern=IDEMPOTENCY_KEY_PATTERN)
    confirm_outstanding_balance: StrictBool = False


class CashSaleItem(_Strict):
    product_id: UUID
    quantity: int = Field(ge=1)
    unit_price_minor: int = Field(ge=0)


class CashSalePayload(_Strict):
    register_id: UUID
    local_shift_ref: str = Field(min_length=1, max_length=64)
    member_id: UUID | None = None
    items: list[CashSaleItem] = Field(min_length=1)
    total_minor: int = Field(ge=0)
    online_idempotency_key: str | None = Field(default=None, min_length=1, max_length=128, pattern=IDEMPOTENCY_KEY_PATTERN)


class DenominationCount(_Strict):
    denomination_minor: int = Field(ge=1)
    quantity: int = Field(ge=0)


class ShiftOpenPayload(_Strict):
    register_id: UUID
    opening_cash_minor: int = Field(ge=0)
    denomination_counts: list[DenominationCount] = Field(default_factory=list)


class ArqueoClosePayload(_Strict):
    shift_ref: str = Field(min_length=1, max_length=64)
    denomination_counts: list[DenominationCount] = Field(default_factory=list)
    counted_cash_minor: int | None = Field(default=None, ge=0)  # manual total; mutually exclusive with denomination_counts
    voucher_count: int = Field(default=0, ge=0)
    closing_notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _one_count_source(self):
        if self.counted_cash_minor is not None and self.denomination_counts:
            raise ValueError("send either denomination_counts or counted_cash_minor, not both")
        return self


_PAYLOADS: dict[str, type[_Strict]] = {
    "attendance.check_in": CheckInPayload,
    "pos.cash_sale": CashSalePayload,
    "shift.open": ShiftOpenPayload,
    "shift.arqueo_close": ArqueoClosePayload,
}


def parse_payload(event_type: str, payload: dict) -> _Strict:
    """Validate payload against its per-type strict model (raises pydantic.ValidationError / KeyError-free)."""
    model = _PAYLOADS.get(event_type)
    if model is None:
        raise ValueError(f"unknown event_type {event_type!r}")
    return model.model_validate(payload)


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and (value.tzinfo is None or value.utcoffset() is None):
        raise ValueError("timestamps must be timezone-aware")
    return value


class ContingencyEventIn(_Strict):
    event_id: str = Field(max_length=64, pattern=EVENT_ID_PATTERN)
    seq: int = Field(ge=1)
    event_type: EventType
    schema_version: int = Field(ge=1)
    actor_staff_id: UUID
    payload: dict
    payload_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    client_recorded_at: datetime
    clock_anchor_utc: datetime | None = None
    clock_monotonic_delta_ms: int | None = None

    @field_validator("client_recorded_at", "clock_anchor_utc")
    @classmethod
    def _require_aware(cls, value):
        return _aware(value)

    @model_validator(mode="after")
    def _seq_matches_event_id(self):
        if int(self.event_id.rsplit("-", 1)[1]) != self.seq:
            raise ValueError("event_id numeric suffix must equal seq")
        return self

    @property
    def device_prefix(self) -> str:
        return self.event_id.rsplit("-", 1)[0]


class ContingencyBatchIn(_Strict):
    events: Annotated[list[ContingencyEventIn], Field(min_length=1)]
