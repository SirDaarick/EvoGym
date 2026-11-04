"""Admin read-only view of unsettled transfers and membership debt."""
from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.api.deps import RawFactoryDep
from app.finance import service
from app.finance.schemas import PendingMoneyResponse

router = APIRouter(prefix="/api/v1/admin/pending-money", tags=["finance"])
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class FinancePrincipal:
    staff_id: UUID
    organization_admin: bool
    branch_id: UUID | None


def _principal(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> FinancePrincipal:
    factory = request.app.state.session_factory
    if factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")
    token = credentials.credentials
    try:
        settings = request.app.state.settings
        if not settings.admin_auth_configured or not settings.admin_token_signing_configured:
            raise AuthorizationDenied("Authorization denied")
        staff_id, _session_id = validate_admin_session(
            factory, token, settings.admin_token_signing_secret.get_secret_value()
        )
        return FinancePrincipal(staff_id, organization_admin=True, branch_id=None)
    except (AuthorizationDenied, ValueError):
        pass
    try:
        staff = validate_session(factory, token, Permission.MEMBER_OPERATIONAL_READ)
        return FinancePrincipal(staff.staff_id, organization_admin=False, branch_id=staff.branch_id)
    except (AuthorizationDenied, ValueError):
        raise HTTPException(401, "Authentication failed.") from None


@router.get("", response_model=PendingMoneyResponse)
def list_pending_money(
    factory: RawFactoryDep,
    branch_id: UUID | None = Query(default=None),
    principal: FinancePrincipal = Depends(_principal),
) -> PendingMoneyResponse:
    """Return unsettled source events; these items are not income or revenue."""
    return service.list_pending_money(factory, principal, branch_id)
