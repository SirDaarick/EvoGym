"""Outbox delivery worker.

Three short phases per batch, so no database transaction is ever open during the network call:
1. claim: lock due rows (`FOR UPDATE SKIP LOCKED` on PostgreSQL; SQLite ignores the clause), mark `sending`, commit;
2. send through the `DeliveryAdapter` with no transaction held;
3. record the outcome in a new transaction (sent / retry with backoff / failed / dead).

`last_error` only ever holds a short machine code, never provider text, so it cannot carry PII.
"""
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol, runtime_checkable
from uuid import UUID

from sqlalchemy import select, update

from app.db.models.notifications import NotificationOutbox

BACKOFF_BASE_SECONDS = 30
BACKOFF_MAX_SECONDS = 3600
LEASE_SECONDS = 300  # a `sending` row older than this is presumed orphaned by a crashed worker
_ERROR_CODE = re.compile(r"^[a-z0-9_.-]{1,64}$")


@dataclass(frozen=True, slots=True)
class OutboundMessage:
    id: UUID
    channel: str
    recipient: str
    body: str
    idempotency_key: str


@dataclass(frozen=True, slots=True)
class DeliveryResult:
    ok: bool
    provider_message_id: str | None = None
    retryable: bool = True
    error_code: str | None = None


@runtime_checkable
class DeliveryAdapter(Protocol):
    configured: bool

    def send(self, message: OutboundMessage) -> DeliveryResult: ...


class NotConfiguredDeliveryAdapter:
    """Default adapter: no provider credentials, so the worker claims nothing and rows stay pending."""

    configured = False

    def send(self, message: OutboundMessage) -> DeliveryResult:  # pragma: no cover - never claimed
        return DeliveryResult(ok=False, retryable=True, error_code="not_configured")


class FakeDeliveryAdapter:
    """Test double: records messages; `script` is a list of DeliveryResult/Exception consumed in order."""

    configured = True

    def __init__(self, script: list | None = None):
        self.sent: list[OutboundMessage] = []
        self._script = list(script or [])

    def send(self, message: OutboundMessage) -> DeliveryResult:
        self.sent.append(message)
        step = self._script.pop(0) if self._script else DeliveryResult(ok=True, provider_message_id=f"fake-{message.id}")
        if isinstance(step, Exception):
            raise step
        return step


def backoff_seconds(attempts: int) -> int:
    return min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * (2 ** max(0, attempts - 1)))


def safe_error_code(code: str | None) -> str:
    return code if code and _ERROR_CODE.match(code) else "unclassified_error"


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _claim(factory, now: datetime, batch_size: int) -> list[OutboundMessage]:
    with factory.begin() as session:
        stale = now - timedelta(seconds=LEASE_SECONDS)
        rows = session.scalars(
            select(NotificationOutbox)
            .where(
                ((NotificationOutbox.status == "pending") & (NotificationOutbox.next_attempt_at <= now))
                | ((NotificationOutbox.status == "sending") & (NotificationOutbox.locked_at <= stale))
            )
            .order_by(NotificationOutbox.next_attempt_at, NotificationOutbox.id)
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        ).all()
        claimed = []
        for row in rows:
            if row.status == "sending" and row.attempts >= row.max_attempts:  # reclaimed lease with no attempts left
                row.status, row.locked_at, row.last_error = "dead", None, "lease_expired"
                continue
            row.status = "sending"
            row.attempts += 1
            row.locked_at = now
            claimed.append(OutboundMessage(row.id, row.channel, row.recipient, row.body, row.idempotency_key))
        return claimed


def _record(factory, message: OutboundMessage, result: DeliveryResult, now: datetime) -> None:
    with factory.begin() as session:
        row = session.scalar(
            select(NotificationOutbox).where(NotificationOutbox.id == message.id, NotificationOutbox.status == "sending")
            .with_for_update())
        if row is None:
            return
        row.locked_at = None
        if result.ok:
            row.status, row.sent_at, row.last_error = "sent", now, None
            row.provider_message_id = (result.provider_message_id or "")[:128] or None
            return
        row.last_error = safe_error_code(result.error_code)
        if not result.retryable:
            row.status = "failed"
        elif row.attempts >= row.max_attempts:
            row.status = "dead"
        else:
            row.status = "pending"
            row.next_attempt_at = now + timedelta(seconds=backoff_seconds(row.attempts))


def deliver_batch(factory, adapter: DeliveryAdapter, *, now: datetime | None = None, batch_size: int = 10) -> int:
    """Deliver up to `batch_size` due messages; returns how many were attempted."""
    if not getattr(adapter, "configured", False):
        return 0
    current = _aware(now) if now else datetime.now(timezone.utc)
    messages = _claim(factory, current, batch_size)
    for message in messages:
        try:
            result = adapter.send(message)
        except Exception as exc:  # adapter bugs/network errors: keep only the exception class, never its text
            result = DeliveryResult(ok=False, retryable=True, error_code=f"exception.{type(exc).__name__.lower()}")
        _record(factory, message, result, current)
    return len(messages)
