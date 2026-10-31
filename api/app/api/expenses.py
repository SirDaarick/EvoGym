"""Shift expense and cash contribution endpoints."""
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.rentals import _factory, _receptionist
from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
from app.db.models import CashRegister, Expense, Shift, ShiftCashContribution
from app.rentals.payments import clean_idempotency_key, fingerprint, staff_display_name
from app.shifts.queries import expected_cash_for_shift
from app.shifts.schemas import _serialize_datetime

router = APIRouter(prefix="/api/v1", tags=["expenses"])
Category = Literal["consumibles", "limpieza", "mantenimiento_piso", "mantenimiento_peso", "mantenimiento_cardio", "mantenimiento_box", "servicios", "general"]


class MovementInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    concept: str = Field(min_length=1, max_length=255)
    amount_minor: StrictInt = Field(gt=0, le=2**63 - 1)


class ExpenseInput(MovementInput):
    category: Category
    payee_name: str = Field(min_length=1, max_length=160)
    voucher_reference: str | None = Field(default=None, max_length=120)


class ContributionInput(MovementInput):
    contributor_name: str = Field(min_length=1, max_length=160)


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


def _dto(session, row):
    return {"id": row.id, "branch_id": row.branch_id, "shift_id": row.shift_id, "concept": row.concept,
            "amount_minor": row.amount_minor, "recorded_by_name": staff_display_name(session, row.recorded_by_id, row.branch_id),
            "recorded_at": _serialize_datetime(row.created_at)}


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
                return _dto(session, prior)
            shift = _shift(session, register_id, lock=True)
            if shift is None:
                raise HTTPException(409, "An open shift is required.")
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
            return _dto(session, row)
    except IntegrityError:
        raise HTTPException(409, "Cash movement conflicts with existing data.") from None


def _list(request, register_id, principal, model):
    with _factory(request)() as session:
        _register(session, register_id, principal)
        shift = _shift(session, register_id)
        rows = [] if shift is None else list(session.scalars(select(model).where(model.shift_id == shift.id).order_by(model.created_at.desc(), model.id.desc())))
        return {"items": [_dto(session, row) for row in rows],
                "total_minor": sum(row.amount_minor for row in rows)}


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
