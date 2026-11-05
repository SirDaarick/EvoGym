from app.cli.notifications_worker import run_worker
from app.notifications.outbox import enqueue
from test_shifts import _setup_db


def test_notifications_worker_once_execution(tmp_path):
    url, engine, factory = _setup_db(tmp_path)
    try:
        with factory.begin() as session:
            enqueue(
                session,
                idempotency_key="worker:test:001",
                channel="whatsapp",
                kind="notice",
                recipient="+525598765432",
                body="Aviso importante de membresia",
            )

        # Run worker with once=True
        code = run_worker(database_url=url, batch_size=10, interval=0.1, once=True)
        assert code == 0

        # Verify delivered
        with factory.begin() as session:
            from sqlalchemy import select
            from app.db.models.notifications import NotificationOutbox
            row = session.scalar(select(NotificationOutbox).where(NotificationOutbox.idempotency_key == "worker:test:001"))
            assert row is not None
            assert row.status == "sent"
            assert row.attempts == 1
    finally:
        engine.dispose()
