"""Branch-scoped membership entitlement evaluation; not a check-in endpoint."""
from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    MemberAccessDecision, MembershipDebt, MembershipDebtPayment, MembershipPeriod,
    Order, OrderItem, Payment, PaymentReviewEvent,
)


class MembershipAccessStatus(StrEnum):
    ALLOWED = "allowed"
    BLOCKED_MISSING_FUNDS = "blocked_missing_funds"
    WRONG_BRANCH = "wrong_branch"
    EXPIRED = "expired"
    NOT_YET_VALID = "not_yet_valid"
    NOT_FOUND = "not_found"


@dataclass(frozen=True)
class MembershipAccessDecision:
    allowed: bool
    status: MembershipAccessStatus
    reason: str
    warnings: tuple[str, ...] = ()
    outstanding_minor: int = 0


def evaluate_membership_access(
    session: Session | None, period_id: UUID, on_date: date, branch_id: UUID,
) -> MembershipAccessDecision:
    if session is None:
        return MembershipAccessDecision(False, MembershipAccessStatus.NOT_FOUND, "membership_not_found")
    row = session.execute(
        select(MembershipPeriod, Payment, Order, OrderItem)
        .join(OrderItem, OrderItem.id == MembershipPeriod.order_item_id)
        .join(Order, Order.id == OrderItem.order_id)
        .join(Payment, Payment.order_id == Order.id)
        .where(MembershipPeriod.id == period_id)
    ).one_or_none()
    if row is None:
        return MembershipAccessDecision(False, MembershipAccessStatus.NOT_FOUND, "membership_not_found")
    period, payment, order, item = row
    if order.branch_id != branch_id:
        return MembershipAccessDecision(False, MembershipAccessStatus.WRONG_BRANCH, "wrong_branch")
    if on_date >= period.ends_on:
        return MembershipAccessDecision(False, MembershipAccessStatus.EXPIRED, "period_expired")
    if on_date < period.starts_on:
        return MembershipAccessDecision(False, MembershipAccessStatus.NOT_YET_VALID, "period_not_started")

    debt = session.scalar(select(MembershipDebt).where(MembershipDebt.order_id == order.id))
    outstanding = 0
    if debt is not None:
        paid = session.scalar(select(func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0)).where(
            MembershipDebtPayment.debt_id == debt.id,
        )) or 0
        outstanding = max(debt.initial_outstanding_minor - paid, 0)

    latest = session.scalar(select(MemberAccessDecision).where(
        MemberAccessDecision.period_id == period.id,
    ).order_by(MemberAccessDecision.decision_order.desc()).limit(1))
    warnings = ("outstanding_balance",) if outstanding else ()
    if payment.method == "transfer":
        voucher = session.scalar(select(PaymentReviewEvent.id).where(
            PaymentReviewEvent.payment_id == payment.id,
            PaymentReviewEvent.from_status.is_(None),
            PaymentReviewEvent.to_status == "under_review",
        ).limit(1)) is not None
        if not voucher or payment.status not in {"under_review", "confirmed", "pending"}:
            return MembershipAccessDecision(False, MembershipAccessStatus.BLOCKED_MISSING_FUNDS, "transfer_not_received", warnings, outstanding)
        payment_blocked = payment.status == "pending"
    else:
        payment_blocked = False

    if payment_blocked and outstanding == 0 and debt is not None:
        payment_blocked = False
    if payment_blocked and latest is not None and latest.action == "restore":
        if latest.lifted_payment_review_id is not None:
            current_review_count = session.scalar(select(func.count()).select_from(PaymentReviewEvent).where(
                PaymentReviewEvent.payment_id == payment.id,
            )) or 0
            payment_blocked = not (
                latest.lifted_payment_review_id is not None
                and latest.lifted_review_event_count == current_review_count
                and session.scalar(select(PaymentReviewEvent.id).where(
                    PaymentReviewEvent.id == latest.lifted_payment_review_id,
                    PaymentReviewEvent.to_status == "pending",
                )) is not None
            )
        else:
            payment_blocked = True
    if payment_blocked:
        return MembershipAccessDecision(False, MembershipAccessStatus.BLOCKED_MISSING_FUNDS, "transfer_missing_funds", warnings, outstanding)
    if latest is not None and latest.action == "restrict" and (
        outstanding > 0 or (payment.method == "transfer" and payment.status != "confirmed")
    ):
        return MembershipAccessDecision(False, MembershipAccessStatus.BLOCKED_MISSING_FUNDS, "admin_payment_restriction", warnings, outstanding)
    if latest is not None and latest.action == "restore" and latest.lifted_access_decision_id is not None:
        # A restore only lifts the exact restriction it observed at write time.
        if latest.lifted_access_decision_id != session.scalar(select(MemberAccessDecision.id).where(
            MemberAccessDecision.id == latest.lifted_access_decision_id,
            MemberAccessDecision.period_id == period.id,
            MemberAccessDecision.decision_order < latest.decision_order,
            MemberAccessDecision.action == "restrict",
        )):
            return MembershipAccessDecision(False, MembershipAccessStatus.BLOCKED_MISSING_FUNDS, "admin_payment_restriction", warnings, outstanding)
    if outstanding:
        return MembershipAccessDecision(True, MembershipAccessStatus.ALLOWED, "valid_with_outstanding_balance", warnings, outstanding)
    if payment.status == "under_review":
        warnings += ("transfer_under_review",)
    return MembershipAccessDecision(True, MembershipAccessStatus.ALLOWED, "valid", warnings, outstanding)


def is_membership_period_eligible(session: Session, period_id: UUID, on_date: date) -> bool:
    """Compatibility boolean for existing callers; entitlement callers should inspect the decision."""
    row = session.execute(select(Order.branch_id).join(OrderItem, OrderItem.order_id == Order.id)
        .join(MembershipPeriod, MembershipPeriod.order_item_id == OrderItem.id)
        .where(MembershipPeriod.id == period_id)).one_or_none()
    if row is None:
        return False
    return evaluate_membership_access(session, period_id, on_date, row.branch_id).allowed
