"""Weekly payroll and its corresponding business expenses."""
import hashlib
from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.pending_money import FinancePrincipal, _authorized_branches, _principal
from app.db.models import Expense, PayrollAdvance, PayrollPayment, StaffRosterProfile
from app.rentals.payments import clean_idempotency_key, fingerprint
from app.staff.roster import weekly_base
from app.api.deps import SessionFactoryDep

router = APIRouter(prefix="/api/v1/admin/payroll", tags=["payroll"])


class PayrollInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_id: UUID
    staff_profile_id: UUID
    week_start: date

    @field_validator("week_start")
    @classmethod
    def monday(cls, value: date) -> date:
        if value.weekday() != 0:
            raise ValueError("Week must start on Monday.")
        return value


class AdvanceInput(PayrollInput):
    amount_minor: int = Field(gt=0, le=9223372036854775807, strict=True)
    notes: str | None = Field(default=None, max_length=255)


class PaymentInput(PayrollInput):
    payment_method: Literal["transfer", "cash"]


def _authorize(session, principal, branch_id):
    if not principal.organization_admin:
        raise HTTPException(403, "Finance admin access required.")
    try:
        _authorized_branches(session, principal, branch_id)
    except HTTPException as exc:
        if exc.status_code in (403, 404):
            raise HTTPException(403, "Finance access denied.") from None
        raise


def _profile(session, payload):
    profile = session.scalar(select(StaffRosterProfile).where(
        StaffRosterProfile.id == payload.staff_profile_id,
        StaffRosterProfile.branch_id == payload.branch_id,
    ).with_for_update())
    if profile is None or not profile.is_active or profile.monthly_salary_minor <= 0:
        raise HTTPException(422, "Profile is not eligible for payroll.")
    return profile


def _amounts(session, profile, week):
    total = session.scalar(select(func.coalesce(func.sum(PayrollAdvance.amount_minor), 0)).where(
        PayrollAdvance.staff_profile_id == profile.id, PayrollAdvance.week_start == week))
    return weekly_base(profile.monthly_salary_minor), int(total)


def _payment(session, profile_id, week):
    return session.scalar(select(PayrollPayment).where(
        PayrollPayment.staff_profile_id == profile_id, PayrollPayment.week_start == week))


def _dto(row):
    result = {"id": str(row.id), "branch_id": str(row.branch_id), "staff_profile_id": str(row.staff_profile_id),
              "week_start": row.week_start.isoformat(), "expense_id": str(row.expense_id) if row.expense_id else None}
    if isinstance(row, PayrollAdvance):
        result.update(amount_minor=row.amount_minor, notes=row.notes)
    else:
        result.update(base_minor=row.base_minor, advances_minor=row.advances_minor, net_minor=row.net_minor,
                      payment_method=row.payment_method)
    return result


def _key(key):
    try:
        clean_idempotency_key(key)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return key


def _expense(session, payload, profile, principal, key, request_hash, amount, method, kind):
    # Namespace the linked expense key independently from user-created expenses.
    expense_key = "payroll-" + hashlib.sha256(f"{kind}:{key}".encode()).hexdigest()
    expense = Expense(branch_id=payload.branch_id, shift_id=None, category="general",
        concept="Adelanto de nómina" if kind == "advance" else "Nómina semanal",
        payee_name=profile.full_name, amount_minor=amount, payment_method=method,
        recorded_by_id=principal.staff_id, idempotency_key=expense_key, request_fingerprint=request_hash)
    session.add(expense)
    session.flush()
    return expense.id


