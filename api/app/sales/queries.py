"""Transactional, server-priced membership cash-sale posting."""
from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Branch, CashRegister, Member, MembershipPeriod, Order, OrderItem, Payment,
    MembershipDebt, PaymentReviewEvent, Plan, PlanVersion, Shift,
)

MAX_MINOR = 2**63 - 1


class CashSaleNotFoundError(LookupError):
    """A requested member, register, plan version, or shift is unavailable."""


class CashSaleConflictError(ValueError):
    """A request conflicts with current state or an existing idempotency key."""


class InvalidBranchTimezoneError(ValueError):
    """A branch's stored timezone cannot safely determine its operational date."""


class CashSaleAccessDenied(PermissionError):
    """The locked register is outside the authenticated staff branch."""


@dataclass(frozen=True)
class CashMembershipSaleResult:
    order: Order
    item: OrderItem
    payment: Payment
    membership: MembershipPeriod | None
    replayed: bool


def _add_months(value: date, count: int) -> date:
    absolute_month = value.year * 12 + (value.month - 1) + count
    year, zero_month = divmod(absolute_month, 12)
    month = zero_month + 1
    if not 1 <= year <= 9999:
        raise ValueError("Membership end date exceeds supported calendar range.")
    return date(year, month, min(value.day, monthrange(year, month)[1]))


def _add_duration(value: date, count: int, unit: str) -> date:
    if type(count) is not int or count <= 0:
        raise ValueError("Published membership duration must be a positive integer.")
    try:
        if unit == "day":
            return value + timedelta(days=count)
        if unit == "month":
            return _add_months(value, count)
        if unit == "year":
            target_year = value.year + count
            if target_year > 9999:
                raise ValueError("Membership end date exceeds supported calendar range.")
            return date(target_year, value.month, min(value.day, monthrange(target_year, value.month)[1]))
    except OverflowError as exc:
        raise ValueError("Membership end date exceeds supported calendar range.") from exc
    raise ValueError("Published membership duration unit is unsupported.")


def _fingerprint(
    register_id: UUID,
    member_id: UUID,
    plan_version_id: UUID,
    source_shift_id: UUID | None = None,
    payment_method: str = "cash",
    cash_amount_minor: int | None = None,
    cash_amount_provided: bool = False,
) -> str:
    canonical = f"{register_id}\n{member_id}\n{plan_version_id}"
    if source_shift_id is not None:
        canonical += f"\n{source_shift_id}"
    if payment_method != "cash":
        canonical += f"\n{payment_method}"
    if cash_amount_provided:
        canonical += f"\ncash_amount_minor:{cash_amount_minor}"
    payload = canonical.encode("ascii")
    return sha256(payload).hexdigest()


def _load_result(session: Session, order: Order, replayed: bool) -> CashMembershipSaleResult:
    items = list(order.items)
    if len(items) != 1 or order.payment is None:
        raise RuntimeError("Persisted membership cash sale is incomplete.")
    item = items[0]
    membership = session.scalar(select(MembershipPeriod).where(MembershipPeriod.order_item_id == item.id))
    if order.payment.method == "cash" and membership is None:
        raise RuntimeError("Persisted membership cash sale has no activation period.")
    if order.payment.method == "transfer" and order.payment.status in {"under_review", "confirmed"} and membership is None:
        raise RuntimeError("Voucher-backed membership transfer has no membership period.")
    return CashMembershipSaleResult(order, item, order.payment, membership, replayed)


