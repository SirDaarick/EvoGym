"""Membership access decisions and member / class-sample check-in use cases.

SQL lives in `app.memberships.queries`; HTTP transport lives in `app.api.membership_access` and
`app.api.member_check_ins`. Failures are raised as typed `AppError`s (never HTTPException).
"""
from datetime import datetime, timezone
from hashlib import sha256
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError

from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.db.models import ClassSampleCheckIn, MemberCheckIn
from app.db.models.member_check_ins import MemberCheckInVisit
from app.errors import HttpStatusError, PublicDomainError
from app.memberships import queries as q
from app.memberships.eligibility import MembershipAccessDecision, evaluate_membership_access
from app.memberships.schemas import ClassSampleCheckInResponse, MemberCheckInResponse


class Principal(Protocol):
    staff_id: UUID
    is_admin: bool
    branch_id: UUID | None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# --- access decisions -------------------------------------------------------------------------------

def record_access_decision(factory, staff_id: UUID, period_id: UUID, payload, idempotency_key: str):
    """Returns (body, replayed)."""
    fingerprint = sha256(f"{period_id}\n{payload.action}\n{payload.reason}\n{staff_id}".encode()).hexdigest()
    with factory.begin() as session:
        row = q.lock_period_with_order(session, period_id)
        if row is None:
            raise HttpStatusError(404)
        period, order = row
        try:
            authorize(session, staff_id, Permission.MEMBERSHIP_ACCESS_MANAGE, order.branch_id)
        except AuthorizationDenied:
            raise HttpStatusError(403) from None
        existing = q.find_decision_by_key(session, period_id, idempotency_key)
        if existing:
            if existing.request_fingerprint != fingerprint:
                raise HttpStatusError(409)
            return {"id": str(existing.id), "period_id": str(period_id), "action": existing.action,
                    "reason": existing.reason, "replayed": True}, True
        lifted_access_decision_id = None
        lifted_payment_review_id = None
        lifted_review_event_count = None
        if payload.action == "restore":
            latest = q.latest_decision(session, period_id)
            payment = q.payment_for_order_item(session, period.order_item_id)
            pending_event = None
            if payment is not None and payment.status == "pending":
                pending_event = q.latest_pending_review_event(session, payment.id)
            current_review_count = None
            if pending_event is not None:
                current_review_count = q.review_event_count(session, payment.id)
            if latest is None:
                if pending_event is None:
                    raise HttpStatusError(409)
            elif latest.action == "restore":
                same_review = (pending_event is not None
                    and latest.lifted_payment_review_id == pending_event.id
                    and latest.lifted_review_event_count == current_review_count)
                if same_review or pending_event is None:
                    raise HttpStatusError(409)
            if pending_event is not None:
                lifted_payment_review_id = pending_event.id
                lifted_review_event_count = current_review_count
            if latest is not None and latest.action == "restrict":
                lifted_access_decision_id = latest.id
        decision = q.add_decision(
            session, period_id=period_id, actor_id=staff_id, action=payload.action, reason=payload.reason,
            idempotency_key=idempotency_key, request_fingerprint=fingerprint,
            decision_order=q.next_decision_order(session, period_id),
            lifted_access_decision_id=lifted_access_decision_id,
            lifted_payment_review_id=lifted_payment_review_id, lifted_review_event_count=lifted_review_event_count,
        )
        return {"id": str(decision.id), "period_id": str(period_id), "action": decision.action, "reason": decision.reason,
                "lifted_payment_review_id": str(lifted_payment_review_id) if lifted_payment_review_id else None,
                "replayed": False}, False


# --- check-ins --------------------------------------------------------------------------------------

def _response(event: MemberCheckIn, *, replayed: bool) -> MemberCheckInResponse:
    return MemberCheckInResponse(
        id=event.id, visit_id=event.visit_id, member_id=event.member_id, period_id=event.period_id,
        branch_id=event.branch_id, recorded_by=event.recorded_by, occurred_at=_aware_utc(event.occurred_at),
        access_reason=event.access_reason, access_warnings=event.access_warnings, replayed=replayed,
    )


