"""Online, branch-scoped member check-in events."""
from datetime import datetime, timezone
from hashlib import sha256
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.members import MemberActorPrincipal, get_member_actor_principal
from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.db.models import (Branch, ClassSampleCheckIn, ClassSampleEntitlement, Member, MemberCheckIn,
                           MembershipDebt, MembershipDebtPayment, MembershipPeriod, Order, OrderItem, Payment,
                           PaymentReviewEvent)
from app.db.models.member_check_ins import MemberCheckInVisit
from app.errors import CheckInConflictResponse, PublicDomainError, ValidationErrorResponse
from app.memberships.eligibility import evaluate_membership_access

router = APIRouter(prefix="/api/v1/member-check-ins", tags=["member-check-ins"])


class MemberCheckInResponse(BaseModel):
    id: UUID
    visit_id: UUID
    member_id: UUID
    period_id: UUID
    branch_id: UUID
    recorded_by: UUID
    occurred_at: datetime
    access_reason: str
    access_warnings: list[str]
    replayed: bool


class ClassSampleCheckInResponse(BaseModel):
    id: UUID
    entitlement_id: UUID
    member_id: UUID
    branch_id: UUID
    recorded_by: UUID
    occurred_at: datetime
    access_reason: str
    access_warnings: list[str]
    replayed: bool


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _response(event: MemberCheckIn, *, replayed: bool) -> MemberCheckInResponse:
    occurred_at = event.occurred_at
    if occurred_at.tzinfo is None:
        occurred_at = occurred_at.replace(tzinfo=timezone.utc)
    return MemberCheckInResponse(
        id=event.id,
        visit_id=event.visit_id,
        member_id=event.member_id,
        period_id=event.period_id,
        branch_id=event.branch_id,
        recorded_by=event.recorded_by,
        occurred_at=occurred_at.astimezone(timezone.utc),
        access_reason=event.access_reason,
        access_warnings=event.access_warnings,
        replayed=replayed,
    )


def _find_by_key(session, principal: MemberActorPrincipal, branch_id: UUID, key: str):
    return session.scalar(select(MemberCheckIn).where(
        MemberCheckIn.branch_id == branch_id,
        MemberCheckIn.recorded_by == principal.staff_id,
        MemberCheckIn.idempotency_key == key,
    ).with_for_update())


def _sample_response(event: ClassSampleCheckIn, *, replayed: bool) -> ClassSampleCheckInResponse:
    return ClassSampleCheckInResponse(
        id=event.id, entitlement_id=event.entitlement_id, member_id=event.member_id,
        branch_id=event.branch_id, recorded_by=event.recorded_by,
        occurred_at=_aware_utc(event.occurred_at), access_reason=event.access_reason,
        access_warnings=event.access_warnings, replayed=replayed,
    )


def _find_sample_by_key(session, principal: MemberActorPrincipal, branch_id: UUID, key: str):
    return session.scalar(select(ClassSampleCheckIn).where(
        ClassSampleCheckIn.branch_id == branch_id,
        ClassSampleCheckIn.recorded_by == principal.staff_id,
        ClassSampleCheckIn.idempotency_key == key,
    ).with_for_update())


def _resolve_sample_checkin_conflict(*, key_event, entitlement_event, fingerprint: str):
    """Prefer an exact retry over the consumed-entitlement conflict."""
    if key_event is not None:
        if key_event.request_fingerprint != fingerprint:
            raise HTTPException(409, "Idempotency key was already used for a different check-in.")
        return key_event, True
    if entitlement_event is not None:
        raise PublicDomainError("class_sample_already_used")
    return None, False


@router.post("/branches/{branch_id}/samples/{entitlement_id}", response_model=ClassSampleCheckInResponse, status_code=201,
             responses={409: {"model": CheckInConflictResponse}, 422: {"model": ValidationErrorResponse}})
