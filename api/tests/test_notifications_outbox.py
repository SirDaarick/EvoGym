from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import NotificationOutbox
from app.notifications.delivery import (
    DeliveryAdapter, DeliveryResult, FakeDeliveryAdapter, NotConfiguredDeliveryAdapter, backoff_seconds,
    deliver_batch,
)
from app.notifications.outbox import enqueue

# enqueue stamps the real clock; the worker clock is injected. A day of margin keeps this valid in a long suite run.
NOW = datetime.now(timezone.utc) + timedelta(days=1)


@pytest.fixture
def factory(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'outbox.db').as_posix()}")
    Base.metadata.create_all(engine)
    yield sessionmaker(engine)
    engine.dispose()


def _enqueue(factory, key="receipt:1:whatsapp", **kw):
    with factory.begin() as session:
        return enqueue(session, idempotency_key=key, channel="whatsapp", kind="receipt",
                       recipient="+5215512345678", body="Pago recibido", **kw)


def _row(factory, row_id):
    with factory() as session:
        return session.get(NotificationOutbox, row_id)


def test_enqueue_is_idempotent_and_transactional(factory):
    first = _enqueue(factory)
    assert _enqueue(factory) == first
    with factory() as session:
        assert len(session.scalars(select(NotificationOutbox)).all()) == 1
    with pytest.raises(RuntimeError):
        with factory.begin() as session:
            enqueue(session, idempotency_key="rolled-back", channel="email", kind="x", recipient="a@b.c", body="b")
            raise RuntimeError("source event failed")
    with factory() as session:
        assert session.scalar(select(NotificationOutbox).where(NotificationOutbox.idempotency_key == "rolled-back")) is None


def test_enqueue_validates_input(factory):
    with factory.begin() as session:
        with pytest.raises(ValueError):
            enqueue(session, idempotency_key="", channel="whatsapp", kind="k", recipient="r", body="b")
        with pytest.raises(ValueError):
            enqueue(session, idempotency_key="k", channel="pigeon", kind="k", recipient="r", body="b")


def test_not_configured_adapter_leaves_rows_pending(factory):
    row_id = _enqueue(factory)
    assert isinstance(NotConfiguredDeliveryAdapter(), DeliveryAdapter)
    assert deliver_batch(factory, NotConfiguredDeliveryAdapter(), now=NOW) == 0
    row = _row(factory, row_id)
    assert (row.status, row.attempts) == ("pending", 0)


def test_successful_delivery_marks_sent(factory):
    row_id = _enqueue(factory)
    adapter = FakeDeliveryAdapter()
    assert deliver_batch(factory, adapter, now=NOW) == 1
    row = _row(factory, row_id)
    assert (row.status, row.attempts, row.last_error) == ("sent", 1, None)
    assert row.provider_message_id == f"fake-{row_id}" and row.locked_at is None
    assert adapter.sent[0].recipient == "+5215512345678"
    assert deliver_batch(factory, adapter, now=NOW + timedelta(days=1)) == 0  # sent rows are never resent


def test_retry_with_backoff_then_dead(factory):
    row_id = _enqueue(factory, max_attempts=3)
    adapter = FakeDeliveryAdapter([DeliveryResult(ok=False, error_code="timeout")] * 3)
    clock = NOW
    expected_wait = [30, 60]
    for wait in expected_wait:
        assert deliver_batch(factory, adapter, now=clock) == 1
        row = _row(factory, row_id)
        assert row.status == "pending" and row.last_error == "timeout"
        assert deliver_batch(factory, adapter, now=clock + timedelta(seconds=wait - 1)) == 0  # not due yet
        clock = clock + timedelta(seconds=wait)
    assert deliver_batch(factory, adapter, now=clock) == 1
    row = _row(factory, row_id)
    assert (row.status, row.attempts) == ("dead", 3)
    assert deliver_batch(factory, adapter, now=clock + timedelta(days=1)) == 0
    assert backoff_seconds(1) == 30 and backoff_seconds(20) == 3600


def test_non_retryable_failure_is_failed(factory):
    row_id = _enqueue(factory)
    deliver_batch(factory, FakeDeliveryAdapter([DeliveryResult(ok=False, retryable=False, error_code="invalid_recipient")]), now=NOW)
    row = _row(factory, row_id)
    assert (row.status, row.last_error) == ("failed", "invalid_recipient")


def test_last_error_never_contains_pii(factory):
    row_id = _enqueue(factory)
    leaky = DeliveryResult(ok=False, error_code="send to +5215512345678 failed for Juan Perez")
    deliver_batch(factory, FakeDeliveryAdapter([leaky]), now=NOW)
    assert _row(factory, row_id).last_error == "unclassified_error"
    second = _enqueue(factory, key="k2")
    deliver_batch(factory, FakeDeliveryAdapter([ValueError("juan@example.com 5512345678")]), now=NOW)
    error = _row(factory, second).last_error
    assert error == "exception.valueerror" and "juan" not in error and "5512" not in error


def test_no_transaction_open_during_network_call(factory):
    row_id = _enqueue(factory)
    observed = {}

    class Probe(FakeDeliveryAdapter):
        def send(self, message):
            # The row is committed as `sending` and another session can write: no lock is held by the worker.
            with factory.begin() as session:
                observed["status"] = session.get(NotificationOutbox, message.id).status
                session.get(NotificationOutbox, message.id).kind = "probe-wrote"
            return super().send(message)

    deliver_batch(factory, Probe(), now=NOW)
    assert observed["status"] == "sending"
    assert _row(factory, row_id).status == "sent"


def test_stale_sending_row_is_reclaimed(factory):
    row_id = _enqueue(factory)
    with factory.begin() as session:
        row = session.get(NotificationOutbox, row_id)
        row.status, row.attempts, row.locked_at = "sending", 1, NOW - timedelta(hours=1)
    assert deliver_batch(factory, FakeDeliveryAdapter(), now=NOW) == 1
    assert _row(factory, row_id).status == "sent"


def test_stale_sending_row_at_max_attempts_is_dead_not_resent(factory):
    row_id = _enqueue(factory)
    with factory.begin() as session:
        row = session.get(NotificationOutbox, row_id)
        row.status, row.attempts, row.locked_at = "sending", row.max_attempts, NOW - timedelta(hours=1)
    adapter = FakeDeliveryAdapter()
    assert deliver_batch(factory, adapter, now=NOW) == 0
    row = _row(factory, row_id)
    assert adapter.sent == [] and (row.status, row.attempts, row.last_error) == ("dead", row.max_attempts, "lease_expired")