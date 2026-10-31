"""Admin read-only view of unsettled transfers and membership debt."""
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, model_serializer
from sqlalchemy import func, select

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.auth.sessions import validate_session
from app.db.models import (
    Branch, Member, MembershipDebt, MembershipDebtPayment, Order, Payment, PaymentReviewEvent,
    Rental, RentalCharge,
)
from app.rentals.payments import charge_collectable_minor, charges_for_rental, rental_outstanding_minor

router = APIRouter(prefix="/api/v1/admin/pending-money", tags=["finance"])
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class FinancePrincipal:
    staff_id: UUID
    organization_admin: bool
    branch_id: UUID | None


class PendingMoneyItem(BaseModel):
    item_type: str
    branch_id: UUID
    branch_name: str
    member_id: UUID
    member_number: str
    member_name: str
    order_id: UUID | None
    amount_minor: int
    currency: str
    source_event_id: UUID
    source_event_at: datetime
    status: str
    status_event_id: UUID | None
    status_event_at: datetime | None
    initial_amount_minor: int | None = None
    paid_amount_minor: int | None = None
    rental_id: UUID | None = None
    rental_charge_id: UUID | None = None

    @model_serializer(mode="wrap")
    def _strip_unset_rental_fields(self, handler):
        data = handler(self)
        if data.get("rental_id") is None:
            data.pop("rental_id", None)
        if data.get("rental_charge_id") is None:
            data.pop("rental_charge_id", None)
        return data


class PendingMoneyResponse(BaseModel):
    items: list[PendingMoneyItem]
    total_items: int
    total_pending_minor: int


def _principal(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> FinancePrincipal:
    factory = request.app.state.session_factory
    if factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")
    token = credentials.credentials
    try:
        settings = request.app.state.settings
        if not settings.admin_auth_configured or not settings.admin_token_signing_configured:
            raise AuthorizationDenied("Authorization denied")
        staff_id, _session_id = validate_admin_session(
            factory, token, settings.admin_token_signing_secret.get_secret_value()
        )
        return FinancePrincipal(staff_id, organization_admin=True, branch_id=None)
    except (AuthorizationDenied, ValueError):
        pass
    try:
        staff = validate_session(factory, token, Permission.MEMBER_OPERATIONAL_READ)
        return FinancePrincipal(staff.staff_id, organization_admin=False, branch_id=staff.branch_id)
    except (AuthorizationDenied, ValueError):
        raise HTTPException(401, "Authentication failed.") from None


def _authorized_branches(session, principal: FinancePrincipal, requested_branch_id: UUID | None) -> list[Branch]:
    if not principal.organization_admin:
        if requested_branch_id is not None and requested_branch_id != principal.branch_id:
            raise HTTPException(403, "Access restricted to authorized branch.")
        branch_id = principal.branch_id
        try:
            authorize(session, principal.staff_id, Permission.FINANCE_READ, branch_id)
        except AuthorizationDenied:
            raise HTTPException(403, "Finance access denied.") from None
        branch = session.get(Branch, branch_id)
        if branch is None or not branch.is_active:
            raise HTTPException(403, "Finance access denied.")
        return [branch]

    if requested_branch_id is not None:
        try:
            authorize(session, principal.staff_id, Permission.FINANCE_READ, requested_branch_id)
        except AuthorizationDenied:
            raise HTTPException(404, "Branch not found.") from None
        branch = session.get(Branch, requested_branch_id)
        if branch is None or not branch.is_active:
            raise HTTPException(404, "Branch not found.")
        return [branch]

    branches = session.scalars(select(Branch).where(Branch.is_active.is_(True)).order_by(Branch.id)).all()
    authorized = []
    for branch in branches:
        try:
            authorize(session, principal.staff_id, Permission.FINANCE_READ, branch.id)
        except AuthorizationDenied:
            continue
        authorized.append(branch)
    return authorized


@router.get("", response_model=PendingMoneyResponse)
def list_pending_money(
    request: Request,
    branch_id: UUID | None = Query(default=None),
    principal: FinancePrincipal = Depends(_principal),
) -> PendingMoneyResponse:
    """Return unsettled source events; these items are not income or revenue."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503, "Database unavailable.")
    with factory() as session:
        branches = _authorized_branches(session, principal, branch_id)
        if not branches:
            return PendingMoneyResponse(items=[], total_items=0, total_pending_minor=0)
        branch_ids = [branch.id for branch in branches]
        branch_names = {branch.id: branch.name for branch in branches}
        items: list[PendingMoneyItem] = []

        transfer_rows = session.execute(
            select(Payment, Order, Member)
            .join(Order, Payment.order_id == Order.id)
            .join(Member, Order.member_id == Member.id)
            .where(
                Order.branch_id.in_(branch_ids),
                Payment.method == "transfer",
                Payment.status.in_(("under_review", "pending")),
            )
            .order_by(Payment.received_at, Payment.id)
        ).all()
        for payment, order, member in transfer_rows:
            status_event = session.scalar(
                select(PaymentReviewEvent)
                .where(PaymentReviewEvent.payment_id == payment.id)
                .order_by(PaymentReviewEvent.created_at.desc(), PaymentReviewEvent.id.desc())
                .limit(1)
            )
            items.append(PendingMoneyItem(
                item_type="pending_transfer", branch_id=order.branch_id,
                branch_name=branch_names[order.branch_id], member_id=member.id,
                member_number=member.member_number, member_name=member.full_name,
                order_id=order.id, amount_minor=payment.amount_minor, currency=order.currency,
                source_event_id=payment.id, source_event_at=payment.received_at,
                status=payment.status, status_event_id=status_event.id if status_event else None,
                status_event_at=status_event.created_at if status_event else None,
            ))

        debt_rows = session.execute(
            select(MembershipDebt, Order, Member, func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0))
            .join(Order, MembershipDebt.order_id == Order.id)
            .join(Member, MembershipDebt.member_id == Member.id)
            .outerjoin(MembershipDebtPayment, MembershipDebtPayment.debt_id == MembershipDebt.id)
            .where(Order.branch_id.in_(branch_ids))
            .group_by(MembershipDebt.id, Order.id, Member.id)
            .having(MembershipDebt.initial_outstanding_minor > func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0))
            .order_by(MembershipDebt.created_at, MembershipDebt.id)
        ).all()
        for debt, order, member, paid_amount in debt_rows:
            last_payment = session.scalar(
                select(MembershipDebtPayment)
                .where(MembershipDebtPayment.debt_id == debt.id)
                .order_by(MembershipDebtPayment.created_at.desc(), MembershipDebtPayment.id.desc())
                .limit(1)
            )
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

        rental_rows = session.execute(
            select(Rental, Member)
            .join(Member, Rental.member_id == Member.id)
            .where(Rental.branch_id.in_(branch_ids), Rental.status.in_(("active", "returned", "released")))
            .order_by(Rental.created_at, Rental.id)
        ).all()
        for rental, member in rental_rows:
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

        rental_transfers = session.execute(
            select(Payment, Rental, Member)
            .join(RentalCharge, RentalCharge.id == Payment.rental_charge_id)
            .join(Rental, Rental.id == RentalCharge.rental_id)
            .join(Member, Rental.member_id == Member.id)
            .where(
                Rental.branch_id.in_(branch_ids),
                Payment.method == "transfer",
                Payment.status.in_(("under_review", "pending")),
            )
            .order_by(Payment.received_at, Payment.id)
        ).all()
        for payment, rental, member in rental_transfers:
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
            items=items,
            total_items=len(items),
            total_pending_minor=sum(item.amount_minor for item in items),
        )
