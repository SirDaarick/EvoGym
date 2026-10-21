"""Administrator controls for payment-related membership access decisions."""
from hashlib import sha256
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.auth.admin import validate_admin_session
from app.auth.sessions import validate_session
from app.db.models import MemberAccessDecision, MembershipPeriod, Order, OrderItem, Payment, PaymentReviewEvent

router = APIRouter(prefix="/api/v1/membership-access", tags=["membership access"])
_bearer = HTTPBearer(auto_error=False)


class AccessDecisionRequest(BaseModel):
    action: str = Field(pattern="^(restrict|restore)$")
    reason: str = Field(min_length=1, max_length=240)


@router.post("/periods/{period_id}/decisions", status_code=201)
def record_access_decision(
    period_id: UUID,
    payload: AccessDecisionRequest,
    request: Request,
    response: Response,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
):
    factory = request.app.state.session_factory
    if factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")
    staff_id = None
    if request.app.state.settings.admin_auth_configured:
        try:
            staff_id, _admin_session_id = validate_admin_session(factory, credentials.credentials)
        except (AuthorizationDenied, ValueError):
            pass
    if staff_id is None:
        try:
            staff_id = validate_session(factory, credentials.credentials, Permission.MEMBER_OPERATIONAL_READ).staff_id
        except (AuthorizationDenied, ValueError):
            raise HTTPException(401, "Authentication failed.") from None
    fingerprint = sha256(f"{period_id}\n{payload.action}\n{payload.reason}\n{staff_id}".encode()).hexdigest()
    with factory.begin() as session:
        row = session.execute(select(MembershipPeriod, Order).join(OrderItem, OrderItem.id == MembershipPeriod.order_item_id)
            .join(Order, Order.id == OrderItem.order_id).where(MembershipPeriod.id == period_id)
            .with_for_update()).one_or_none()
        if row is None:
            raise HTTPException(404, "Membership period not found.")
        period, order = row
        try:
            authorize(session, staff_id, Permission.MEMBERSHIP_ACCESS_MANAGE, order.branch_id)
        except AuthorizationDenied:
            raise HTTPException(403, "Membership access management requires an active scoped administrator grant.") from None
        existing = session.scalar(select(MemberAccessDecision).where(
            MemberAccessDecision.period_id == period_id,
            MemberAccessDecision.idempotency_key == idempotency_key,
        ).with_for_update())
        if existing:
            if existing.request_fingerprint != fingerprint:
                raise HTTPException(409, "Idempotency key was already used for a different decision.")
            response.status_code = 200
            return {"id": str(existing.id), "period_id": str(period_id), "action": existing.action, "reason": existing.reason, "replayed": True}
        lifted_access_decision_id = None
        lifted_payment_review_id = None
        lifted_review_event_count = None
        if payload.action == "restore":
            latest = session.scalar(select(MemberAccessDecision).where(
                MemberAccessDecision.period_id == period_id,
            ).order_by(MemberAccessDecision.decision_order.desc()).limit(1))
            payment = session.scalar(select(Payment).join(Order, Order.id == Payment.order_id)
                .join(OrderItem, OrderItem.order_id == Order.id)
                .where(OrderItem.id == period.order_item_id))
            pending_event = None
            if payment is not None and payment.status == "pending":
                pending_event = session.scalar(select(PaymentReviewEvent).where(
                    PaymentReviewEvent.payment_id == payment.id,
                    PaymentReviewEvent.to_status == "pending",
                ).order_by(PaymentReviewEvent.created_at.desc(), PaymentReviewEvent.id.desc()).limit(1))
            current_review_count = None
            if pending_event is not None:
                current_review_count = session.scalar(select(func.count()).select_from(PaymentReviewEvent).where(
                    PaymentReviewEvent.payment_id == payment.id,
                ))
            if latest is None:
                if pending_event is None:
                    raise HTTPException(409, "There is no active payment restriction to restore.")
            elif latest.action == "restore":
                same_review = (pending_event is not None
                    and latest.lifted_payment_review_id == pending_event.id
                    and latest.lifted_review_event_count == current_review_count)
                if same_review or pending_event is None:
                    raise HTTPException(409, "The current payment restriction was already restored.")
            if pending_event is not None:
                lifted_payment_review_id = pending_event.id
                lifted_review_event_count = current_review_count
            if latest is not None and latest.action == "restrict":
                lifted_access_decision_id = latest.id
        next_order = (session.scalar(select(func.max(MemberAccessDecision.decision_order)).where(
            MemberAccessDecision.period_id == period_id,
        )) or 0) + 1
        decision = MemberAccessDecision(
            period_id=period_id, actor_id=staff_id, action=payload.action, reason=payload.reason,
            idempotency_key=idempotency_key, request_fingerprint=fingerprint,
            decision_order=next_order, lifted_access_decision_id=lifted_access_decision_id,
            lifted_payment_review_id=lifted_payment_review_id, lifted_review_event_count=lifted_review_event_count,
        )
        session.add(decision)
        session.flush()
        return {"id": str(decision.id), "period_id": str(period_id), "action": decision.action, "reason": decision.reason,
                "lifted_payment_review_id": str(lifted_payment_review_id) if lifted_payment_review_id else None, "replayed": False}
