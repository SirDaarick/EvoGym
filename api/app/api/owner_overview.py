"""Owner overview HTTP transport: parse the request, call `app.finance.overview`."""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials

from app.api.deps import RawFactoryDep
from app.api.pending_money import FinancePrincipal, _bearer, _principal
from app.finance import overview

router = APIRouter(prefix="/api/v1/owner/overview", tags=["owner-overview"])


def _overview_principal(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> FinancePrincipal:
    try:
        return _principal(request, credentials)
    except HTTPException as exc:
        if exc.status_code == 401:
            raise HTTPException(403, "Finance access denied.") from None
        raise


@router.get("")
def owner_overview(
    factory: RawFactoryDep,
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    branch_id: UUID | None = None,
    principal: FinancePrincipal = Depends(_overview_principal),
):
    return overview.owner_overview(factory, principal, from_date, to_date, branch_id)