@router.get("/weeks/{week_start}")
def payroll_week(week_start: date, branch_id: UUID = Query(), principal: FinancePrincipal = Depends(_principal), *, factory: SessionFactoryDep):
    if week_start.weekday() != 0:
        raise HTTPException(422, "Week must start on Monday.")
    with factory.begin() as session:
        _authorize(session, principal, branch_id)
        profiles = session.scalars(select(StaffRosterProfile).where(StaffRosterProfile.branch_id == branch_id,
            StaffRosterProfile.is_active.is_(True), StaffRosterProfile.monthly_salary_minor > 0)
            .order_by(StaffRosterProfile.full_name, StaffRosterProfile.id)).all()
        items = []
        for profile in profiles:
            payment = _payment(session, profile.id, week_start)
            base, advances = (payment.base_minor, payment.advances_minor) if payment else _amounts(session, profile, week_start)
            items.append({"profile_id": str(profile.id), "full_name": profile.full_name,
                "base_minor": base, "advances_minor": advances, "net_minor": base - advances,
                "daily_minor": (base + 2) // 5,
                "paid": {"payment_method": payment.payment_method, "paid_at": payment.created_at.isoformat()} if payment else None})
        return {"items": items, "base_minor": sum(row["base_minor"] for row in items),
                "advances_minor": sum(row["advances_minor"] for row in items), "net_minor": sum(row["net_minor"] for row in items)}


@router.post("/advances", status_code=201)
def record_advance(payload: AdvanceInput, key: str | None = Header(None, alias="Idempotency-Key"),
                   principal: FinancePrincipal = Depends(_principal), *, factory: SessionFactoryDep):
    key = _key(key)
    request_hash = fingerprint(payload.model_dump(mode="json"))
    try:
        with factory.begin() as session:
            _authorize(session, principal, payload.branch_id)
            prior = session.scalar(select(PayrollAdvance).where(PayrollAdvance.branch_id == payload.branch_id,
                PayrollAdvance.recorded_by_id == principal.staff_id, PayrollAdvance.idempotency_key == key))
            if prior:
                if prior.request_fingerprint != request_hash:
                    raise HTTPException(409, "Idempotency key was used for another request.")
                return _dto(prior)
            profile = _profile(session, payload)
            if _payment(session, profile.id, payload.week_start):
                raise HTTPException(409, "Week is already paid.")
            base, advances = _amounts(session, profile, payload.week_start)
            if payload.amount_minor > base - advances:
                raise HTTPException(422, "Advance exceeds remaining net.")
            expense_id = _expense(session, payload, profile, principal, key, request_hash, payload.amount_minor, "transfer", "advance")
            row = PayrollAdvance(**payload.model_dump(), expense_id=expense_id, recorded_by_id=principal.staff_id,
                                 idempotency_key=key, request_fingerprint=request_hash)
            session.add(row)
            session.flush()
            return _dto(row)
    except IntegrityError:
        raise HTTPException(409, "Payroll operation conflicts with existing data.") from None


@router.post("/payments", status_code=201)
def pay_week(payload: PaymentInput, key: str | None = Header(None, alias="Idempotency-Key"),
             principal: FinancePrincipal = Depends(_principal), *, factory: SessionFactoryDep):
    key = _key(key)
    request_hash = fingerprint(payload.model_dump(mode="json"))
    try:
        with factory.begin() as session:
            _authorize(session, principal, payload.branch_id)
            prior = session.scalar(select(PayrollPayment).where(PayrollPayment.branch_id == payload.branch_id,
                PayrollPayment.recorded_by_id == principal.staff_id, PayrollPayment.idempotency_key == key))
            if prior:
                if prior.request_fingerprint != request_hash:
                    raise HTTPException(409, "Idempotency key was used for another request.")
                return _dto(prior)
            profile = _profile(session, payload)
            if _payment(session, profile.id, payload.week_start):
                raise HTTPException(409, "Week is already paid.")
            base, advances = _amounts(session, profile, payload.week_start)
            net = base - advances
            if net < 0:
                raise HTTPException(409, "Advances exceed the weekly base.")
            expense_id = _expense(session, payload, profile, principal, key, request_hash, net, payload.payment_method, "payment") if net else None
            row = PayrollPayment(**payload.model_dump(), base_minor=base, advances_minor=advances, net_minor=net,
                                 expense_id=expense_id, recorded_by_id=principal.staff_id,
                                 idempotency_key=key, request_fingerprint=request_hash)
            session.add(row)
            session.flush()
            return _dto(row)
    except IntegrityError:
        raise HTTPException(409, "Payroll operation conflicts with existing data.") from None
