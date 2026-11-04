from datetime import timezone
import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from pydantic import ValidationError
from uuid import UUID

from app.auth import admin_login as service
from app.auth.admin import AdminLoginPending

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    login_identifier: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=4096)
    category: str = Field(default="computer", pattern="^(computer|phone)$")


class DeviceApprovalBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=43, max_length=43)


class ApprovalPollBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    poll_token: str = Field(min_length=43, max_length=43)


class RefreshBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: str = Field(pattern="^(computer|phone)$")


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


async def _bounded_body(request: Request, model: type[BaseModel]) -> BaseModel:
    raw = await request.body()
    if len(raw) > request.app.state.settings.auth_request_max_bytes:
        raise HTTPException(413, "The request is too large.")
    try:
        return model.model_validate_json(raw)
    except ValidationError:
        raise HTTPException(422, "Invalid request.") from None


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
    return settings, factory


def _set_cookie(response: Response, settings, name: str, value: str) -> None:
    response.set_cookie(name, value, httponly=True, secure=settings.environment != "test",
                        samesite="strict", path="/api/v1/auth", max_age=90 * 24 * 60 * 60)


def _session_response(response: Response, settings, result) -> dict:
    _set_cookie(response, settings, f"admin_refresh_{result.category}", result.refresh_token)
    _set_cookie(response, settings, f"admin_device_{result.category}", result.device_cookie)
    response.headers["Cache-Control"] = "no-store"
    return _token_body(result)


def _token_body(result) -> dict:
    return {"access_token": result.token, "token_type": "bearer", "expires_at": result.expires_at.astimezone(timezone.utc).isoformat()}


@router.post("/sessions", status_code=201)
def login(body: LoginBody, request: Request, response: Response, configured=Depends(_rate_limit)):
    settings, factory = configured
    result = service.login(factory, settings, request.app.state.password_hash_capacity,
        login_identifier=body.login_identifier, password=body.password, category=body.category,
        device_cookie=request.cookies.get(f"admin_device_{body.category}"), delivery=request.app.state.recovery_delivery)
    if isinstance(result, AdminLoginPending):
        response.status_code = 202
        response.headers["Cache-Control"] = "no-store"
        return {"status": "approval_required", "approval_id": str(result.approval_id), "poll_token": result.poll_token}
    return _session_response(response, settings, result)


@router.post("/staff/sessions", status_code=201)
def staff_login(body: StaffSessionBody, request: Request, response: Response, configured=Depends(_staff_rate_limit)):
    settings, factory = configured
    result = service.staff_login(factory, settings, request.app.state.password_hash_capacity,
        login_identifier=body.login_identifier, pin=body.pin, branch_id=body.branch_id)
    response.headers["Cache-Control"] = "no-store"
    return _token_body(result)


@router.post("/recovery/start", status_code=202)
def recovery_start(body: RecoveryStartBody, request: Request, configured=Depends(_rate_limit)):
    settings, factory = configured
    service.recovery_start(factory, settings, request.app.state.recovery_delivery, body.login_identifier)
    return {"message": "If eligible, recovery instructions have been queued."}


@router.post("/recovery/complete", status_code=204)
def recovery_complete(body: RecoveryCompleteBody, request: Request, configured=Depends(_rate_limit)):
    settings, factory = configured
    service.recovery_complete(factory, settings, request.app.state.password_hash_capacity, body.token, body.new_password)
    return None


@router.post("/devices/approve", status_code=204)
async def device_approval(request: Request, configured=Depends(_rate_limit)):
    body = await _bounded_body(request, DeviceApprovalBody)
    _settings, factory = configured
    service.approve_device(factory, body.token)
    return None


@router.post("/devices/approval/{approval_id}/poll")
async def device_approval_poll(approval_id: UUID, request: Request, response: Response,
                              configured=Depends(_rate_limit)):
    body = await _bounded_body(request, ApprovalPollBody)
    settings, factory = configured
    result = service.poll_approval(factory, settings, request.app.state.recovery_delivery, approval_id, body.poll_token)
    if isinstance(result, AdminLoginPending):
        response.status_code = 202
        response.headers["Cache-Control"] = "no-store"
        return {"status": "pending"}
    return _session_response(response, settings, result)


@router.post("/refresh")
async def refresh(request: Request, response: Response, configured=Depends(_rate_limit)):
    body = await _bounded_body(request, RefreshBody)
    settings, factory = configured
    cookie_name = f"admin_refresh_{body.category}"
    result = service.refresh(factory, settings, request.cookies.get(cookie_name))
    if result is None:
        response.delete_cookie(cookie_name, path="/api/v1/auth")
        raise HTTPException(401, "Authentication failed.")
    _set_cookie(response, settings, cookie_name, result.refresh_token)
    response.headers["Cache-Control"] = "no-store"
    return _token_body(result)


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, configured=Depends(_rate_limit)):
    body = await _bounded_body(request, RefreshBody)
    settings, factory = configured
    cookie_name = f"admin_refresh_{body.category}"
    service.logout(factory, settings, request.cookies.get(cookie_name), body.category)
    response.delete_cookie(cookie_name, path="/api/v1/auth", httponly=True,
                           secure=settings.environment != "test", samesite="strict")
    response.headers["Cache-Control"] = "no-store"
    return None
