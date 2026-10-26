"""Admin enrollment code issuance, listing, and revocation endpoints."""
from datetime import timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied
from app.auth.enrollment import issue_enrollment_code, list_enrollment_codes, revoke_enrollment_code
from app.observability.logging import request_id

router = APIRouter(prefix="/api/v1/admin/enrollment-codes", tags=["admin enrollment"])
_bearer = HTTPBearer(auto_error=False)


def _principal(request: Request, credentials: HTTPAuthorizationCredentials | None):
    settings = request.app.state.settings
    factory = request.app.state.session_factory
    if (not settings.admin_auth_configured or not settings.admin_token_signing_configured or factory is None
            or credentials is None or credentials.scheme.lower() != "bearer"):
        raise HTTPException(401, "Authentication failed.")
    try:
        return validate_admin_session(factory, credentials.credentials, settings.admin_token_signing_secret.get_secret_value())
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.") from None


class IssueEnrollmentCodePayload(BaseModel):
    login_identifier: str = Field(min_length=1, max_length=320)
    role: str = Field(min_length=1, max_length=32)
    branch_id: UUID | None = None
    ttl_seconds: int = Field(default=86400, ge=60, le=604800)


@router.post("")
def issue_code(
    payload: IssueEnrollmentCodePayload,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
):
    staff_id, _current_session = _principal(request, credentials)
    factory = request.app.state.session_factory
    req_id = UUID(request_id())
    try:
        issued = issue_enrollment_code(
            factory,
            admin_id=staff_id,
            login_identifier=payload.login_identifier,
            role=payload.role,
            branch_id=payload.branch_id,
            ttl_seconds=payload.ttl_seconds,
            request_id=req_id,
        )
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))
    return {
        "id": str(issued.id),
        "code": issued.raw_code,
        "login_identifier": issued.login_identifier,
        "role": issued.role,
        "branch_id": str(issued.branch_id) if issued.branch_id else None,
        "created_at": issued.created_at.astimezone(timezone.utc).isoformat(),
        "expires_at": issued.expires_at.astimezone(timezone.utc).isoformat(),
    }


@router.get("")
def list_codes(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
):
    staff_id, _current_session = _principal(request, credentials)
    factory = request.app.state.session_factory
    records = list_enrollment_codes(factory, staff_id)
    return {
        "enrollment_codes": [
            {
                "id": str(r.id),
                "login_identifier": r.login_identifier,
                "role": r.role,
                "branch_id": str(r.branch_id) if r.branch_id else None,
                "created_by": str(r.created_by),
                "created_at": r.created_at.astimezone(timezone.utc).isoformat(),
                "expires_at": r.expires_at.astimezone(timezone.utc).isoformat(),
                "used_at": r.used_at.astimezone(timezone.utc).isoformat() if r.used_at else None,
                "revoked_at": r.revoked_at.astimezone(timezone.utc).isoformat() if r.revoked_at else None,
                "status": r.status,
            }
            for r in records
        ]
    }


@router.post("/{code_id}/revoke")
def revoke_code(
    code_id: UUID,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
):
    staff_id, _current_session = _principal(request, credentials)
    factory = request.app.state.session_factory
    req_id = UUID(request_id())
    success = revoke_enrollment_code(factory, staff_id, code_id, request_id=req_id)
    if not success:
        raise HTTPException(404, "The requested resource was not found.")
    return {"revoked": True}