def _sample_response(event: ClassSampleCheckIn, *, replayed: bool) -> ClassSampleCheckInResponse:
    return ClassSampleCheckInResponse(
        id=event.id, entitlement_id=event.entitlement_id, member_id=event.member_id,
        branch_id=event.branch_id, recorded_by=event.recorded_by,
        occurred_at=_aware_utc(event.occurred_at), access_reason=event.access_reason,
        access_warnings=event.access_warnings, replayed=replayed,
    )


def _resolve_sample_checkin_conflict(*, key_event, entitlement_event, fingerprint: str):
    """Prefer an exact retry over the consumed-entitlement conflict."""
    if key_event is not None:
        if key_event.request_fingerprint != fingerprint:
            raise HttpStatusError(409)
        return key_event, True
    if entitlement_event is not None:
        raise PublicDomainError("class_sample_already_used")
    return None, False


def _open_branch(session, principal: Principal, branch_id: UUID):
    """Branch-scope, grant and active-branch checks shared by both check-in kinds."""
    if not principal.is_admin and principal.branch_id != branch_id:
        raise HttpStatusError(404)
    try:
        authorize(session, principal.staff_id, Permission.MEMBER_OPERATIONAL_READ, branch_id)
    except AuthorizationDenied:
        raise HttpStatusError(403) from None
    branch = q.get_branch(session, branch_id)
    if branch is None or not branch.is_active:
        raise HttpStatusError(404)
    return branch


def record_class_sample_check_in(factory, principal: Principal, branch_id: UUID, entitlement_id: UUID,
                                 idempotency_key: str) -> ClassSampleCheckInResponse:
    """Replays carry `replayed=True` (the router answers 200 for those)."""
    if factory is None:
        raise HttpStatusError(503)
    fingerprint = sha256(f"class-sample\n{branch_id}\n{entitlement_id}\n{principal.staff_id}".encode()).hexdigest()
    with factory.begin() as session:
        _open_branch(session, principal, branch_id)
        existing = q.find_sample_by_key(session, principal.staff_id, branch_id, idempotency_key)
        if existing is not None:
            if existing.request_fingerprint != fingerprint:
                raise HttpStatusError(409)
            return _sample_response(existing, replayed=True)

        entitlement = q.lock_entitlement(session, entitlement_id)
        if entitlement is None:
            raise HttpStatusError(404)
        # A concurrent request may have committed while this request waited for the entitlement lock.
        existing = q.find_sample_by_key(session, principal.staff_id, branch_id, idempotency_key)
        if existing is not None:
            event, replayed = _resolve_sample_checkin_conflict(
                key_event=existing, entitlement_event=None, fingerprint=fingerprint,
            )
            return _sample_response(event, replayed=replayed)
        purchase = q.sample_purchase(session, entitlement.order_item_id)
        if purchase is None:
            raise PublicDomainError("class_sample_payment_unavailable")
        order, payment = purchase
        if order.branch_id != branch_id:
            raise PublicDomainError("wrong_branch")
        if payment.method == "transfer":
            voucher = q.has_transfer_voucher(session, payment.id)
            if payment.status not in {"under_review", "confirmed"} or (payment.status == "under_review" and not voucher):
                raise PublicDomainError("class_sample_payment_not_received")
        elif payment.status != "confirmed":
            raise PublicDomainError("class_sample_payment_not_received")
        warnings: list[str] = []
        if q.has_outstanding_debt(session, order.id):
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
            q.insert_flushed(session, event)
        except IntegrityError:
            key_event = q.find_sample_by_key(session, principal.staff_id, branch_id, idempotency_key)
            entitlement_event = q.sample_event_for_entitlement(session, entitlement.id)
            existing, replayed = _resolve_sample_checkin_conflict(
                key_event=key_event, entitlement_event=entitlement_event, fingerprint=fingerprint,
            )
            if existing is None:
                raise
            return _sample_response(existing, replayed=replayed)
        return _sample_response(event, replayed=False)


VISIT_WINDOW_SECONDS = 300


@dataclass(frozen=True)
class CheckInApplyResult:
    check_in: MemberCheckIn
    visit: MemberCheckInVisit
    replayed: bool
    access_decision: MembershipAccessDecision | None  # None on an idempotent replay
    linked_to_existing_visit: bool


