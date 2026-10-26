"""Authenticated profile discovery and employee entry endpoints."""

from datetime import timezone
from threading import BoundedSemaphore
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field

from app.api.admin_auth import _bounded_body, _staff_rate_limit
from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied
from app.auth.profile_access import (
    ProfilePinSetupRequired,
    UnlinkedProfileIdentity,
    admin_profile_choices,
    bind_profile_access,
    change_profile_initial_pin,
    issue_profile_session,
    logout_profile_access,
    paired_profile_choices,
    revoke_employee_profile_session,
)
from app.observability.logging import request_id


router = APIRouter(prefix="/api/v1", tags=["profile access"])
_bearer = HTTPBearer(auto_error=False)
_COOKIE_NAME = "evogym_profile_access"
_COOKIE_PATH = "/api/v1/auth/profile-access"


class PairProfileAccessBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pairing_code: str = Field(min_length=6, max_length=6)


class ProfileEntryBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: UUID
    branch_id: UUID
    pin: str = Field(min_length=1, max_length=72)


class ProfilePinChangeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: UUID
    branch_id: UUID
    current_pin: str = Field(min_length=1, max_length=72)
    new_pin: str = Field(min_length=1, max_length=72)


class EmptyJsonBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _admin_principal(request: Request, credentials: HTTPAuthorizationCredentials | None):
    settings = request.app.state.settings
    factory = request.app.state.session_factory
    if (not settings.admin_auth_configured or not settings.admin_token_signing_configured or factory is None
            or credentials is None or credentials.scheme.lower() != "bearer"):
        raise HTTPException(401, "Authentication failed.")
    try:
        return validate_admin_session(factory, credentials.credentials, settings.admin_token_signing_secret.get_secret_value())
    except (AuthorizationDenied, ValueError):
        raise HTTPException(401, "Authentication failed.") from None


def _require_cookie_post(request: Request) -> None:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise HTTPException(415, "Unsupported media type.")
    origin = request.headers.get("origin")
    allowlist = request.app.state.settings.cors_origin_allowlist
    if not origin or origin not in allowlist:
        raise HTTPException(403, "Request origin is not allowed.")


def _set_profile_cookie(response: Response, settings, credential: str) -> None:
    response.set_cookie(
        _COOKIE_NAME,
        credential,
        max_age=90 * 24 * 60 * 60,
        httponly=True,
        secure=settings.environment != "test",
        samesite="strict",
        path=_COOKIE_PATH,
    )


def _clear_profile_cookie(response: Response, settings) -> None:
    response.delete_cookie(
        _COOKIE_NAME,
        path=_COOKIE_PATH,
        secure=settings.environment != "test",
        httponly=True,
        samesite="strict",
    )


def _identity_payload(identity) -> dict:
    if isinstance(identity, UnlinkedProfileIdentity):
        return {
            "id": str(identity.profile_id),
            "kind": "unlinked",
            "source": "roster_profile",
            "profile_id": str(identity.profile_id),
            "display_name": identity.display_name,
            "is_owner": False,
            "can_manage_employees": False,
            "branch_profiles": [{
                "profile_id": str(identity.branch.profile_id),
                "branch_id": str(identity.branch.branch_id),
                "branch_name": identity.branch.branch_name,
            }],
        }
    return {
        "id": str(identity.staff_id),
        "kind": identity.kind,
        "display_name": identity.display_name,
        "is_owner": identity.is_owner,
        "can_manage_employees": identity.can_manage_employees,
        "branch_profiles": [
            {"profile_id": str(branch.profile_id), "branch_id": str(branch.branch_id),
             "branch_name": branch.branch_name}
            for branch in identity.branches
        ],
    }


def _entry_response(result) -> dict:
    if isinstance(result, ProfilePinSetupRequired):
        return {"status": "setup_required", "identity": {"id": str(result.identity_id)},
                "profile": {"id": str(result.profile_id), "branch_id": str(result.branch_id)}}
    return {
        "access_token": result.access_token,
        "token_type": "bearer",
        "expires_at": result.expires_at.astimezone(timezone.utc).isoformat(),
        "identity": {"id": str(result.staff_id), "kind": "employee"},
        "profile": {"id": str(result.profile_id), "branch_id": str(result.branch_id)},
        "purpose": result.purpose,
    }


@router.post("/auth/profile-access/pair")
async def pair_profile_access(request: Request, response: Response, configured=Depends(_staff_rate_limit)):
    _require_cookie_post(request)
    body = await _bounded_body(request, PairProfileAccessBody)
    settings, factory = configured
    semaphore: BoundedSemaphore = request.app.state.password_hash_capacity
    if not semaphore.acquire(blocking=False):
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    try:
        binding = bind_profile_access(factory, body.pairing_code, request_id=UUID(request_id()))
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.") from None
    finally:
        semaphore.release()
    _set_profile_cookie(response, settings, binding.credential)
    response.headers["Cache-Control"] = "no-store"
    return {"status": "paired"}


@router.get("/auth/profile-access/context")
@router.get("/auth/profile-access/profiles")
def paired_profiles(request: Request, response: Response, configured=Depends(_staff_rate_limit)):
    settings, factory = configured
    credential = request.cookies.get(_COOKIE_NAME, "")
    try:
        identities = paired_profile_choices(factory, credential)
    except AuthorizationDenied:
        _clear_profile_cookie(response, settings)
        response.headers["Cache-Control"] = "no-store"
        raise HTTPException(401, "Authentication failed.") from None
    response.headers["Cache-Control"] = "no-store"
    return {"identities": [_identity_payload(item) for item in identities]}