def record_class_sample_check_in(
    branch_id: UUID,
    entitlement_id: UUID,
    request: Request,
    response: Response,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128,
                                 pattern=r"^[A-Za-z0-9._:-]+$"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
):
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503, "Database unavailable.")
    fingerprint = sha256(f"class-sample\n{branch_id}\n{entitlement_id}\n{principal.staff_id}".encode()).hexdigest()
    with factory.begin() as session:
        if not principal.is_admin and principal.branch_id != branch_id:
            raise HTTPException(404, "Branch not found.")
        try:
            authorize(session, principal.staff_id, Permission.MEMBER_OPERATIONAL_READ, branch_id)
        except AuthorizationDenied:
            raise HTTPException(403, "Member check-in requires an active scoped Admin or receptionist grant.") from None
        branch = session.get(Branch, branch_id)
        if branch is None or not branch.is_active:
            raise HTTPException(404, "Branch not found.")
        existing = _find_sample_by_key(session, principal, branch_id, idempotency_key)
        if existing is not None:
            if existing.request_fingerprint != fingerprint:
                raise HTTPException(409, "Idempotency key was already used for a different check-in.")
            response.status_code = 200
            return _sample_response(existing, replayed=True)

        entitlement = session.scalar(select(ClassSampleEntitlement).where(
            ClassSampleEntitlement.id == entitlement_id,
        ).with_for_update())
        if entitlement is None:
            raise HTTPException(404, "Class sample entitlement not found.")
        # A concurrent request may have committed while this request waited for the entitlement lock.
        existing = _find_sample_by_key(session, principal, branch_id, idempotency_key)
        if existing is not None:
            event, replayed = _resolve_sample_checkin_conflict(
                key_event=existing, entitlement_event=None, fingerprint=fingerprint,
            )
            response.status_code = 200
            return _sample_response(event, replayed=replayed)
        purchase = session.execute(select(Order, Payment).join(
            OrderItem, OrderItem.order_id == Order.id).join(
            Payment, Payment.order_id == Order.id).where(OrderItem.id == entitlement.order_item_id)).one_or_none()
        if purchase is None:
            raise PublicDomainError("class_sample_payment_unavailable")
        order, payment = purchase
        if order.branch_id != branch_id:
            raise PublicDomainError("wrong_branch")
        if payment.method == "transfer":
            voucher = session.scalar(select(PaymentReviewEvent.id).where(
                PaymentReviewEvent.payment_id == payment.id,
                PaymentReviewEvent.from_status.is_(None),
                PaymentReviewEvent.to_status == "under_review",
            ).limit(1)) is not None
            if payment.status not in {"under_review", "confirmed"} or (payment.status == "under_review" and not voucher):
                raise PublicDomainError("class_sample_payment_not_received")
        elif payment.status != "confirmed":
            raise PublicDomainError("class_sample_payment_not_received")
        debt = session.scalar(select(MembershipDebt).where(MembershipDebt.order_id == order.id))
        warnings: list[str] = []
        if debt is not None:
            paid = session.scalar(select(func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0)).where(
                MembershipDebtPayment.debt_id == debt.id)) or 0
            if max(debt.initial_outstanding_minor - paid, 0) > 0:
                warnings.append("outstanding_balance")
        if payment.status == "under_review":
            warnings.append("transfer_under_review")

        event = ClassSampleCheckIn(
            entitlement_id=entitlement.id, member_id=entitlement.member_id, branch_id=branch_id,
            recorded_by=principal.staff_id, idempotency_key=idempotency_key,
            request_fingerprint=fingerprint, access_reason="paid_class_sample",
            access_warnings=warnings, occurred_at=utc_now(),
        )
        try:
            with session.begin_nested():
                session.add(event)
                session.flush()
        except IntegrityError:
            key_event = _find_sample_by_key(session, principal, branch_id, idempotency_key)
            entitlement_event = session.scalar(select(ClassSampleCheckIn).where(
                ClassSampleCheckIn.entitlement_id == entitlement.id))
            try:
                existing, replayed = _resolve_sample_checkin_conflict(
                    key_event=key_event, entitlement_event=entitlement_event, fingerprint=fingerprint,
                )
            except HTTPException:
                raise
            if existing is None:
                raise
            response.status_code = 200
            return _sample_response(existing, replayed=replayed)
        return _sample_response(event, replayed=False)


