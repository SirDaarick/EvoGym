"""Transactional, idempotent enqueue into `notification_outbox`.

The caller owns the transaction: `enqueue` flushes but never commits, so the notification is stored atomically
with its source event. A repeated `idempotency_key` (e.g. ``receipt:{payment_id}:{channel}``) returns the existing id.
"""
from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.notifications import NotificationOutbox

CHANNELS = frozenset({"whatsapp", "email", "sms"})
MAX_BODY_CHARS = 4096


def enqueue(
    session: Session, *, idempotency_key: str, channel: str, kind: str, recipient: str, body: str,
    max_attempts: int = 6, available_at: datetime | None = None,
) -> UUID:
    """Insert a pending message, or return the id of the one already stored under `idempotency_key`."""
    key = idempotency_key.strip() if isinstance(idempotency_key, str) else ""
    if not 1 <= len(key) <= 160:
        raise ValueError("idempotency_key must be 1-160 characters")
    if channel not in CHANNELS:
        raise ValueError("unsupported notification channel")
    if not kind or len(kind) > 48 or not recipient or len(recipient) > 64 or not body or len(body) > MAX_BODY_CHARS:
        raise ValueError("invalid notification fields")
    if not 1 <= max_attempts <= 20:
        raise ValueError("max_attempts out of range")
    values = dict(
        id=uuid4(), idempotency_key=key, channel=channel, kind=kind, recipient=recipient, body=body,
        max_attempts=max_attempts, status="pending", attempts=0,
        next_attempt_at=available_at or datetime.now(timezone.utc),
    )
    # ON CONFLICT DO NOTHING keeps a concurrent duplicate from poisoning the caller's transaction (no savepoint).
    insert_ignore(session, NotificationOutbox, values, "idempotency_key")
    return session.scalar(select(NotificationOutbox.id).where(NotificationOutbox.idempotency_key == key))


def insert_ignore(session: Session, model, values: dict, conflict_column: str) -> bool:
    """Insert one row unless `conflict_column` already exists. Returns True when a row was inserted."""
    dialect = session.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:  # pragma: no cover
        raise RuntimeError("unsupported database dialect")
    col = getattr(model, conflict_column, None)
    if col is None:
        col = model.__table__.c[conflict_column]
    statement = insert(model).values(**values).on_conflict_do_nothing(index_elements=[conflict_column]).returning(col)
    return session.scalar(statement) is not None
