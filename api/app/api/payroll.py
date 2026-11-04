"""Weekly payroll HTTP transport: parse the request, call one `app.finance.service` function."""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query

from app.api.deps import SessionFactoryDep
from app.api.pending_money import FinancePrincipal, _principal
from app.finance import service
from app.finance.schemas import AdvanceInput, PaymentInput

router = APIRouter(prefix="/api/v1/admin/payroll", tags=["payroll"])


@router.get("/weeks/{week_start}")
def payroll_week(week_start: date, branch_id: UUID = Query(), principal: FinancePrincipal = Depends(_principal), *, factory: SessionFactoryDep):
    return service.payroll_week(factory, principal, branch_id, week_start)


@router.post("/advances", status_code=201)
def record_advance(payload: AdvanceInput, key: str | None = Header(None, alias="Idempotency-Key"),
                   principal: FinancePrincipal = Depends(_principal), *, factory: SessionFactoryDep):
    return service.record_advance(factory, principal, payload, key)


@router.post("/payments", status_code=201)
def pay_week(payload: PaymentInput, key: str | None = Header(None, alias="Idempotency-Key"),
             principal: FinancePrincipal = Depends(_principal), *, factory: SessionFactoryDep):
    return service.pay_week(factory, principal, payload, key)
