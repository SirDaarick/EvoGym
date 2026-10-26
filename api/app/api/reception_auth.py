"""Authentication endpoints for a provisioned fixed reception station."""

from datetime import datetime, timezone
import re
from threading import BoundedSemaphore
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.admin_auth import _bounded_body, _staff_rate_limit
from app.auth.authorization import AuthorizationDenied
from app.auth.sessions import issue_reception_session, reception_profiles

router = APIRouter(prefix="/api/v1/auth/reception", tags=["reception authentication"])


class ReceptionLoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: UUID
    pin: str = Field(min_length=1, max_length=72)


_STATION_AUTH = re.compile(r"^ReceptionStation ([A-Za-z0-9_-]{43})$")


def _station_credential(request: Request) -> str:
    match = _STATION_AUTH.fullmatch(request.headers.get("Authorization", ""))
    if match is None:
        raise HTTPException(401, "Authentication failed.")
    return match.group(1)


@router.post("/profiles")
async def profiles(request: Request, response: Response, configured=Depends(_staff_rate_limit)):
    credential = _station_credential(request)
    _settings, factory = configured
    try:
        rows = reception_profiles(factory, credential)
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.") from None
    response.headers["Cache-Control"] = "no-store"
    return {"profiles": [{"id": row.id, "full_name": row.full_name, "position": row.position} for row in rows]}


@router.post("/sessions", status_code=201)
async def login(request: Request, response: Response, configured=Depends(_staff_rate_limit)):
    body = await _bounded_body(request, ReceptionLoginBody)
    credential = _station_credential(request)
    _settings, factory = configured
    semaphore: BoundedSemaphore = request.app.state.password_hash_capacity
    if not semaphore.acquire(blocking=False):
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    try:
        result = issue_reception_session(factory, credential, body.profile_id, body.pin)
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.") from None
    finally:
        semaphore.release()
    response.headers["Cache-Control"] = "no-store"
    return {"access_token": result.token, "token_type": "bearer",
            "expires_at": result.expires_at.astimezone(timezone.utc).isoformat()}
