"""Shift expense and cash contribution HTTP transport: call one `app.expenses.service` function."""
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.api.deps import RawFactoryDep
from app.api.deps import FinancePrincipal, _principal as finance_principal
from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
from app.expenses import service
from app.expenses.schemas import (
    BusinessExpenseInput, ContributionInput, EvidenceUploadInput, ExpenseInput, VoidInput,
)
from app.expenses.storage import get_evidence_storage

router = APIRouter(prefix="/api/v1", tags=["expenses"])
_bearer = HTTPBearer(auto_error=False)
IdempotencyKey = Annotated[str | None, Header(alias="Idempotency-Key")]
Principal = Annotated[ShiftActorPrincipal, Depends(get_shift_actor_principal)]
Finance = Annotated[FinancePrincipal, Depends(finance_principal)]
Credentials = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]


def _storage(request: Request):
    """Lazy: storage is only resolved where the flow needs it."""
    return lambda: get_evidence_storage(request)


Storage = Annotated[object, Depends(_storage)]


def _resolve_finance(request: Request, credentials):
    return lambda: finance_principal(request, credentials)


@router.post("/registers/{register_id}/expenses", status_code=201)
def create_shift_expense(register_id: UUID, payload: ExpenseInput, factory: RawFactoryDep, storage: Storage,
                         key: IdempotencyKey, principal: Principal):
    return service.create_shift_expense(factory, storage, register_id, principal, payload, key)


@router.get("/registers/{register_id}/expenses")
def list_shift_expenses(register_id: UUID, factory: RawFactoryDep, storage: Storage, principal: Principal):
    return service.list_shift_expenses(factory, storage, register_id, principal)


@router.post("/registers/{register_id}/cash-contributions", status_code=201)
def create_contribution(register_id: UUID, payload: ContributionInput, factory: RawFactoryDep, storage: Storage,
                        key: IdempotencyKey, principal: Principal):
    return service.create_contribution(factory, storage, register_id, principal, payload, key)


@router.get("/registers/{register_id}/cash-contributions")
def list_contributions(register_id: UUID, factory: RawFactoryDep, storage: Storage, principal: Principal):
    return service.list_contributions(factory, storage, register_id, principal)


@router.post("/admin/expenses", status_code=201)
def create_business_expense(payload: BusinessExpenseInput, factory: RawFactoryDep, storage: Storage,
                            key: IdempotencyKey, principal: Finance):
    return service.create_business_expense(factory, storage, principal, payload, key)


@router.get("/admin/expenses")
def list_admin_expenses(factory: RawFactoryDep, storage: Storage, principal: Finance,
                        from_date: date = Query(alias="from"), to_date: date = Query(alias="to"),
                        branch_id: UUID | None = None):
    return service.list_admin_expenses(factory, storage, principal, from_date, to_date, branch_id)


@router.post("/expenses/{expense_id}/void")
def void_expense(expense_id: UUID, payload: VoidInput, request: Request, factory: RawFactoryDep, storage: Storage,
                 principal: Principal, credentials: Credentials):
    return service.void_expense(factory, storage, _resolve_finance(request, credentials), expense_id, principal, payload)


@router.post("/expenses/evidence-uploads")
def request_evidence_upload(payload: EvidenceUploadInput, request: Request, factory: RawFactoryDep, storage: Storage,
                            principal: Principal, credentials: Credentials):
    return service.request_evidence_upload(factory, storage, _resolve_finance(request, credentials), principal, payload)
