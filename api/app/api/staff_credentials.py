from uuid import UUID
import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied
from app.auth.credentials import change_initial_pin, issue_initial_pin
from app.db.models import StaffUser

router = APIRouter(prefix="/api/v1/staff/credentials", tags=["staff credentials"])
_bearer = HTTPBearer(auto_error=False)


def _staff_rate_limit(request: Request):
    settings = request.app.state.settings
    factory = request.app.state.session_factory
    required = (
        settings.auth_rate_limit_requests,
        settings.auth_rate_limit_window_seconds, settings.auth_request_max_bytes,
        settings.auth_max_concurrent_hashes,
    )
    if settings.database_url is None or any(value is None for value in required) or factory is None:
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    key = hashlib.sha256((request.client.host if request.client else "unknown").encode("utf-8")).hexdigest()
    if not request.app.state.auth_rate_limiter.allow(key, settings.auth_rate_limit_requests, settings.auth_rate_limit_window_seconds):
        raise HTTPException(429, "Authentication is temporarily unavailable.")
    return factory


class FirstChangeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    login_identifier: str = Field(min_length=1, max_length=320)
    branch_id: UUID
    current_pin: str = Field(min_length=1, max_length=72)
    new_pin: str = Field(min_length=1, max_length=72)


def _admin(request: Request, credentials: HTTPAuthorizationCredentials | None):
    settings = request.app.state.settings
    factory = request.app.state.session_factory
    if not settings.admin_auth_configured or factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")
    if not settings.admin_token_signing_configured:
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    try:
        return validate_admin_session(factory, credentials.credentials, settings.admin_token_signing_secret.get_secret_value())
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.") from None


@router.post("/{staff_id}/initial-pin", status_code=200)
def issue_or_reset_initial_pin(
    staff_id: UUID, request: Request, response: Response,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
):
    actor_id, admin_session_id = _admin(request, credentials)
    try:
        pin = issue_initial_pin(request.app.state.session_factory, staff_id,
                                actor_id=actor_id, admin_session_id=admin_session_id)
    except PermissionError:
        raise HTTPException(404, "The requested resource was not found.") from None
    except LookupError:
        raise HTTPException(404, "The requested resource was not found.") from None
    response.headers["Cache-Control"] = "no-store"
    return {"initial_pin": pin}


@router.post("/first-change", status_code=204)
def first_change(request: Request, response: Response, body: FirstChangeBody,
                 factory=Depends(_staff_rate_limit)):
    semaphore = request.app.state.password_hash_capacity
    if not semaphore.acquire(blocking=False):
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    try:
        with factory() as session:
            staff_id = session.scalar(select(StaffUser.id).where(
                StaffUser.login_identifier == body.login_identifier.strip().casefold()))
        if staff_id is None:
            raise HTTPException(401, "Authentication failed.")
        if not change_initial_pin(factory, staff_id, body.branch_id, body.current_pin, body.new_pin):
            raise HTTPException(401, "Authentication failed.")
        response.headers["Cache-Control"] = "no-store"
        return None
    finally:
        semaphore.release()
