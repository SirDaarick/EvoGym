from contextlib import asynccontextmanager
import logging
from collections import OrderedDict
from threading import Lock, BoundedSemaphore

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.datastructures import Headers
from sqlalchemy import text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import SQLAlchemyError

from app.settings import Settings, get_settings
from app.errors import install_error_handlers
from app.health import BoundedReadinessProbe, build_health_router
from app.observability.metrics import RequestMetrics
from app.observability.logging import install_safe_logging
from app.observability.request_id import RequestIdMiddleware
from app.observability.security import OperationalSecurityLogStore
from app.db.session import create_session_factory
from app.api.admin_auth import router as admin_auth_router
from app.api.staff_credentials import router as staff_credentials_router
from app.api.reception_auth import router as reception_auth_router
from app.api.admin_sessions import router as admin_sessions_router
from app.api.admin_enrollment import router as admin_enrollment_router
from app.api.admin_staff_accounts import router as admin_staff_accounts_router
from app.api.admin_security_alerts import router as admin_security_alerts_router
from app.api.admin_role_management import router as admin_role_management_router
from app.api.device_pairing import router as device_pairing_router
from app.api.profile_access import router as profile_access_router
from app.api.members import router as members_router
from app.api.catalog import router as catalog_router
from app.api.staff_roster import router as staff_roster_router
from app.api.staff_attendance import router as staff_attendance_router
from app.api.staff_schedules import router as staff_schedules_router
from app.api.shifts import router as shifts_router
from app.api.inventory import router as inventory_router
from app.api.sales import router as sales_router
from app.api.pending_money import router as pending_money_router
from app.api.membership_access import router as membership_access_router
from app.api.member_check_ins import router as member_check_ins_router


class _AuthRateLimiter:
    """Bounded process-local throttling; deployment must use a shared edge limit across workers."""
    def __init__(self, capacity: int = 2048):
        self._capacity = capacity
        self._lock = Lock()
        self._entries = OrderedDict()

    def allow(self, key: str, maximum: int, window_seconds: int) -> bool:
        now = __import__("time").monotonic()
        with self._lock:
            entry = self._entries.get(key)
            if entry is None or now - entry[0] >= window_seconds:
                self._entries[key] = (now, 1)
                allowed = True
            else:
                self._entries[key] = (entry[0], entry[1] + 1)
                allowed = entry[1] < maximum
            self._entries.move_to_end(key)
            while len(self._entries) > self._capacity:
                self._entries.popitem(last=False)
            return allowed


class _AuthBodyLimitMiddleware:
    """Buffer only bounded auth request bodies before JSON parsing or hashing."""
    _paths = {
        "/api/v1/auth/sessions",
        "/api/v1/auth/staff/sessions",
        "/api/v1/auth/reception/profiles",
        "/api/v1/auth/reception/sessions",
        "/api/v1/auth/recovery/start",
        "/api/v1/auth/recovery/complete",
        "/api/v1/auth/devices/pair",
        "/api/v1/auth/profile-access/pair",
        "/api/v1/auth/profile-access/sessions",
        "/api/v1/admin/profile-access/sessions",
        "/api/v1/auth/profile-access/logout",
        "/api/v1/staff/credentials/first-change",
    }

    def __init__(self, app, maximum: int):
        self.app = app
        self.maximum = maximum

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("method") != "POST" or scope.get("path") not in self._paths:
            await self.app(scope, receive, send)
            return
        chunks = []
        total = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body = message.get("body", b"")
            total += len(body)
            if total > self.maximum:
                identifier = scope.get("state", {}).get("request_id", "")
                payload = __import__("json").dumps({"error": {"code": "request_too_large", "message": "The request is too large.", "request_id": identifier}}, separators=(",", ":")).encode()
                await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]})
                await send({"type": "http.response.body", "body": payload, "more_body": False})
                return
            chunks.append(body)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        sent = False

        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.disconnect"}

        await self.app(scope, replay, send)


class _AllowlistedCredentialCORSMiddleware(CORSMiddleware):
    """Expose credentialed CORS only on the exact configured origins."""

    async def __call__(self, scope, receive, send):
        origin = Headers(scope=scope).get("origin") if scope["type"] == "http" else None
        allow_credentials = origin is not None and origin in self.allow_origins

        async def strip_untrusted_credentials(message):
            if not allow_credentials and message["type"] == "http.response.start":
                message["headers"] = [
                    (name, value) for name, value in message.get("headers", [])
                    if name.lower() != b"access-control-allow-credentials"
                ]
            await send(message)

        await super().__call__(scope, receive, strip_untrusted_credentials)


def _readiness_probe(engine: Engine | None) -> bool:
    if engine is None:
        return False
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError:
        return False


def create_app(settings: Settings | None = None, *, recovery_delivery=None) -> FastAPI:
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
        security_log_store = None
        if configuration.operational_security_log_directory is not None:
            configured_path = configuration.operational_security_log_directory
            if configured_path.exists():
                security_log_store = OperationalSecurityLogStore.open_managed(configured_path)
            else:
                security_log_store = OperationalSecurityLogStore.create_new(configured_path)
        application.state.operational_security_log = security_log_store
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
        application.state.session_factory = create_session_factory(engine) if engine is not None else None
        if application.state.session_factory is not None and security_log_store is not None:
            application.state.session_factory.configure(info={"operational_security_log_store": security_log_store})
        try:
            yield
        finally:
            readiness_probe.close()
            if engine is not None:
                engine.dispose()
            application.state.database_engine = None
            application.state.session_factory = None

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
    application.state.settings = configuration
    application.state.operational_security_log = None
    application.state.session_factory = None
    application.state.recovery_delivery = recovery_delivery
    application.state.auth_rate_limiter = _AuthRateLimiter()
    application.state.password_hash_capacity = BoundedSemaphore(configuration.auth_max_concurrent_hashes or 2)
    install_safe_logging(logging.getLogger("evogym.api"))
    application.include_router(build_health_router(readiness_probe))
    application.include_router(admin_auth_router)
    application.include_router(staff_credentials_router)
    application.include_router(reception_auth_router)
    application.include_router(admin_sessions_router)
    application.include_router(admin_enrollment_router)
    application.include_router(admin_staff_accounts_router)
    application.include_router(admin_security_alerts_router)
    application.include_router(admin_role_management_router)
    application.include_router(device_pairing_router)
    application.include_router(profile_access_router)
    application.include_router(members_router)
    application.include_router(catalog_router)
    application.include_router(staff_roster_router)
    application.include_router(staff_attendance_router)
    application.include_router(staff_schedules_router)
    application.include_router(shifts_router)
    application.include_router(inventory_router)
    application.include_router(sales_router)
    application.include_router(pending_money_router)
    application.include_router(membership_access_router)
    application.include_router(member_check_ins_router)
    install_error_handlers(application)
    application.add_middleware(RequestIdMiddleware)
    application.add_middleware(_AuthBodyLimitMiddleware, maximum=configuration.auth_request_max_bytes or 4096)
    if configuration.cors_origin_allowlist:
        application.add_middleware(
            _AllowlistedCredentialCORSMiddleware,
            allow_origins=list(configuration.cors_origin_allowlist),
            allow_credentials=True,
            allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
            expose_headers=["X-Request-ID"],
        )
    return application


app = create_app()
