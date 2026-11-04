"""Finance use cases: finance branch scope, the pending-money projection and weekly payroll.

SQL lives in `app.finance.queries`; HTTP transport in `app.api.pending_money` / `app.api.payroll`. Failures
are `HttpStatusError`s. Pending money is unsettled source events, never revenue. `factory` is the session
factory (None -> 503 where the router passes the raw one).
"""
import hashlib

from sqlalchemy.exc import IntegrityError

from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.db.models import Expense, PayrollAdvance, PayrollPayment
from app.errors import HttpStatusError
from app.finance import queries as q
from app.finance.schemas import PendingMoneyItem, PendingMoneyResponse
from app.rentals.payments import (
    charge_collectable_minor, charges_for_rental, clean_idempotency_key, fingerprint,
)
from app.errors import session_factory
from app.staff.roster import weekly_base


def authorized_branches(session, principal, requested_branch_id):
    """Branches the finance principal may read; branch-scoped staff get 403, admins 404 for a bad branch."""
    if not principal.organization_admin:
        if requested_branch_id is not None and requested_branch_id != principal.branch_id:
            raise HttpStatusError(403)
        branch_id = principal.branch_id
        try:
            authorize(session, principal.staff_id, Permission.FINANCE_READ, branch_id)
        except AuthorizationDenied:
            raise HttpStatusError(403) from None
        branch = q.get_branch(session, branch_id)
        if branch is None or not branch.is_active:
            raise HttpStatusError(403)
        return [branch]

    if requested_branch_id is not None:
        try:
            authorize(session, principal.staff_id, Permission.FINANCE_READ, requested_branch_id)
        except AuthorizationDenied:
            raise HttpStatusError(404) from None
        branch = q.get_branch(session, requested_branch_id)
        if branch is None or not branch.is_active:
            raise HttpStatusError(404)
        return [branch]

    authorized = []
    for branch in q.active_branches(session):
        try:
            authorize(session, principal.staff_id, Permission.FINANCE_READ, branch.id)
        except AuthorizationDenied:
            continue
        authorized.append(branch)
    return authorized


# --- pending money ---------------------------------------------------------------------------

def list_pending_money(factory, principal, branch_id) -> PendingMoneyResponse:
    with session_factory(factory)() as session:
        branches = authorized_branches(session, principal, branch_id)
        if not branches:
            return PendingMoneyResponse(items=[], total_items=0, total_pending_minor=0)
        branch_ids = [branch.id for branch in branches]
        branch_names = {branch.id: branch.name for branch in branches}
        items: list[PendingMoneyItem] = []

        for payment, order, member in q.pending_order_transfers(session, branch_ids):
            status_event = q.latest_review_event(session, payment.id)
            items.append(PendingMoneyItem(
                item_type="pending_transfer", branch_id=order.branch_id,
                branch_name=branch_names[order.branch_id], member_id=member.id,
                member_number=member.member_number, member_name=member.full_name,
                order_id=order.id, amount_minor=payment.amount_minor, currency=order.currency,
                source_event_id=payment.id, source_event_at=payment.received_at,
                status=payment.status, status_event_id=status_event.id if status_event else None,
                status_event_at=status_event.created_at if status_event else None,
            ))

        for debt, order, member, paid_amount in q.open_debts(session, branch_ids):
            last_payment = q.last_debt_payment(session, debt.id)
            items.append(PendingMoneyItem(
                item_type="membership_debt", branch_id=order.branch_id,
                branch_name=branch_names[order.branch_id], member_id=member.id,
                member_number=member.member_number, member_name=member.full_name,
                order_id=order.id,
                amount_minor=debt.initial_outstanding_minor - paid_amount,
                currency=order.currency, source_event_id=debt.id,
                source_event_at=debt.created_at, status="outstanding",
                status_event_id=last_payment.id if last_payment else None,
                status_event_at=last_payment.created_at if last_payment else None,
                initial_amount_minor=debt.initial_outstanding_minor,
                paid_amount_minor=paid_amount,
            ))

        for rental, member in q.billable_rentals(session, branch_ids):
            charges = charges_for_rental(session, rental.id)
            collectable = sum(charge_collectable_minor(session, charge) for charge in charges)
            if collectable <= 0:
                continue
            initial = sum(charge.amount_minor for charge in charges)
            items.append(PendingMoneyItem(
                item_type="rental_receivable", branch_id=rental.branch_id,
                branch_name=branch_names[rental.branch_id], member_id=member.id,
                member_number=member.member_number, member_name=member.full_name,
                order_id=None, rental_id=rental.id,
                amount_minor=collectable, currency="MXN",
                source_event_id=charges[-1].id if charges else rental.id,
                source_event_at=charges[-1].created_at if charges else rental.created_at,
                status="outstanding", status_event_id=None, status_event_at=None,
                initial_amount_minor=initial, paid_amount_minor=initial - collectable,
            ))

        for payment, rental, member in q.pending_rental_transfers(session, branch_ids):
            items.append(PendingMoneyItem(
                item_type="pending_transfer", branch_id=rental.branch_id,
                branch_name=branch_names[rental.branch_id], member_id=member.id,
                member_number=member.member_number, member_name=member.full_name,
                order_id=None, rental_id=rental.id, rental_charge_id=payment.rental_charge_id,
                amount_minor=payment.amount_minor, currency="MXN",
                source_event_id=payment.id, source_event_at=payment.received_at,
                status=payment.status, status_event_id=None, status_event_at=None,
            ))

        items.sort(key=lambda item: (item.source_event_at, str(item.source_event_id)))
        return PendingMoneyResponse(
            items=items, total_items=len(items), total_pending_minor=sum(item.amount_minor for item in items),
        )