@router.post("/auth/profile-access/sessions", status_code=201)
async def enter_paired_profile(request: Request, response: Response, configured=Depends(_staff_rate_limit)):
    _require_cookie_post(request)
    body = await _bounded_body(request, ProfileEntryBody)
    _settings, factory = configured
    semaphore: BoundedSemaphore = request.app.state.password_hash_capacity
    if not semaphore.acquire(blocking=False):
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    try:
        result = issue_profile_session(
            factory, body.profile_id, body.branch_id, body.pin,
            paired_credential=request.cookies.get(_COOKIE_NAME, ""), request_id=UUID(request_id()),
        )
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.") from None
    finally:
        semaphore.release()
    response.headers["Cache-Control"] = "no-store"
    return _entry_response(result)


@router.post("/auth/profile-access/first-pin-change", status_code=204)
async def change_paired_profile_pin(request: Request, response: Response, configured=Depends(_staff_rate_limit)):
    _require_cookie_post(request)
    body = await _bounded_body(request, ProfilePinChangeBody)
    _settings, factory = configured
    semaphore: BoundedSemaphore = request.app.state.password_hash_capacity
    if not semaphore.acquire(blocking=False):
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    try:
        changed = change_profile_initial_pin(
            factory, body.profile_id, body.branch_id, body.current_pin, body.new_pin,
            paired_credential=request.cookies.get(_COOKIE_NAME, ""),
        )
    finally:
        semaphore.release()
    if not changed:
        raise HTTPException(401, "Authentication failed.")
    response.headers["Cache-Control"] = "no-store"
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.post("/auth/profile-access/logout", status_code=204)
async def logout_profile(request: Request, response: Response, configured=Depends(_staff_rate_limit)):
    _require_cookie_post(request)
    await _bounded_body(request, EmptyJsonBody)
    settings, factory = configured
    logout_profile_access(factory, request.cookies.get(_COOKIE_NAME, ""))
    _clear_profile_cookie(response, settings)
    response.headers["Cache-Control"] = "no-store"
    response.status_code = 204
    return response


@router.post("/auth/profile-access/sessions/logout", status_code=204)
async def logout_employee_session(
    request: Request,
    response: Response,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    configured=Depends(_staff_rate_limit),
):
    await _bounded_body(request, EmptyJsonBody)
    settings, factory = configured
    if (factory is None or credentials is None or credentials.scheme.lower() != "bearer"
            or not settings.admin_auth_configured or not settings.admin_token_signing_configured):
        raise HTTPException(401, "Authentication failed.")
    try:
        validate_admin_session(factory, credentials.credentials,
                               settings.admin_token_signing_secret.get_secret_value())
    except (AuthorizationDenied, ValueError):
        pass
    else:
        raise HTTPException(401, "Authentication failed.")
    try:
        revoke_employee_profile_session(factory, credentials.credentials)
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.") from None
    response.headers["Cache-Control"] = "no-store"
    response.status_code = 204
    return response




@router.get("/admin/profile-access/choices")
def admin_profiles(request: Request, response: Response,
                   credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)):
    admin_id, session_id = _admin_principal(request, credentials)
    factory = request.app.state.session_factory
    try:
        identities = admin_profile_choices(factory, admin_id, session_id)
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.") from None
    response.headers["Cache-Control"] = "no-store"
    return {"identities": [_identity_payload(item) for item in identities],
            "current_identity_id": str(admin_id)}


@router.post("/admin/profile-access/sessions", status_code=201)
async def enter_admin_selected_profile(
    request: Request,
    response: Response,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    configured=Depends(_staff_rate_limit),
):
    _require_cookie_post(request)
    body = await _bounded_body(request, ProfileEntryBody)
    admin_id, session_id = _admin_principal(request, credentials)
    _settings, factory = configured
    semaphore: BoundedSemaphore = request.app.state.password_hash_capacity
    if not semaphore.acquire(blocking=False):
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    try:
        result = issue_profile_session(
            factory, body.profile_id, body.branch_id, body.pin,
            admin_id=admin_id, admin_session_id=session_id, request_id=UUID(request_id()),
        )
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.") from None
    finally:
        semaphore.release()
    response.headers["Cache-Control"] = "no-store"
    return _entry_response(result)


@router.post("/admin/profile-access/first-pin-change", status_code=204)
async def change_admin_selected_profile_pin(
    request: Request,
    response: Response,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    configured=Depends(_staff_rate_limit),
):
    _require_cookie_post(request)
    body = await _bounded_body(request, ProfilePinChangeBody)
    admin_id, session_id = _admin_principal(request, credentials)
    _settings, factory = configured
    semaphore: BoundedSemaphore = request.app.state.password_hash_capacity
    if not semaphore.acquire(blocking=False):
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    try:
        changed = change_profile_initial_pin(
            factory, body.profile_id, body.branch_id, body.current_pin, body.new_pin,
            admin_id=admin_id, admin_session_id=session_id,
        )
    finally:
        semaphore.release()
    if not changed:
        raise HTTPException(401, "Authentication failed.")
    response.headers["Cache-Control"] = "no-store"
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
