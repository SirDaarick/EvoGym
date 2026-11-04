"""Admin/staff login, refresh, logout, device-approval and recovery use cases. HTTP transport in `app.api.admin_auth`.

Order of checks, bounded concurrent hashing and failure statuses mirror the original router exactly; failures are
typed `HttpStatusError`s. Cookies and rate limiting stay in the transport layer.
"""
from datetime import datetime, timedelta, timezone
from threading import BoundedSemaphore
from uuid import UUID

from app.auth.admin import (
    AdminLoginPending, approve_admin_login, authenticate_admin, logout_admin_session, poll_admin_login_approval,
    refresh_admin_session,
)
from app.auth.authorization import AuthorizationDenied
from app.auth.recovery import complete_recovery, start_recovery
from app.auth.sessions import issue_session
from app.errors import HttpStatusError
from app.observability.logging import request_id


def _require_signing(settings) -> None:
    if not settings.admin_token_signing_configured:
        raise HttpStatusError(503)


def _acquire(semaphore: BoundedSemaphore) -> None:
    if not semaphore.acquire(blocking=False):
        raise HttpStatusError(503)


def login(factory, settings, semaphore: BoundedSemaphore, *, login_identifier: str, password: str, category: str,
          device_cookie: str | None, delivery):
    """Returns an `AdminLoginPending` or the issued admin session; 401 on failed authentication."""
    _require_signing(settings)
    _acquire(semaphore)
    try:
        result = authenticate_admin(factory, login_identifier.strip().casefold(), password,
            settings.admin_session_ttl_seconds, UUID(request_id()),
            lockout_attempts=settings.admin_lockout_attempts, lockout_seconds=settings.admin_lockout_seconds,
            category=category, device_cookie=device_cookie,
            signing_secret=settings.admin_token_signing_secret.get_secret_value(),
            delivery=delivery, approval_base_url=settings.admin_recovery_base_url)
    finally:
        semaphore.release()
    if result is None:
        raise HttpStatusError(401)
    return result


def staff_login(factory, settings, semaphore: BoundedSemaphore, *, login_identifier: str, pin: str, branch_id: UUID):
    if settings.staff_session_ttl_seconds is None:
        raise HttpStatusError(503)
    _acquire(semaphore)
    try:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.staff_session_ttl_seconds)
        return issue_session(factory, login_identifier.strip().casefold(), pin, branch_id, expires_at)
    except AuthorizationDenied:
        raise HttpStatusError(401) from None
    finally:
        semaphore.release()


def recovery_start(factory, settings, delivery, login_identifier: str) -> None:
    if not settings.admin_recovery_configured or delivery is None:
        raise HttpStatusError(503)
    start_recovery(factory, login_identifier.strip().casefold(), settings.admin_recovery_ttl_seconds,
                   settings.admin_recovery_base_url, delivery)


def recovery_complete(factory, settings, semaphore: BoundedSemaphore, token: str, new_password: str) -> None:
    if not settings.admin_recovery_configured:
        raise HttpStatusError(503)
    _acquire(semaphore)
    try:
        changed = complete_recovery(factory, token, new_password, UUID(request_id()))
    finally:
        semaphore.release()
    if not changed:
        raise HttpStatusError(400)


def approve_device(factory, token: str) -> None:
    if not approve_admin_login(factory, token, UUID(request_id())):
        raise HttpStatusError(400)


def poll_approval(factory, settings, delivery, approval_id: UUID, poll_token: str):
    """Returns `AdminLoginPending` or the issued session; 400 when invalid or expired."""
    _require_signing(settings)
    result = poll_admin_login_approval(factory, approval_id, poll_token,
        settings.admin_token_signing_secret.get_secret_value(), UUID(request_id()), delivery=delivery)
    if result is None:
        raise HttpStatusError(400)
    return result


def refresh(factory, settings, raw: str | None):
    """Returns the rotated session, or None when the cookie no longer maps to one (the caller clears it)."""
    _require_signing(settings)
    if raw is None:
        raise HttpStatusError(401)
    return refresh_admin_session(factory, raw, settings.admin_token_signing_secret.get_secret_value(),
                                 UUID(request_id()))


def logout(factory, settings, raw: str | None, category: str) -> None:
    _require_signing(settings)
    if raw is not None:
        logout_admin_session(factory, raw, settings.admin_token_signing_secret.get_secret_value(),
                             category, UUID(request_id()))