def apply_member_check_in(session, *, branch_id: UUID, period_id: UUID, actor_id: UUID, occurred_at: datetime,
                          idempotency_key: str, request_fingerprint: str,
                          enforce_access: bool = True, confirm_outstanding_balance: bool = False) -> CheckInApplyResult:
    """Session-level check-in shared by the online endpoint and offline reconciliation.

    Visits are fixed 5-minute windows anchored to `visit.started_at` (>= 300 s starts a new one), looked
    up from `occurred_at`, so late-arriving events join the right visit. With `enforce_access=False` a
    denial is recorded (reason + `access_denied:<status>` warning) and reported instead of raised.
    """
    occurred_at = _aware_utc(occurred_at)
    existing = q.find_check_in_by_key(session, actor_id, branch_id, idempotency_key)
    if existing is not None:
        if existing.request_fingerprint != request_fingerprint:
            raise HttpStatusError(409)
        visit = session.get(MemberCheckInVisit, existing.visit_id)
        return CheckInApplyResult(existing, visit, True, None, True)

    period = q.get_period(session, period_id)
    if period is None:
        raise HttpStatusError(404)
    branch = q.get_branch(session, branch_id)
    on_date = occurred_at.astimezone(ZoneInfo(branch.timezone)).date()
    access = evaluate_membership_access(session, period.id, on_date, branch_id)
    warnings = list(access.warnings)
    if not access.allowed:
        if enforce_access:
            raise PublicDomainError("membership_access_denied", metadata={
                "status": access.status.value,
                "reason": access.reason,
            })
        warnings.append(f"access_denied:{access.status.value}")

    from app.members.queries import get_member_pending_balance_minor
    if access.allowed and get_member_pending_balance_minor(session, period.member_id) > 0:
        if "outstanding_balance" not in warnings:
            warnings.append("outstanding_balance")
        if enforce_access and not confirm_outstanding_balance:
            raise PublicDomainError("debt_confirmation_required")
    if confirm_outstanding_balance:
        warnings.append("outstanding_balance_confirmed")

    # Visits within 5 minutes of the visit that covers `occurred_at` share it; the member row is locked first.
    visit = q.visit_at_or_before(session, period.member_id, occurred_at)
    linked = visit is not None and (occurred_at - _aware_utc(visit.started_at)).total_seconds() < VISIT_WINDOW_SECONDS
    if not linked:
        visit = q.add_visit(session, period.member_id, occurred_at)

    event = MemberCheckIn(
        visit_id=visit.id,
        member_id=period.member_id,
        period_id=period.id,
        branch_id=branch_id,
        recorded_by=actor_id,
        idempotency_key=idempotency_key,
        request_fingerprint=request_fingerprint,
        access_reason=access.reason,
        access_warnings=warnings,
        occurred_at=occurred_at,
    )
    try:
        q.insert_flushed(session, event)
    except IntegrityError:
        existing = q.find_check_in_by_key(session, actor_id, branch_id, idempotency_key)
        if existing is None:
            raise
        if existing.request_fingerprint != request_fingerprint:
            raise HttpStatusError(409) from None
        return CheckInApplyResult(existing, session.get(MemberCheckInVisit, existing.visit_id), True, None, True)
    return CheckInApplyResult(event, visit, False, access, linked)


def record_member_check_in(factory, principal: Principal, branch_id: UUID, period_id: UUID,
                           idempotency_key: str, confirm_outstanding_balance: bool = False) -> MemberCheckInResponse:
    """Replays carry `replayed=True` (the router answers 200 for those)."""
    if factory is None:
        raise HttpStatusError(503)
    fingerprint_text = f"{branch_id}\n{period_id}\n{principal.staff_id}"
    if confirm_outstanding_balance:
        fingerprint_text += "\nconfirmed"
    fingerprint = sha256(fingerprint_text.encode()).hexdigest()
    with factory.begin() as session:
        _open_branch(session, principal, branch_id)
        # Replays must not read the clock (keeps the online time source untouched for them).
        existing = q.find_check_in_by_key(session, principal.staff_id, branch_id, idempotency_key)
        if existing is not None:
            if existing.request_fingerprint != fingerprint:
                raise HttpStatusError(409)
            return _response(existing, replayed=True)
        result = apply_member_check_in(
            session, branch_id=branch_id, period_id=period_id, actor_id=principal.staff_id,
            occurred_at=utc_now(), idempotency_key=idempotency_key, request_fingerprint=fingerprint,
            confirm_outstanding_balance=confirm_outstanding_balance,
        )
        return _response(result.check_in, replayed=result.replayed)
