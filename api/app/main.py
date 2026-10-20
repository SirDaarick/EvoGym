from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import SQLAlchemyError

from app.settings import Settings, get_settings
from app.errors import install_error_handlers
from app.health import BoundedReadinessProbe, build_health_router
from app.observability.metrics import RequestMetrics
from app.observability.logging import install_safe_logging
from app.observability.request_id import RequestIdMiddleware


def _readiness_probe(engine: Engine | None) -> bool:
    if engine is None:
        return False
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError:
        return False


def create_app(settings: Settings | None = None) -> FastAPI:
    configuration = settings or get_settings()
    docs_url = "/docs" if configuration.docs_enabled else None
    redoc_url = "/redoc" if configuration.docs_enabled else None
    openapi_url = "/openapi.json" if configuration.docs_enabled else None
    readiness_probe = BoundedReadinessProbe(
        lambda: _readiness_probe(application.state.database_engine),
        max_workers=1,
        max_pending=1,
    )

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        engine = None
        if configuration.database_url is not None:
            url = make_url(configuration.require_database_url())
            connect_args = {}
            if url.drivername == "postgresql+psycopg":
                connect_args = {"connect_timeout": 2, "options": "-c statement_timeout=2000"}
            from sqlalchemy import create_engine
            engine = create_engine(
                url,
                echo=False,
                hide_parameters=True,
                pool_pre_ping=True,
                pool_timeout=3,
                max_overflow=0,
                connect_args=connect_args,
            )
        application.state.database_engine = engine
        try:
            yield
        finally:
            readiness_probe.close()
            if engine is not None:
                engine.dispose()
            application.state.database_engine = None

    application = FastAPI(
        title="EvoGym API",
        version="0.1.0",
        # Never let framework debug pages expose request/exception details.
        debug=False,
        docs_url=docs_url,
        redoc_url=redoc_url,
        openapi_url=openapi_url,
        lifespan=lifespan,
    )
    application.state.request_metrics = RequestMetrics()
    install_safe_logging(logging.getLogger("evogym.api"))
    application.include_router(build_health_router(readiness_probe))
    install_error_handlers(application)
    application.add_middleware(RequestIdMiddleware)
    return application


app = create_app()
