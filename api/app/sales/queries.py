"""Transactional, server-priced membership cash-sale posting."""
from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Branch, CashRegister, Member, MembershipPeriod, Order, OrderItem, Payment, Plan, PlanVersion, Shift

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
) -> str:
    canonical = f"{register_id}\n{member_id}\n{plan_version_id}"
    if source_shift_id is not None:
        canonical += f"\n{source_shift_id}"
    if payment_method != "cash":
        canonical += f"\n{payment_method}"
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
    if order.payment.method == "transfer" and membership is not None:
        raise RuntimeError("Pending membership transfer unexpectedly has an activation period.")
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
) -> CashMembershipSaleResult:
    """Persist a cash membership sale or an unsettled transfer atomically.

    The caller owns commit/rollback. Register and member row locks serialize same-drawer
    posting and concurrent renewals; the function never performs external payment I/O.
    """
    if payment_method not in {"cash", "transfer"}:
        raise ValueError("Unsupported membership payment method.")
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

    fingerprint = _fingerprint(register_id, member_id, plan_version_id, source_shift_id, payment_method)
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

    branch = session.scalar(
        select(Branch).where(Branch.id == register.branch_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    if branch is None:
        raise CashSaleNotFoundError("Branch not found.")
    starts_on = ends_on = None
    if payment_method == "cash":
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
        status="confirmed" if payment_method == "cash" else "pending",
        amount_minor=version.price_minor, received_by=actor_id,
    )
    membership = None
    if payment_method == "cash":
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
    return CashMembershipSaleResult(order, item, payment, membership, replayed=False)
