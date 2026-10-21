from datetime import datetime, timedelta, timezone
from threading import BoundedSemaphore
from urllib.parse import urlsplit
import hashlib
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from uuid import UUID
from sqlalchemy.orm import Session, sessionmaker

from app.auth.admin import authenticate_admin
from app.auth.authorization import AuthorizationDenied
from app.auth.recovery import complete_recovery, start_recovery
from app.auth.sessions import issue_session
from app.observability.logging import request_id

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    login_identifier: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=4096)


class RecoveryStartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    login_identifier: str = Field(min_length=1, max_length=320)


class RecoveryCompleteBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=43, max_length=43)
    new_password: str = Field(min_length=1, max_length=4096)


class StaffSessionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    login_identifier: str = Field(min_length=1, max_length=320)
    pin: str = Field(min_length=1, max_length=72)
    branch_id: UUID


def _configured(request: Request):
    settings = request.app.state.settings
    if not settings.admin_auth_configured or request.app.state.session_factory is None:
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    return settings, request.app.state.session_factory


def _rate_limit(request: Request):
    settings, factory = _configured(request)
    key = hashlib.sha256((request.client.host if request.client else "unknown").encode("utf-8")).hexdigest()
    if not request.app.state.auth_rate_limiter.allow(key, settings.auth_rate_limit_requests, settings.auth_rate_limit_window_seconds):
        raise HTTPException(429, "Authentication is temporarily unavailable.")
    return settings, factory


def _staff_rate_limit(request: Request):
    settings = request.app.state.settings
    factory = request.app.state.session_factory
    required = (
        settings.staff_session_ttl_seconds, settings.auth_rate_limit_requests,
        settings.auth_rate_limit_window_seconds, settings.auth_request_max_bytes,
        settings.auth_max_concurrent_hashes,
    )
    if settings.database_url is None or any(value is None for value in required) or factory is None:
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    key = hashlib.sha256((request.client.host if request.client else "unknown").encode("utf-8")).hexdigest()
    if not request.app.state.auth_rate_limiter.allow(key, settings.auth_rate_limit_requests, settings.auth_rate_limit_window_seconds):
        raise HTTPException(429, "Authentication is temporarily unavailable.")
    return settings, factory


@router.post("/sessions", status_code=201)
def login(body: LoginBody, request: Request, response: Response, configured=Depends(_rate_limit)):
    settings, factory = configured
    semaphore: BoundedSemaphore = request.app.state.password_hash_capacity
    if not semaphore.acquire(blocking=False):
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    try:
        result = authenticate_admin(factory, body.login_identifier.strip().casefold(), body.password,
            settings.admin_session_ttl_seconds, __import__("uuid").UUID(request_id()),
            lockout_attempts=settings.admin_lockout_attempts, lockout_seconds=settings.admin_lockout_seconds)
    finally:
        semaphore.release()
    if result is None:
        raise HTTPException(401, "Authentication failed.")
    response.headers["Cache-Control"] = "no-store"
    return {"access_token": result.token, "token_type": "bearer", "expires_at": result.expires_at.astimezone(timezone.utc).isoformat()}


@router.post("/staff/sessions", status_code=201)
def staff_login(body: StaffSessionBody, request: Request, response: Response, configured=Depends(_staff_rate_limit)):
    settings, factory = configured
    semaphore: BoundedSemaphore = request.app.state.password_hash_capacity
    if not semaphore.acquire(blocking=False):
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    try:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.staff_session_ttl_seconds)
        result = issue_session(
            factory, body.login_identifier.strip().casefold(), body.pin, body.branch_id, expires_at,
        )
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.") from None
    finally:
        semaphore.release()
    response.headers["Cache-Control"] = "no-store"
    return {"access_token": result.token, "token_type": "bearer", "expires_at": result.expires_at.astimezone(timezone.utc).isoformat()}


@router.post("/recovery/start", status_code=202)
def recovery_start(body: RecoveryStartBody, request: Request, configured=Depends(_rate_limit)):
    settings, factory = configured
    delivery = request.app.state.recovery_delivery
    if not settings.admin_recovery_configured or delivery is None:
        raise HTTPException(503, "Recovery is temporarily unavailable.")
    start_recovery(factory, body.login_identifier.strip().casefold(), settings.admin_recovery_ttl_seconds,
                   settings.admin_recovery_base_url, delivery)
    return {"message": "If eligible, recovery instructions have been queued."}


@router.post("/recovery/complete", status_code=204)
def recovery_complete(body: RecoveryCompleteBody, request: Request, configured=Depends(_rate_limit)):
    settings, factory = configured
    if not settings.admin_recovery_configured:
        raise HTTPException(503, "Recovery is temporarily unavailable.")
    semaphore: BoundedSemaphore = request.app.state.password_hash_capacity
    if not semaphore.acquire(blocking=False):
        raise HTTPException(503, "Recovery is temporarily unavailable.")
    try:
        changed = complete_recovery(factory, body.token, body.new_password, __import__("uuid").UUID(request_id()))
    finally:
        semaphore.release()
    if not changed:
        raise HTTPException(400, "Recovery request is invalid or expired.")
    return None
