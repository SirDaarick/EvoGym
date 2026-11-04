"""Staff device pairing and mobile binding API endpoints."""
from datetime import timezone
import hashlib
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied
from app.auth import device_pairing as service
from app.observability.logging import request_id
from app.api.deps import SessionFactoryDep

router = APIRouter(prefix="/api/v1", tags=["device pairing"])
_bearer = HTTPBearer(auto_error=False)


def _admin_principal(request: Request, credentials: HTTPAuthorizationCredentials | None):
    settings = request.app.state.settings
    factory = request.app.state.session_factory
    if (not settings.admin_auth_configured or not settings.admin_token_signing_configured or factory is None
            or credentials is None or credentials.scheme.lower() != "bearer"):
        raise HTTPException(401, "Authentication failed.")
    try:
        return validate_admin_session(factory, credentials.credentials, settings.admin_token_signing_secret.get_secret_value())
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.") from None


def _rate_limit(request: Request):
    settings = request.app.state.settings
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    key = hashlib.sha256((request.client.host if request.client else "unknown").encode("utf-8")).hexdigest()
    if not request.app.state.auth_rate_limiter.allow(key, settings.auth_rate_limit_requests, settings.auth_rate_limit_window_seconds):
        raise HTTPException(429, "Too many authentication requests. Try again later.")
    return settings, factory


class IssuePairingCodePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ttl_seconds: int = Field(default=900, ge=60, le=86400)


class PairDevicePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    login_identifier: str = Field(min_length=1, max_length=320)
    pairing_code: str = Field(min_length=6, max_length=6)
    device_identifier: str = Field(min_length=1, max_length=256)
    device_name: str = Field(min_length=1, max_length=128)


# --- Admin endpoints ---

@router.post("/admin/staff/{staff_id}/device-pairing")
def issue_pairing_code(
    staff_id: UUID,
    payload: IssuePairingCodePayload | None = None,
    request: Request = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    *, factory: SessionFactoryDep,
):
    admin_id, _current_session = _admin_principal(request, credentials)
    req_id = UUID(request_id())
    ttl = payload.ttl_seconds if payload else 900
    issued = service.issue_pairing_code(factory, admin_id, staff_id, ttl, req_id)
    return {
        "id": str(issued.id),
        "pairing_code": issued.raw_code,
        "expires_at": issued.expires_at.astimezone(timezone.utc).isoformat(),
    }


@router.get("/admin/devices")
def list_devices(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    *, factory: SessionFactoryDep,
):
    admin_id, _current_session = _admin_principal(request, credentials)
    devices = service.list_devices(factory, admin_id)
    return {
        "devices": [
            {
                "id": str(d.id),
                "staff_id": str(d.staff_id),
                "staff_login": d.staff_login,
                "device_name": d.device_name,
                "paired_at": d.paired_at.astimezone(timezone.utc).isoformat(),
                "last_seen_at": d.last_seen_at.astimezone(timezone.utc).isoformat(),
                "revoked": d.revoked,
                "revoked_at": d.revoked_at.astimezone(timezone.utc).isoformat() if d.revoked_at else None,
            }
            for d in devices
        ]
    }


@router.post("/admin/devices/{device_id}/revoke")
def revoke_device(
    device_id: UUID,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    *, factory: SessionFactoryDep,
):
    admin_id, _current_session = _admin_principal(request, credentials)
    req_id = UUID(request_id())
    service.revoke_device(factory, admin_id, device_id, req_id)
    return {"revoked": True}


# --- Public pairing endpoint ---

@router.post("/auth/devices/pair")
def submit_device_pairing(
    payload: PairDevicePayload,
    request: Request,
):
    _settings, factory = _rate_limit(request)
    req_id = UUID(request_id())
    device_id = service.submit_pairing(
        factory, payload.login_identifier, payload.pairing_code, payload.device_identifier,
        payload.device_name, req_id,
    )
    return {
        "device_id": str(device_id),
        "status": "paired",
    }
