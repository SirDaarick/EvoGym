"""Background worker daemon to deliver pending outbox notifications."""
import argparse
import logging
import time
from sqlalchemy.engine.url import make_url

from sqlalchemy import create_engine

from app.db.session import create_session_factory
from app.notifications.delivery import (
    FakeDeliveryAdapter,
    NotConfiguredDeliveryAdapter,
    deliver_batch,
)
from app.settings import Settings

logger = logging.getLogger("evogym.notifications.worker")


def get_adapter(settings: Settings):
    if settings.environment == "production":
        # In production, check if provider is configured or return NotConfiguredDeliveryAdapter
        if getattr(settings, "whatsapp_webhook_configured", False):
            return NotConfiguredDeliveryAdapter()
        return NotConfiguredDeliveryAdapter()
    return FakeDeliveryAdapter()


def run_worker(
    database_url: str | None = None,
    batch_size: int = 10,
    interval: float = 5.0,
    once: bool = False,
) -> int:
    settings = Settings()
    url_str = database_url or (settings.database_url and str(settings.database_url))
    if not url_str:
        logger.error("No database URL provided.")
        return 1

    parsed = make_url(url_str)
    connect_args = {}
    if parsed.drivername == "postgresql+psycopg":
        connect_args = {"connect_timeout": 5, "options": "-c statement_timeout=5000"}

    engine = create_engine(
        parsed,
        echo=False,
        hide_parameters=True,
        pool_pre_ping=True,
        connect_args=connect_args,
    )
    factory = create_session_factory(engine)
    adapter = get_adapter(settings)
    logger.info(
        "Notification worker started (batch_size=%d, interval=%.1fs, adapter=%s)",
        batch_size,
        interval,
        adapter.__class__.__name__,
    )

    try:
        while True:
            try:
                attempted = deliver_batch(factory, adapter, batch_size=batch_size)
                if attempted > 0:
                    logger.info("Delivered batch of %d notifications", attempted)
            except Exception as exc:
                logger.error("Error during deliver_batch: %s", exc)

            if once:
                break
            time.sleep(interval)
    finally:
        engine.dispose()
    return 0


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="EvoGym Notifications Outbox Worker")
    parser.add_argument("--database-url", default=None, help="Database connection URL")
    parser.add_argument("--batch-size", type=int, default=10, help="Number of messages to deliver per batch")
    parser.add_argument("--interval", type=float, default=5.0, help="Sleep seconds between polling batches")
    parser.add_argument("--once", action="store_true", help="Run a single delivery batch and exit")
    args = parser.parse_args()

    return run_worker(
        database_url=args.database_url,
        batch_size=args.batch_size,
        interval=args.interval,
        once=args.once,
    )


if __name__ == "__main__":
    raise SystemExit(main())
