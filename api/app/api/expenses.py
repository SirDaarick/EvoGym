"""Shift expense and cash contribution endpoints."""
from typing import Literal
from uuid import UUID, uuid4
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.rentals import _factory, _receptionist
from app.api.pending_money import FinancePrincipal, _authorized_branches, _principal as finance_principal
from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
from app.db.models import CashRegister, Expense, Shift, ShiftCashContribution
from app.rentals.payments import clean_idempotency_key, fingerprint, staff_display_name
from app.shifts.queries import expected_cash_for_shift
from app.shifts.schemas import _serialize_datetime
from app.expenses.storage import get_evidence_storage

router = APIRouter(prefix="/api/v1", tags=["expenses"])
_bearer = HTTPBearer(auto_error=False)
Category = Literal["consumibles", "limpieza", "mantenimiento_piso", "mantenimiento_peso", "mantenimiento_cardio", "mantenimiento_box", "servicios", "general"]


class MovementInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    concept: str = Field(min_length=1, max_length=255)
    amount_minor: StrictInt = Field(gt=0, le=2**63 - 1)


class ExpenseInput(MovementInput):
    category: Category
    payee_name: str = Field(min_length=1, max_length=160)
    voucher_reference: str | None = Field(default=None, max_length=120)
    evidence_key: str | None = Field(default=None, max_length=255)


class ContributionInput(MovementInput):
    contributor_name: str = Field(min_length=1, max_length=160)


class BusinessExpenseInput(ExpenseInput):
    branch_id: UUID
    payment_method: Literal["cash", "card", "transfer"]


class VoidInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    reason: str = Field(min_length=1, max_length=500)


class EvidenceUploadInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_id: UUID
    content_type: Literal["image/webp"]
    file_size_bytes: StrictInt = Field(gt=0, le=1048576)


def _register(session, register_id, principal, *, lock=False):
    query = select(CashRegister).where(CashRegister.id == register_id)
    if lock:
        query = query.execution_options(populate_existing=True).with_for_update()
    register = session.scalar(query)
    if register is None:
        raise HTTPException(404, "Cash register not found.")
    _receptionist(session, register.branch_id, principal)
    return register


def _shift(session, register_id, *, lock=False):
    query = select(Shift).where(Shift.cash_register_id == register_id, Shift.status == "open")
    if lock:
        query = query.execution_options(populate_existing=True).with_for_update()
    return session.scalar(query)


def _dto(session, row, request):
    base = {"id": row.id, "shift_id": row.shift_id, "concept": row.concept,
            "amount_minor": row.amount_minor, "recorded_by_name": staff_display_name(session, row.recorded_by_id, row.branch_id),
            "recorded_at": _serialize_datetime(row.created_at)}
    if isinstance(row, Expense):
        storage = get_evidence_storage(request) if row.evidence_key else None
        base.update(branch_id=row.branch_id, category=row.category, payee_name=row.payee_name,
                    payment_method=row.payment_method, voucher_reference=row.voucher_reference,
                    evidence_url=storage.presign_get(row.evidence_key) if storage else None, voided_at=_serialize_datetime(row.voided_at),
                    voided_by_name=staff_display_name(session, row.voided_by_id, row.branch_id) if row.voided_by_id else None,
                    void_reason=row.void_reason)
    else:
        base["contributor_name"] = row.contributor_name
    return base


def _create(request, register_id, principal, payload, key, model):
    try:
        clean_idempotency_key(key)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    values = payload.model_dump()
    request_hash = fingerprint(str(register_id), values)
    try:
        with _factory(request).begin() as session:
            register = _register(session, register_id, principal, lock=True)
            prior = session.scalar(select(model).where(model.branch_id == register.branch_id,
                model.recorded_by_id == principal.staff_id, model.idempotency_key == key).with_for_update())
            if prior is not None:
                if prior.request_fingerprint != request_hash:
                    raise HTTPException(409, "Idempotency key was used for another request.")
                return _dto(session, prior, request)
            shift = _shift(session, register_id, lock=True)
            if shift is None:
                raise HTTPException(409, "An open shift is required.")
            _validate_evidence(request, register.branch_id, values.get("evidence_key"))
            if model is Expense:
                values["payment_method"] = "cash"
            row = model(**values, branch_id=register.branch_id, shift_id=shift.id,
                        recorded_by_id=principal.staff_id, idempotency_key=key, request_fingerprint=request_hash,
                        created_at=datetime.now(timezone.utc))
            session.add(row)
            session.flush()
            try:
                expected_cash_for_shift(session, shift)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from None
            return _dto(session, row, request)
    except IntegrityError:
        raise HTTPException(409, "Cash movement conflicts with existing data.") from None


def _list(request, register_id, principal, model):
    with _factory(request)() as session:
        _register(session, register_id, principal)
        shift = _shift(session, register_id)
        rows = [] if shift is None else list(session.scalars(select(model).where(model.shift_id == shift.id).order_by(model.created_at.desc(), model.id.desc())))
        return {"items": [_dto(session, row, request) for row in rows],
                "total_minor": sum(row.amount_minor for row in rows if not isinstance(row, Expense) or row.voided_at is None)}


@router.post("/registers/{register_id}/expenses", status_code=201)
def create_shift_expense(register_id: UUID, payload: ExpenseInput, request: Request,
                         key: str | None = Header(None, alias="Idempotency-Key"),
                         principal: ShiftActorPrincipal = Depends(get_shift_actor_principal)):
    return _create(request, register_id, principal, payload, key, Expense)


@router.get("/registers/{register_id}/expenses")
def list_shift_expenses(register_id: UUID, request: Request, principal: ShiftActorPrincipal = Depends(get_shift_actor_principal)):
    return _list(request, register_id, principal, Expense)


