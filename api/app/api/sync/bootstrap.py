"""Sync bootstrap and status endpoints (T5.4, T5.10)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import SessionDep, SettingsDep
from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.sync.bootstrap import (
    BootstrapResponse,
    SyncStatusResponse,
    build_bootstrap_snapshot,
    get_sync_status,
)
from app.sync.devices import SyncDeviceDep

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])
_bearer = HTTPBearer(auto_error=False)


class BootstrapBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    station_code: str = Field(min_length=2, max_length=8)
    reception_station_id: UUID | None = None
    client_schema_version: int = Field(default=1, ge=1)
    rotate: bool = False
    branch_id: UUID | None = None


def _resolve_staff_for_branch(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
    requested_branch_id: UUID,
) -> UUID:
    """Verifies that the bearer token is an Admin or an active Staff with reception permissions in requested_branch_id."""
    factory = request.app.state.session_factory
    settings = getattr(request.app.state, "settings", None)
    if factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")
    token = credentials.credentials

    # Check Admin
    if settings and getattr(settings, "admin_auth_configured", False) and getattr(settings, "admin_token_signing_configured", False):
        try:
            staff_id, _ = validate_admin_session(
                factory, token, settings.admin_token_signing_secret.get_secret_value()
            )
            return staff_id
        except (AuthorizationDenied, ValueError):
            pass

    # Check Staff session with MEMBER_OPERATIONAL_READ
    try:
        principal = validate_session(factory, token, Permission.MEMBER_OPERATIONAL_READ)
        if principal.branch_id != requested_branch_id:
            raise HTTPException(403, "Not authorized for this branch.")
        return principal.staff_id
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.")


@router.post("/bootstrap", response_model=BootstrapResponse)
def sync_bootstrap(
    request: Request,
    body: BootstrapBody,
    session: SessionDep,
    settings: SettingsDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    x_branch_id: Annotated[UUID | None, Header(alias="X-Branch-ID")] = None,
) -> BootstrapResponse:
    branch_id = body.branch_id or x_branch_id
    if branch_id is None:
        raise HTTPException(422, "branch_id or X-Branch-ID header required.")

    staff_id = _resolve_staff_for_branch(request, credentials, branch_id)

    try:
        return build_bootstrap_snapshot(
            session,
            branch_id=branch_id,
            station_code=body.station_code,
            reception_station_id=body.reception_station_id,
            provisioned_by=staff_id,
            rotate=body.rotate,
            settings=settings,
        )
    except ValueError as exc:
        msg = str(exc)
        if "branch_not_found" in msg:
            raise HTTPException(404, "Branch not found or inactive.")
        if "already in use" in msg:
            raise HTTPException(409, "Station code already in use by another branch.")
        raise HTTPException(422, msg)


@router.get("/status", response_model=SyncStatusResponse)
def sync_status(
    device: SyncDeviceDep,
    session: SessionDep,
    settings: SettingsDep,
) -> SyncStatusResponse:
    return get_sync_status(session, device, settings)
