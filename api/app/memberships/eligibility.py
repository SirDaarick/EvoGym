"""Payment-linked membership-period eligibility; not a check-in endpoint."""
from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import MembershipPeriod, OrderItem, Payment, PaymentReviewEvent


def is_membership_period_eligible(session: Session, period_id: UUID, on_date: date) -> bool:
    """Return whether this specific period is eligible on a branch-local calendar date."""
    row = session.execute(
        select(MembershipPeriod, Payment)
        .join(OrderItem, OrderItem.id == MembershipPeriod.order_item_id)
        .join(Payment, Payment.order_id == OrderItem.order_id)
        .where(MembershipPeriod.id == period_id)
    ).one_or_none()
    if row is None:
        return False
    period, payment = row
    if not (period.starts_on <= on_date < period.ends_on):
        return False
    if payment.method == "cash":
        return payment.status == "confirmed"
    if payment.method != "transfer" or payment.status not in {"under_review", "confirmed"}:
        return False
    return session.scalar(select(PaymentReviewEvent.id).where(
        PaymentReviewEvent.payment_id == payment.id,
        PaymentReviewEvent.from_status.is_(None),
        PaymentReviewEvent.to_status == "under_review",
    ).limit(1)) is not None