def post_membership_cash_sale(
    session: Session,
    *,
    register_id: UUID,
    actor_id: UUID,
    authorized_branch_id: UUID | None,
    member_id: UUID,
    plan_version_id: UUID,
    idempotency_key: str,
    source_shift_id: UUID | None = None,
    now: datetime | None = None,
    payment_method: str = "cash",
    cash_amount_minor: int | None = None,
    cash_amount_provided: bool = False,
) -> CashMembershipSaleResult:
    """Persist a cash membership sale or an unsettled transfer atomically.

    The caller owns commit/rollback. Register and member row locks serialize same-drawer
    posting and concurrent renewals; the function never performs external payment I/O.
    """
    if payment_method not in {"cash", "transfer"}:
        raise ValueError("Unsupported membership payment method.")
    if payment_method == "transfer" and cash_amount_provided:
        raise CashSaleConflictError("Partial cash amount is not supported for transfers.")
    if cash_amount_provided and (type(cash_amount_minor) is not int or cash_amount_minor <= 0):
        raise ValueError("Cash amount must be a positive integer number of minor units.")
    if not cash_amount_provided and cash_amount_minor is not None:
        raise ValueError("Cash amount must be explicitly marked as provided.")
    if payment_method == "transfer" and source_shift_id is not None:
        raise CashSaleConflictError("Pending transfers require the current open shift.")
    if not isinstance(idempotency_key, str) or not idempotency_key or len(idempotency_key) > 128:
        raise ValueError("Idempotency key must contain between 1 and 128 characters.")

    register = session.scalar(
        select(CashRegister).where(CashRegister.id == register_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if register is None:
        raise CashSaleNotFoundError("Cash register not found.")
    if authorized_branch_id is not None and register.branch_id != authorized_branch_id:
        raise CashSaleAccessDenied("Access restricted to staff branch.")

    fingerprint = _fingerprint(
        register_id, member_id, plan_version_id, source_shift_id, payment_method,
        cash_amount_minor, cash_amount_provided,
    )
    existing = session.scalar(
        select(Order).where(
            Order.seller_id == actor_id,
            Order.branch_id == register.branch_id,
            Order.idempotency_key == idempotency_key,
        ).with_for_update()
    )
    if existing is not None:
        if existing.request_fingerprint != fingerprint:
            raise CashSaleConflictError("Idempotency key was already used for a different request.")
        return _load_result(session, existing, replayed=True)

    if register.status != "active":
        raise CashSaleConflictError("Cash register is not active.")

    successor = session.scalar(
        select(Shift).where(Shift.cash_register_id == register_id, Shift.status == "open")
        .execution_options(populate_existing=True).with_for_update()
    )
    if source_shift_id is None:
        if successor is None:
            raise CashSaleConflictError("An open shift is required for a cash sale.")
        source_shift = successor
        financial_shift_id = successor.id if payment_method == "cash" else None
        is_overtime = False
    else:
        source_shift = session.scalar(
            select(Shift).where(
                Shift.id == source_shift_id,
                Shift.cash_register_id == register_id,
                Shift.status == "closed",
                Shift.closed_at.is_not(None),
            ).execution_options(populate_existing=True).with_for_update()
        )
        if source_shift is None:
            raise CashSaleConflictError("Overtime source must be a closed shift on this register.")
        predecessor_query = select(Shift.id).where(
            Shift.cash_register_id == register_id,
            Shift.status == "closed",
            Shift.closed_at.is_not(None),
        )
        predecessor_id = session.scalar(
            predecessor_query.order_by(Shift.closed_at.desc(), Shift.id.desc()).limit(1)
        )
        if predecessor_id != source_shift.id:
            raise CashSaleConflictError("Overtime source must be the latest closed shift on this register.")
        financial_shift_id = successor.id if successor is not None else None
        is_overtime = True

    member = session.scalar(
        select(Member).where(Member.id == member_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if member is None:
        raise CashSaleNotFoundError("Member not found.")

    plan_row = session.execute(
        select(PlanVersion, Plan)
        .join(Plan, Plan.id == PlanVersion.plan_id)
        .where(PlanVersion.id == plan_version_id)
        .execution_options(populate_existing=True).with_for_update()
    ).one_or_none()
    if plan_row is None:
        raise CashSaleNotFoundError("Published membership plan version not found.")
    version, plan = plan_row
    if plan.kind != "membership" or plan.status != "active" or not version.is_active:
        raise CashSaleNotFoundError("Published membership plan version not found.")
    if version.currency != "MXN":
        raise CashSaleConflictError("Only MXN membership plans can be sold for cash.")
    if type(version.price_minor) is not int or not 0 <= version.price_minor <= MAX_MINOR:
        raise ValueError("Published membership price is outside signed 64-bit minor units.")
    received_minor = version.price_minor if not cash_amount_provided else cash_amount_minor
    if type(received_minor) is not int or received_minor < 0 or received_minor > version.price_minor:
        raise ValueError("Cash amount must not exceed the published membership price.")

    branch = session.scalar(
        select(Branch).where(Branch.id == register.branch_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if branch is None:
        raise CashSaleNotFoundError("Branch not found.")
    starts_on = ends_on = None
    if payment_method in {"cash", "transfer"}:
        try:
            branch_zone = ZoneInfo(branch.timezone)
        except (ZoneInfoNotFoundError, ValueError, TypeError) as exc:
            raise InvalidBranchTimezoneError("Branch timezone is invalid; membership sale was not posted.") from exc

        effective_at = now or datetime.now(timezone.utc)
        if effective_at.tzinfo is None or effective_at.utcoffset() is None:
            raise ValueError("Sale timestamp must be timezone-aware.")
        local_today = effective_at.astimezone(branch_zone).date()
        latest_period = session.scalar(
            select(MembershipPeriod)
            .where(MembershipPeriod.member_id == member_id, MembershipPeriod.ends_on > local_today)
            .order_by(MembershipPeriod.ends_on.desc(), MembershipPeriod.id.desc())
            .limit(1).with_for_update()
        )
        starts_on = latest_period.ends_on if latest_period is not None else local_today
        ends_on = _add_duration(starts_on, version.duration_value, version.duration_unit)

    order = Order(
        id=uuid4(), branch_id=register.branch_id, register_id=register.id, shift_id=source_shift.id,
        financial_shift_id=financial_shift_id, is_overtime=is_overtime,
        member_id=member.id, seller_id=actor_id, idempotency_key=idempotency_key,
        request_fingerprint=fingerprint, currency="MXN", total_minor=version.price_minor,
    )
    item = OrderItem(
        id=uuid4(), order_id=order.id, plan_version_id=version.id, line_number=1,
        item_kind="membership", description_snapshot=version.name, duration_value=version.duration_value,
        duration_unit=version.duration_unit, quantity=1, unit_amount_minor=version.price_minor,
        line_total_minor=version.price_minor,
    )
    payment = Payment(
        id=uuid4(), order_id=order.id, method=payment_method,
        status="confirmed" if payment_method == "cash" else "under_review",
        amount_minor=received_minor, received_by=actor_id,
    )
    membership = None
    if payment_method in {"cash", "transfer"}:
        membership = MembershipPeriod(
            id=uuid4(), member_id=member.id, order_item_id=item.id, plan_version_id=version.id,
            starts_on=starts_on, ends_on=ends_on, activated_by=actor_id,
        )
    session.add(order)
    session.flush()
    session.add_all([item, payment])
    session.flush()
    if membership is not None:
        session.add(membership)
        session.flush()
    if payment_method == "transfer":
        review_fingerprint = sha256(f"{payment.id}\nunder_review\n{actor_id}".encode("ascii")).hexdigest()
        session.add(PaymentReviewEvent(
            payment_id=payment.id, actor_id=actor_id, from_status=None, to_status="under_review",
            idempotency_key=None, request_fingerprint=review_fingerprint, created_at=datetime.now(timezone.utc),
        ))
        session.flush()
    elif payment_method == "cash" and received_minor < version.price_minor:
        session.add(MembershipDebt(
            id=uuid4(), order_id=order.id, member_id=member.id,
            initial_outstanding_minor=version.price_minor - received_minor,
        ))
        session.flush()
    return CashMembershipSaleResult(order, item, payment, membership, replayed=False)


@dataclass(frozen=True)
class TransferReviewResult:
    order: Order
    item: OrderItem
    payment: Payment
    membership: MembershipPeriod
    replayed: bool


def review_membership_transfer(
    session: Session,
    *,
    payment_id: UUID,
    actor_id: UUID,
    status: str,
    idempotency_key: str,
) -> TransferReviewResult:
    """Append an authorized voucher review decision without changing sold period dates."""
    if status not in {"confirmed", "pending"}:
        raise ValueError("Transfer review status must be confirmed or pending.")
    if not isinstance(idempotency_key, str) or not idempotency_key or len(idempotency_key) > 128:
        raise ValueError("Idempotency key must contain between 1 and 128 characters.")

    observed_payment = session.scalar(select(Payment).where(Payment.id == payment_id))
    if observed_payment is None:
        raise CashSaleNotFoundError("Transfer payment not found.")
    observed_order = session.get(Order, observed_payment.order_id)
    if observed_order is None or observed_payment.method != "transfer":
        raise CashSaleNotFoundError("Transfer payment not found.")

    register = session.scalar(
        select(CashRegister).where(CashRegister.id == observed_order.register_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if register is None:
        raise CashSaleNotFoundError("Cash register not found.")
    member = session.scalar(
        select(Member).where(Member.id == observed_order.member_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if member is None:
        raise CashSaleNotFoundError("Member not found.")
    order = session.scalar(
        select(Order).where(Order.id == observed_order.id)
        .execution_options(populate_existing=True).with_for_update()
    )
    payment = session.scalar(
        select(Payment).where(Payment.id == payment_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    items = list(order.items)
    if len(items) != 1:
        raise CashSaleConflictError("Transfer order has no unambiguous membership item.")
    item = items[0]
    membership = session.scalar(
        select(MembershipPeriod).where(MembershipPeriod.order_item_id == item.id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if membership is None:
        raise CashSaleConflictError("Legacy transfer has no voucher-backed membership period.")
    initial_event = session.scalar(select(PaymentReviewEvent).where(
        PaymentReviewEvent.payment_id == payment.id,
        PaymentReviewEvent.from_status.is_(None),
        PaymentReviewEvent.to_status == "under_review",
    ))
    if initial_event is None:
        raise CashSaleConflictError("Transfer has no voucher review history.")

    fingerprint = sha256(f"{payment.id}\n{status}\n{actor_id}".encode("ascii")).hexdigest()
    prior = session.scalar(select(PaymentReviewEvent).where(
        PaymentReviewEvent.payment_id == payment.id,
        PaymentReviewEvent.idempotency_key == idempotency_key,
    ).with_for_update())
    if prior is not None:
        if prior.request_fingerprint != fingerprint:
            raise CashSaleConflictError("Review idempotency key was already used for a different decision.")
        return TransferReviewResult(order, item, payment, membership, replayed=True)

    if payment.status not in {"under_review", "pending", "confirmed"}:
        raise CashSaleConflictError("Transfer payment cannot be reviewed from its current state.")
    session.add(PaymentReviewEvent(
        payment_id=payment.id, actor_id=actor_id, from_status=payment.status, to_status=status,
        idempotency_key=idempotency_key, request_fingerprint=fingerprint, created_at=datetime.now(timezone.utc),
    ))
    payment.status = status
    session.flush()
    return TransferReviewResult(order, item, payment, membership, replayed=False)
