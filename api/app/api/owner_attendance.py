"""Owner attendance HTTP transport (admin only): parse the request, call `app.finance.attendance`."""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.deps import FinancePrincipal, RawFactoryDep
from app.api.owner_overview import _overview_principal
from app.finance import attendance

router = APIRouter(prefix="/api/v1/owner/attendance", tags=["owner-attendance"])


@router.get("")
def owner_attendance(
    factory: RawFactoryDep,
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    branch_id: UUID | None = None,
    principal: FinancePrincipal = Depends(_overview_principal),
):
    return attendance.owner_attendance(factory, principal, from_date, to_date, branch_id)
