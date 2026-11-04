from uuid import UUID
import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import OptionalBearerDep, SessionFactoryDep, resolve_credentials_admin
from app.staff import credentials as service

router = APIRouter(prefix="/api/v1/staff/credentials", tags=["staff credentials"])


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


@router.post("/{staff_id}/initial-pin", status_code=200)
def issue_or_reset_initial_pin(
    staff_id: UUID, request: Request, response: Response, credentials: OptionalBearerDep,
    *, factory: SessionFactoryDep,
):
    actor_id, admin_session_id = resolve_credentials_admin(request, credentials)
    pin = service.issue_initial_pin(factory, staff_id, actor_id, admin_session_id)
    response.headers["Cache-Control"] = "no-store"
    return {"initial_pin": pin}


@router.post("/first-change", status_code=204)
def first_change(request: Request, response: Response, body: FirstChangeBody,
                 factory=Depends(_staff_rate_limit)):
    service.first_change(factory, request.app.state.password_hash_capacity, body.login_identifier,
                         body.branch_id, body.current_pin, body.new_pin)
    response.headers["Cache-Control"] = "no-store"
    return None