@router.post("/branches/{branch_id}/periods/{period_id}", response_model=MemberCheckInResponse, status_code=201,
             responses={409: {"model": CheckInConflictResponse}, 422: {"model": ValidationErrorResponse}})
def record_member_check_in(
    branch_id: UUID,
    period_id: UUID,
    request: Request,
    response: Response,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128,
                                 pattern=r"^[A-Za-z0-9._:-]+$"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
):
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503, "Database unavailable.")
    fingerprint = sha256(f"{branch_id}\n{period_id}\n{principal.staff_id}".encode()).hexdigest()
    with factory.begin() as session:
        if not principal.is_admin and principal.branch_id != branch_id:
            raise HTTPException(404, "Branch not found.")
        try:
            authorize(session, principal.staff_id, Permission.MEMBER_OPERATIONAL_READ, branch_id)
        except AuthorizationDenied:
            raise HTTPException(403, "Member check-in requires an active scoped Admin or receptionist grant.") from None
        branch = session.get(Branch, branch_id)
        if branch is None or not branch.is_active:
            raise HTTPException(404, "Branch not found.")

        existing = _find_by_key(session, principal, branch_id, idempotency_key)
        if existing is not None:
            if existing.request_fingerprint != fingerprint:
                raise HTTPException(409, "Idempotency key was already used for a different check-in.")
            response.status_code = 200
            return _response(existing, replayed=True)

        period = session.get(MembershipPeriod, period_id)
        if period is None:
            raise HTTPException(404, "Membership period not found.")
        occurred_at = utc_now()
        if occurred_at.tzinfo is None or occurred_at.utcoffset() is None:
            raise HTTPException(500, "Server clock must return a timezone-aware timestamp.")
        occurred_at = occurred_at.astimezone(timezone.utc)
        on_date = occurred_at.astimezone(ZoneInfo(branch.timezone)).date()
        access = evaluate_membership_access(session, period.id, on_date, branch_id)
        if not access.allowed:
            raise PublicDomainError("membership_access_denied", metadata={
                "status": access.status.value,
                "reason": access.reason,
            })

        # Lock the member row so PostgreSQL serializes competing first visits.
        session.scalar(select(Member.id).where(Member.id == period.member_id).with_for_update())
        visit = session.scalar(
            select(MemberCheckInVisit)
            .where(MemberCheckInVisit.member_id == period.member_id)
            .order_by(MemberCheckInVisit.started_at.desc())
            .limit(1)
        )
        if visit is None or (occurred_at - _aware_utc(visit.started_at)).total_seconds() >= 300:
            visit = MemberCheckInVisit(member_id=period.member_id, started_at=occurred_at)
            session.add(visit)
            session.flush()

        event = MemberCheckIn(
            visit_id=visit.id,
            member_id=period.member_id,
            period_id=period.id,
            branch_id=branch_id,
            recorded_by=principal.staff_id,
            idempotency_key=idempotency_key,
            request_fingerprint=fingerprint,
            access_reason=access.reason,
            access_warnings=list(access.warnings),
            occurred_at=occurred_at,
        )
        try:
            with session.begin_nested():
                session.add(event)
                session.flush()
        except IntegrityError:
            existing = _find_by_key(session, principal, branch_id, idempotency_key)
            if existing is None:
                raise
            if existing.request_fingerprint != fingerprint:
                raise HTTPException(409, "Idempotency key was already used for a different check-in.") from None
            response.status_code = 200
            return _response(existing, replayed=True)
        return _response(event, replayed=False)


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
