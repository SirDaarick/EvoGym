from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth import admin_sessions as service
from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied
from app.api.deps import SessionFactoryDep

router = APIRouter(prefix="/api/v1/admin/sessions", tags=["admin sessions"])
_bearer = HTTPBearer(auto_error=False)


def _principal(request: Request, credentials: HTTPAuthorizationCredentials | None):
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


@router.get("")
def list_sessions(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer), *, factory: SessionFactoryDep):
    staff_id, _current_id = _principal(request, credentials)
    return service.list_sessions(factory, staff_id)


@router.post("/{session_id}/revoke")
def revoke_session(session_id: UUID, request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer), *, factory: SessionFactoryDep):
    staff_id, _current_session_id = _principal(request, credentials)
    return service.revoke_session(factory, staff_id, session_id)


@router.get("/devices")
def list_trusted_devices(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer), *, factory: SessionFactoryDep):
    staff_id, _ = _principal(request, credentials)
    return service.list_trusted_devices(factory, staff_id)


@router.post("/devices/{device_id}/revoke")
def revoke_trusted_device(device_id: UUID, request: Request,
                          credentials: HTTPAuthorizationCredentials | None = Depends(_bearer), *, factory: SessionFactoryDep):
    actor_id, _ = _principal(request, credentials)
    return service.revoke_trusted_device(factory, actor_id, device_id)