# --- payroll ---------------------------------------------------------------------------------

def _authorize(session, principal, branch_id):
    if not principal.organization_admin:
        raise HttpStatusError(403)
    try:
        authorized_branches(session, principal, branch_id)
    except HttpStatusError as exc:
        if exc.status in (403, 404):
            raise HttpStatusError(403) from None
        raise


def _profile(session, payload):
    profile = q.lock_profile(session, payload.staff_profile_id, payload.branch_id)
    if profile is None or not profile.is_active or profile.monthly_salary_minor <= 0:
        raise HttpStatusError(422)
    return profile


def _amounts(session, profile, week):
    return weekly_base(profile.monthly_salary_minor), int(q.advances_total(session, profile.id, week))


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
    except ValueError:
        raise HttpStatusError(422) from None
    return key


def _expense(session, payload, profile, principal, key, request_hash, amount, method, kind):
    # Namespace the linked expense key independently from user-created expenses.
    expense_key = "payroll-" + hashlib.sha256(f"{kind}:{key}".encode()).hexdigest()
    return q.add(session, Expense(
        branch_id=payload.branch_id, shift_id=None, category="general",
        concept="Adelanto de nómina" if kind == "advance" else "Nómina semanal",
        payee_name=profile.full_name, amount_minor=amount, payment_method=method,
        recorded_by_id=principal.staff_id, idempotency_key=expense_key, request_fingerprint=request_hash)).id


def payroll_week(factory, principal, branch_id, week_start):
    if week_start.weekday() != 0:
        raise HttpStatusError(422)
    with factory.begin() as session:
        _authorize(session, principal, branch_id)
        items = []
        for profile in q.payroll_profiles(session, branch_id):
            payment = q.week_payment(session, profile.id, week_start)
            base, advances = (payment.base_minor, payment.advances_minor) if payment else _amounts(session, profile, week_start)
            items.append({"profile_id": str(profile.id), "full_name": profile.full_name,
                "base_minor": base, "advances_minor": advances, "net_minor": base - advances,
                "daily_minor": (base + 2) // 5,
                "paid": {"payment_method": payment.payment_method, "paid_at": payment.created_at.isoformat()} if payment else None})
        return {"items": items, "base_minor": sum(row["base_minor"] for row in items),
                "advances_minor": sum(row["advances_minor"] for row in items), "net_minor": sum(row["net_minor"] for row in items)}


def record_advance(factory, principal, payload, key):
    key = _key(key)
    request_hash = fingerprint(payload.model_dump(mode="json"))
    try:
        with factory.begin() as session:
            _authorize(session, principal, payload.branch_id)
            prior = q.prior_by_key(session, PayrollAdvance, branch_id=payload.branch_id,
                                   staff_id=principal.staff_id, key=key)
            if prior:
                if prior.request_fingerprint != request_hash:
                    raise HttpStatusError(409)
                return _dto(prior)
            profile = _profile(session, payload)
            if q.week_payment(session, profile.id, payload.week_start):
                raise HttpStatusError(409)
            base, advances = _amounts(session, profile, payload.week_start)
            if payload.amount_minor > base - advances:
                raise HttpStatusError(422)
            expense_id = _expense(session, payload, profile, principal, key, request_hash, payload.amount_minor, "transfer", "advance")
            return _dto(q.add(session, PayrollAdvance(
                **payload.model_dump(), expense_id=expense_id, recorded_by_id=principal.staff_id,
                idempotency_key=key, request_fingerprint=request_hash)))
    except IntegrityError:
        raise HttpStatusError(409) from None


def pay_week(factory, principal, payload, key):
    key = _key(key)
    request_hash = fingerprint(payload.model_dump(mode="json"))
    try:
        with factory.begin() as session:
            _authorize(session, principal, payload.branch_id)
            prior = q.prior_by_key(session, PayrollPayment, branch_id=payload.branch_id,
                                   staff_id=principal.staff_id, key=key)
            if prior:
                if prior.request_fingerprint != request_hash:
                    raise HttpStatusError(409)
                return _dto(prior)
            profile = _profile(session, payload)
            if q.week_payment(session, profile.id, payload.week_start):
                raise HttpStatusError(409)
            base, advances = _amounts(session, profile, payload.week_start)
            net = base - advances
            if net < 0:
                raise HttpStatusError(409)
            expense_id = _expense(session, payload, profile, principal, key, request_hash, net, payload.payment_method, "payment") if net else None
            return _dto(q.add(session, PayrollPayment(
                **payload.model_dump(), base_minor=base, advances_minor=advances, net_minor=net,
                expense_id=expense_id, recorded_by_id=principal.staff_id,
                idempotency_key=key, request_fingerprint=request_hash)))
    except IntegrityError:
        raise HttpStatusError(409) from None
