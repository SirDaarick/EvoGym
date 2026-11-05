"""SQL for membership access decisions and member/class-sample check-ins."""
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (Branch, ClassSampleCheckIn, ClassSampleEntitlement, Member, MemberAccessDecision,
                           MemberCheckIn, MembershipDebt, MembershipDebtPayment, MembershipPeriod, Order,
                           OrderItem, Payment, PaymentReviewEvent)
from app.db.models.member_check_ins import MemberCheckInVisit


def insert_flushed(session: Session, obj) -> None:
    """Insert in a savepoint so a unique-key IntegrityError leaves the outer transaction usable."""
    with session.begin_nested():
        session.add(obj)
        session.flush()


# --- access decisions -------------------------------------------------------------------------------

def lock_period_with_order(session: Session, period_id: UUID):
    return session.execute(select(MembershipPeriod, Order).join(OrderItem, OrderItem.id == MembershipPeriod.order_item_id)
        .join(Order, Order.id == OrderItem.order_id).where(MembershipPeriod.id == period_id)
        .with_for_update()).one_or_none()


def find_decision_by_key(session: Session, period_id: UUID, key: str):
    return session.scalar(select(MemberAccessDecision).where(
        MemberAccessDecision.period_id == period_id,
        MemberAccessDecision.idempotency_key == key,
    ).with_for_update())


def latest_decision(session: Session, period_id: UUID):
    return session.scalar(select(MemberAccessDecision).where(
        MemberAccessDecision.period_id == period_id,
    ).order_by(MemberAccessDecision.decision_order.desc()).limit(1))


def payment_for_order_item(session: Session, order_item_id: UUID):
    return session.scalar(select(Payment).join(Order, Order.id == Payment.order_id)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .where(OrderItem.id == order_item_id))


def latest_pending_review_event(session: Session, payment_id: UUID):
    return session.scalar(select(PaymentReviewEvent).where(
        PaymentReviewEvent.payment_id == payment_id,
        PaymentReviewEvent.to_status == "pending",
    ).order_by(PaymentReviewEvent.created_at.desc(), PaymentReviewEvent.id.desc()).limit(1))


def review_event_count(session: Session, payment_id: UUID):
    return session.scalar(select(func.count()).select_from(PaymentReviewEvent).where(
        PaymentReviewEvent.payment_id == payment_id,
    ))


def next_decision_order(session: Session, period_id: UUID) -> int:
    return (session.scalar(select(func.max(MemberAccessDecision.decision_order)).where(
        MemberAccessDecision.period_id == period_id,
    )) or 0) + 1


def add_decision(session: Session, **fields) -> MemberAccessDecision:
    decision = MemberAccessDecision(**fields)
    session.add(decision)
    session.flush()
    return decision


# --- check-ins --------------------------------------------------------------------------------------

def get_branch(session: Session, branch_id: UUID):
    return session.get(Branch, branch_id)


def find_check_in_by_key(session: Session, staff_id: UUID, branch_id: UUID, key: str):
    return session.scalar(select(MemberCheckIn).where(
        MemberCheckIn.branch_id == branch_id,
        MemberCheckIn.recorded_by == staff_id,
        MemberCheckIn.idempotency_key == key,
    ).with_for_update())


def find_sample_by_key(session: Session, staff_id: UUID, branch_id: UUID, key: str):
    return session.scalar(select(ClassSampleCheckIn).where(
        ClassSampleCheckIn.branch_id == branch_id,
        ClassSampleCheckIn.recorded_by == staff_id,
        ClassSampleCheckIn.idempotency_key == key,
    ).with_for_update())


def lock_entitlement(session: Session, entitlement_id: UUID):
    return session.scalar(select(ClassSampleEntitlement).where(
        ClassSampleEntitlement.id == entitlement_id,
    ).with_for_update())


def sample_purchase(session: Session, order_item_id: UUID):
    return session.execute(select(Order, Payment).join(
        OrderItem, OrderItem.order_id == Order.id).join(
        Payment, Payment.order_id == Order.id).where(OrderItem.id == order_item_id)).one_or_none()


def has_transfer_voucher(session: Session, payment_id: UUID) -> bool:
    return session.scalar(select(PaymentReviewEvent.id).where(
        PaymentReviewEvent.payment_id == payment_id,
        PaymentReviewEvent.from_status.is_(None),
        PaymentReviewEvent.to_status == "under_review",
    ).limit(1)) is not None


def has_outstanding_debt(session: Session, order_id: UUID) -> bool:
    debt = session.scalar(select(MembershipDebt).where(MembershipDebt.order_id == order_id))
    if debt is None:
        return False
    paid = session.scalar(select(func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0)).where(
        MembershipDebtPayment.debt_id == debt.id)) or 0
    return max(debt.initial_outstanding_minor - paid, 0) > 0


def sample_event_for_entitlement(session: Session, entitlement_id: UUID):
    return session.scalar(select(ClassSampleCheckIn).where(ClassSampleCheckIn.entitlement_id == entitlement_id))


def get_period(session: Session, period_id: UUID):
    return session.get(MembershipPeriod, period_id)


def latest_visit(session: Session, member_id: UUID):
    """Lock the member row (serializes competing first visits on PostgreSQL), then read its latest visit."""
    session.scalar(select(Member.id).where(Member.id == member_id).with_for_update())
    return session.scalar(
        select(MemberCheckInVisit)
        .where(MemberCheckInVisit.member_id == member_id)
        .order_by(MemberCheckInVisit.started_at.desc())
        .limit(1)
    )


def visit_at_or_before(session: Session, member_id: UUID, occurred_at):
    """Lock the member row, then read the latest visit that started at or before `occurred_at`."""
    session.scalar(select(Member.id).where(Member.id == member_id).with_for_update())
    return session.scalar(
        select(MemberCheckInVisit)
        .where(MemberCheckInVisit.member_id == member_id, MemberCheckInVisit.started_at <= occurred_at)
        .order_by(MemberCheckInVisit.started_at.desc())
        .limit(1)
    )


def add_visit(session: Session, member_id: UUID, started_at) -> MemberCheckInVisit:
    visit = MemberCheckInVisit(member_id=member_id, started_at=started_at)
    session.add(visit)
    session.flush()
    return visit
