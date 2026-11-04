"""Admin read-only view of unsettled transfers and membership debt."""
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.deps import FinancePrincipal, RawFactoryDep, _principal
from app.finance import service
from app.finance.schemas import PendingMoneyResponse

router = APIRouter(prefix="/api/v1/admin/pending-money", tags=["finance"])


@router.get("", response_model=PendingMoneyResponse)
def list_pending_money(
    factory: RawFactoryDep,
    branch_id: UUID | None = Query(default=None),
    principal: FinancePrincipal = Depends(_principal),
) -> PendingMoneyResponse:
    """Return unsettled source events; these items are not income or revenue."""
    return service.list_pending_money(factory, principal, branch_id)