@router.post("/registers/{register_id}/cash-contributions", status_code=201)
def create_contribution(register_id: UUID, payload: ContributionInput, request: Request,
                        key: str | None = Header(None, alias="Idempotency-Key"),
                        principal: ShiftActorPrincipal = Depends(get_shift_actor_principal)):
    return _create(request, register_id, principal, payload, key, ShiftCashContribution)


@router.get("/registers/{register_id}/cash-contributions")
def list_contributions(register_id: UUID, request: Request, principal: ShiftActorPrincipal = Depends(get_shift_actor_principal)):
    return _list(request, register_id, principal, ShiftCashContribution)


@router.post("/admin/expenses", status_code=201)
def create_business_expense(payload: BusinessExpenseInput, request: Request,
                            key: str | None = Header(None, alias="Idempotency-Key"),
                            principal: FinancePrincipal = Depends(finance_principal)):
    try:
        clean_idempotency_key(key)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    values = payload.model_dump()
    request_hash = fingerprint(values)
    try:
        with _factory(request).begin() as session:
            _authorized_branches(session, principal, payload.branch_id)
            prior = session.scalar(select(Expense).where(Expense.branch_id == payload.branch_id,
                Expense.recorded_by_id == principal.staff_id, Expense.idempotency_key == key).with_for_update())
            if prior:
                if prior.request_fingerprint != request_hash:
                    raise HTTPException(409, "Idempotency key was used for another request.")
                return _dto(session, prior, request)
            _validate_evidence(request, payload.branch_id, values.get("evidence_key"))
            row = Expense(**values, recorded_by_id=principal.staff_id, idempotency_key=key,
                          request_fingerprint=request_hash, created_at=datetime.now(timezone.utc))
            session.add(row)
            session.flush()
            return _dto(session, row, request)
    except IntegrityError:
        raise HTTPException(409, "Expense conflicts with existing data.") from None


@router.get("/admin/expenses")
def list_admin_expenses(request: Request, from_date: date = Query(alias="from"),
                        to_date: date = Query(alias="to"), branch_id: UUID | None = None,
                        principal: FinancePrincipal = Depends(finance_principal)):
    if to_date < from_date or to_date == date.max:
        raise HTTPException(422, "Invalid date range.")
    with _factory(request)() as session:
        branches = _authorized_branches(session, principal, branch_id)
        rows = []
        for branch in branches:
            zone = ZoneInfo(branch.timezone)
            start = datetime.combine(from_date, time.min, zone).astimezone(timezone.utc)
            end = datetime.combine(to_date + timedelta(days=1), time.min, zone).astimezone(timezone.utc)
            rows.extend(session.scalars(select(Expense).where(Expense.branch_id == branch.id,
                Expense.created_at >= start, Expense.created_at < end)).all())
        rows.sort(key=lambda row: (row.created_at, str(row.id)), reverse=True)
        return {"items": [_dto(session, row, request) for row in rows],
                "branches": [{"id": branch.id, "name": branch.name} for branch in branches]}


@router.post("/expenses/{expense_id}/void")
def void_expense(expense_id: UUID, payload: VoidInput, request: Request,
                 principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
                 credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)):
    with _factory(request).begin() as session:
        row = session.get(Expense, expense_id)
        if row is None:
            raise HTTPException(404, "Expense not found.")
        if principal.is_admin or row.shift_id is None:
            finance = finance_principal(request, credentials)
            _authorized_branches(session, finance, row.branch_id)
        else:
            _receptionist(session, row.branch_id, principal)
        if row.shift_id is not None:
            register_id = session.scalar(select(Shift.cash_register_id).where(Shift.id == row.shift_id))
            _register(session, register_id, principal, lock=True)
            shift = session.scalar(select(Shift).where(Shift.id == row.shift_id).execution_options(populate_existing=True).with_for_update())
            if shift is None or shift.status != "open":
                raise HTTPException(409, "Only expenses in open shifts can be voided.")
        row = session.scalar(select(Expense).where(Expense.id == expense_id).execution_options(populate_existing=True).with_for_update())
        if row.voided_at is not None:
            if row.void_reason == payload.reason:
                return _dto(session, row, request)
            raise HTTPException(409, "Expense is already voided.")
        row.voided_at = datetime.now(timezone.utc)
        row.voided_by_id = principal.staff_id
        row.void_reason = payload.reason
        session.flush()
        return _dto(session, row, request)


def _validate_evidence(request, branch_id, key):
    if key is None:
        return
    if not key.startswith(f"expenses/{branch_id}/"):
        raise HTTPException(422, "Invalid expense evidence.")
    storage = get_evidence_storage(request)
    if storage is None:
        raise HTTPException(501, "Evidence storage is not configured.")
    if not storage.exists(key):
        raise HTTPException(422, "Invalid expense evidence.")


@router.post("/expenses/evidence-uploads")
def request_evidence_upload(payload: EvidenceUploadInput, request: Request,
                            principal: ShiftActorPrincipal = Depends(get_shift_actor_principal),
                            credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)):
    with _factory(request)() as session:
        if principal.is_admin:
            _authorized_branches(session, finance_principal(request, credentials), payload.branch_id)
        else:
            _receptionist(session, payload.branch_id, principal)
    storage = get_evidence_storage(request)
    if storage is None:
        raise HTTPException(501, "Evidence storage is not configured.")
    key = f"expenses/{payload.branch_id}/{uuid4()}.webp"
    return {"upload_url": storage.presign_put(key, payload.content_type, payload.file_size_bytes), "evidence_key": key}
