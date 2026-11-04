"""Membership access HTTP transport: resolve the actor, call one `app.memberships.service` function."""
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.admin import validate_admin_session
from app.auth.sessions import validate_session
from app.memberships import service
from app.memberships.schemas import AccessDecisionRequest

router = APIRouter(prefix="/api/v1/membership-access", tags=["membership access"])
_bearer = HTTPBearer(auto_error=False)


@router.post("/periods/{period_id}/decisions", status_code=201)
def record_access_decision(
    period_id: UUID,
    payload: AccessDecisionRequest,
    request: Request,
    response: Response,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
):
    factory = request.app.state.session_factory
    if factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")
    staff_id = None
    settings = request.app.state.settings
    if settings.admin_auth_configured and settings.admin_token_signing_configured:
        try:
            staff_id, _admin_session_id = validate_admin_session(
                factory, credentials.credentials, settings.admin_token_signing_secret.get_secret_value()
            )
        except (AuthorizationDenied, ValueError):
            pass
    if staff_id is None:
        try:
            staff_id = validate_session(factory, credentials.credentials, Permission.MEMBER_OPERATIONAL_READ).staff_id
        except (AuthorizationDenied, ValueError):
            raise HTTPException(401, "Authentication failed.") from None
    body, replayed = service.record_access_decision(factory, staff_id, period_id, payload, idempotency_key)
    if replayed:
        response.status_code = 200
    return body
