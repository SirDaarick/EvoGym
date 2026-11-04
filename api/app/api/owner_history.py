"""Owner history HTTP transport: parse the request, call `app.finance.history`."""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.deps import FinancePrincipal, RawFactoryDep
from app.api.owner_overview import _overview_principal
from app.finance import history

router = APIRouter(prefix="/api/v1/owner/history", tags=["owner-history"])


@router.get("")
def owner_history(
    factory: RawFactoryDep,
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    category: str | None = None,
    method: str | None = None,
    branch_id: UUID | None = None,
    cursor: str | None = Query(None, max_length=512),
    limit: int = Query(50, ge=1, le=history.MAX_LIMIT),
    principal: FinancePrincipal = Depends(_overview_principal),
):
    return history.owner_history(factory, principal, from_date, to_date, category, method, branch_id, cursor, limit)
