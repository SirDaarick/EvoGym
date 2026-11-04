"""Member reloadable read endpoints conforming to P2.2 specification."""
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, literal, select, union_all
from sqlalchemy.orm import Session

from app.api.members import MemberActorPrincipal, get_member_actor_principal
from app.db.models.authorization import Branch
from app.db.models.member_check_ins import MemberCheckIn
from app.db.models.members import Member, MemberNote
from app.db.models.memberships import MembershipPeriod
from app.db.models.membership_debts import MembershipDebt
from app.db.models.membership_debt_payments import MembershipDebtPayment
from app.db.models.orders import Order, OrderItem, Payment
from app.db.models.rentals import Rental, RentalAsset, RentalCharge, RentalReceipt
from app.db.models.staff import StaffUser
from app.members.read_queries import get_member_reload_data
from app.members.read_schemas import MemberReloadResponseDTO
from app.rentals.payments import charge_outstanding_minor, rental_outstanding_minor
from app.memberships.eligibility import evaluate_membership_access
from app.api.deps import SessionFactoryDep

router = APIRouter(prefix="/api/v1/members", tags=["member-reads"])


@router.get("/{member_id}/purchases")
def member_purchases(
    member_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    from_date: date | None = None,
    to_date: date | None = None,
    branch_id: UUID | None = Query(default=None),
    x_branch_id: UUID | None = Header(default=None, alias="X-Branch-ID"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
    *, factory: SessionFactoryDep,
) -> dict:
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=422, detail="Invalid date range.")
    with factory() as session:
        branch = _resolve_caller_branch(session, principal, branch_id, x_branch_id)
        if session.get(Member, member_id) is None:
            raise HTTPException(status_code=404, detail="The requested resource was not found.")
        events = union_all(
            select(Order.id.label("id"), Order.created_at.label("created_at"), literal("order").label("kind"))
                .where(Order.member_id == member_id, Order.branch_id == branch),
            select(RentalCharge.id, RentalCharge.created_at, literal("rental"))
                .join(Rental, Rental.id == RentalCharge.rental_id)
                .where(Rental.member_id == member_id, Rental.branch_id == branch),
            select(RentalReceipt.id, RentalReceipt.created_at, literal("rental_payment"))
                .join(Rental, Rental.id == RentalReceipt.rental_id)
                .where(Rental.member_id == member_id, RentalReceipt.branch_id == branch),
            select(MembershipDebtPayment.id, MembershipDebtPayment.created_at, literal("debt_payment"))
                .where(MembershipDebtPayment.member_id == member_id, MembershipDebtPayment.branch_id == branch),
        ).subquery()
        query = select(events)
        if from_date:
            query = query.where(events.c.created_at >= datetime.combine(from_date, datetime.min.time(), timezone.utc))
        if to_date and to_date < date.max:
            query = query.where(events.c.created_at < datetime.combine(to_date + timedelta(days=1), datetime.min.time(), timezone.utc))
        filtered = query.subquery()
        total = session.scalar(select(func.count()).select_from(filtered)) or 0
        rows = session.execute(select(filtered).order_by(filtered.c.created_at.desc(), filtered.c.kind, filtered.c.id.desc())
                               .offset((page - 1) * page_size).limit(page_size)).all()
        items = []
        for row in rows:
            if row.kind == "order":
                order = session.get(Order, row.id)
                debt = session.scalar(select(MembershipDebt).where(MembershipDebt.order_id == order.id))
                paid = session.scalar(select(func.coalesce(func.sum(MembershipDebtPayment.amount_minor), 0))
                                      .where(MembershipDebtPayment.debt_id == debt.id)) if debt else 0
                status = "pending" if (debt and debt.initial_outstanding_minor > paid) or not order.payment or order.payment.status != "confirmed" else "paid"
                item = {"description": ", ".join(line.description_snapshot for line in order.items),
                        "amount_minor": order.total_minor, "method": order.payment.method if order.payment else None,
                        "status": status}
            elif row.kind == "rental":
                charge = session.get(RentalCharge, row.id)
                rental = session.get(Rental, charge.rental_id)
                asset = session.get(RentalAsset, rental.asset_id)
                payment = session.scalar(select(Payment).where(Payment.rental_charge_id == charge.id).order_by(Payment.received_at).limit(1))
                item = {"description": f"{rental.kind} · {asset.code}", "amount_minor": charge.amount_minor,
                        "method": payment.method if payment else None,
                        "status": "pending" if charge_outstanding_minor(session, charge) > 0 else "paid"}
            elif row.kind == "rental_payment":
                receipt = session.get(RentalReceipt, row.id)
                item = {"description": "Rental payment", "amount_minor": receipt.amount_minor,
                        "method": receipt.method, "status": "paid" if receipt.status == "confirmed" else "pending"}
            else:
                payment = session.get(MembershipDebtPayment, row.id)
                item = {"description": "Membership debt payment", "amount_minor": payment.amount_minor,
                        "method": "cash", "status": "paid"}
            items.append({"id": row.id, "created_at": row.created_at, "kind": row.kind, **item})
        return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{member_id}/summary")
def member_summary(
    member_id: UUID,
    branch_id: UUID | None = Query(default=None),
    x_branch_id: UUID | None = Header(default=None, alias="X-Branch-ID"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
    *, factory: SessionFactoryDep,
) -> dict:
    now = datetime.now(timezone.utc)
    today = now.date()
    with factory() as session:
        branch = _resolve_caller_branch(session, principal, branch_id, x_branch_id)
        member = session.get(Member, member_id)
        if member is None:
            raise HTTPException(status_code=404, detail="The requested resource was not found.")
        period = session.execute(
            select(MembershipPeriod, OrderItem)
            .join(OrderItem, OrderItem.id == MembershipPeriod.order_item_id)
            .join(Order, Order.id == OrderItem.order_id)
            .where(MembershipPeriod.member_id == member_id, Order.branch_id == branch,
                   MembershipPeriod.starts_on <= today, MembershipPeriod.ends_on > today)
            .order_by(MembershipPeriod.ends_on.desc()).limit(1)
        ).first()
        repayments = select(
            MembershipDebtPayment.debt_id,
            func.sum(MembershipDebtPayment.amount_minor).label("paid"),
        ).where(MembershipDebtPayment.member_id == member_id).group_by(MembershipDebtPayment.debt_id).subquery()
        outstanding = MembershipDebt.initial_outstanding_minor - func.coalesce(repayments.c.paid, 0)
        debts = session.execute(
            select(MembershipDebt.order_id, outstanding.label("remaining"))
            .join(Order, Order.id == MembershipDebt.order_id)
            .outerjoin(repayments, repayments.c.debt_id == MembershipDebt.id)
            .where(MembershipDebt.member_id == member_id, Order.branch_id == branch, outstanding > 0)
            .order_by(MembershipDebt.created_at, MembershipDebt.id)
        ).all()
        rentals = session.execute(
            select(Rental, RentalAsset).join(RentalAsset, RentalAsset.id == Rental.asset_id)
            .where(Rental.member_id == member_id, Rental.branch_id == branch, Rental.status.in_(("active", "returned", "released")))
            .order_by(Rental.created_at.desc())
        ).all()
        locker = next(((r, a) for r, a in rentals if r.kind == "locker" and r.status == "active"), None)
        gloves = next(((r, a) for r, a in rentals if r.kind == "glove" and r.status == "active"), None)
        rental_debt = sum(rental_outstanding_minor(session, rental) for rental, _ in rentals)
        visit_count = session.scalar(select(func.count(func.distinct(MemberCheckIn.visit_id))).where(
            MemberCheckIn.member_id == member_id, MemberCheckIn.branch_id == branch,
            MemberCheckIn.occurred_at >= now - timedelta(days=28), MemberCheckIn.occurred_at <= now,
        )) or 0
        last_visit = session.scalar(select(func.max(MemberCheckIn.occurred_at)).where(
            MemberCheckIn.member_id == member_id, MemberCheckIn.branch_id == branch,
            MemberCheckIn.occurred_at <= now,
        ))
        favorite = session.scalar(
            select(OrderItem.description_snapshot).join(Order, Order.id == OrderItem.order_id)
            .join(Payment, Payment.order_id == Order.id)
            .where(Order.member_id == member_id, Order.branch_id == branch, OrderItem.item_kind == "product",
                   Payment.status == "confirmed", Order.created_at >= now - timedelta(days=60), Order.created_at <= now)
            .group_by(OrderItem.product_id, OrderItem.description_snapshot)
            .order_by(func.sum(OrderItem.quantity).desc(), OrderItem.description_snapshot).limit(1)
        )
        note = session.execute(select(MemberNote, StaffUser.login_identifier)
            .join(StaffUser, StaffUser.id == MemberNote.author_id)
            .where(MemberNote.member_id == member_id, MemberNote.voided_at.is_(None))
            .order_by(MemberNote.created_at.desc(), MemberNote.id.desc()).limit(1)).first()
        weekly = round(visit_count / 4, 1)
        last = last_visit.replace(tzinfo=timezone.utc) if last_visit and last_visit.tzinfo is None else last_visit
        at_risk = last is not None and (now - last).days >= 7
        return {
            "member_id": member.id, "member_number": member.member_number, "full_name": member.full_name,
            "phone": member.phone, "photo_url": member.photo_url,
            "membership": ({"plan_name": period[1].description_snapshot, "starts_on": period[0].starts_on,
                "ends_on": period[0].ends_on, "status": evaluate_membership_access(session, period[0].id, today, branch).status.value,
                "days_remaining": (period[0].ends_on - today).days} if period else None),
            "financial": {"has_pending_balance": bool(debts) or rental_debt > 0, "pending_balance_minor": sum(d.remaining for d in debts) + rental_debt,
                          "unpaid_order_id": debts[0].order_id if debts else None},
            "rentals": {"active_locker": {"code": locker[1].code, "expires_at": locker[0].ends_on,
                "status": "expired" if locker[0].ends_on and locker[0].ends_on <= today else "active"} if locker else None,
                "active_gloves": {"code": gloves[1].code, "returned": False} if gloves else None},
            "habits": {"weekly_visits": weekly, "attendance_tier": "risk" if at_risk else "high" if weekly >= 3 else "normal",
                "greeting_prompt": "Reincorporación: Preguntar cómo ha estado tras varios días sin entrenar." if at_risk else
                    "Socio habitual: Saludo ágil y desear excelente entrenamiento." if weekly >= 3 else "Saludar cordialmente al socio.",
                "favorite_product": favorite},
            "latest_note": {"id": note[0].id, "body": note[0].body, "author_name": note[1],
                            "created_at": note[0].created_at} if note else None,
        }


@router.get("/{member_id}/check-ins")
def member_check_in_history(
    member_id: UUID,
    month: int = Query(ge=1, le=12),
    year: int = Query(ge=1, le=9998),
    branch_id: UUID | None = Query(default=None),
    x_branch_id: UUID | None = Header(default=None, alias="X-Branch-ID"),
    x_organization_id: UUID | None = Header(default=None, alias="X-Organization-ID"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
    *, factory: SessionFactoryDep,
) -> list[dict]:
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.utc)
    with factory() as session:
        branch = _resolve_caller_branch(session, principal, branch_id, x_branch_id)
        member = get_member_reload_data(session, member_id, principal.is_admin, branch, x_organization_id, 1)
        if member is None:
            raise HTTPException(status_code=404, detail="The requested resource was not found.")
        visits = session.scalars(
            select(MemberCheckIn)
            .where(MemberCheckIn.member_id == member_id, MemberCheckIn.branch_id == branch,
                   MemberCheckIn.occurred_at >= start, MemberCheckIn.occurred_at < end)
            .order_by(MemberCheckIn.occurred_at.desc(), MemberCheckIn.id.desc())
        ).all()
        return [{"id": visit.id, "branch_id": visit.branch_id, "occurred_at": visit.occurred_at,
                 "access_reason": visit.access_reason} for visit in visits]


def _resolve_caller_branch(
    session: Session,
    principal: MemberActorPrincipal,
    query_branch_id: UUID | None,
    header_branch_id: UUID | None,
) -> UUID:
    """Resolve authoritative branch context, validating non-admin branch assignment."""
    if not principal.is_admin:
        if principal.branch_id is None:
            raise HTTPException(
                status_code=403,
                detail="Actor lacks member read grant or branch assignment.",
            )
        target_branch = query_branch_id or header_branch_id
        if target_branch is not None and target_branch != principal.branch_id:
            raise HTTPException(
                status_code=403,
                detail="Actor attempted an action outside their assigned branch context.",
            )
        return principal.branch_id

    # Admin may specify target branch via query or header, or fall back to default
    if query_branch_id is not None:
        return query_branch_id
    if header_branch_id is not None:
        return header_branch_id
    if principal.branch_id is not None:
        return principal.branch_id

    # Resolve first active branch from database or fallback UUID
    active_branch_id = session.scalar(
        select(Branch.id).where(Branch.is_active.is_(True)).limit(1)
    )
    if active_branch_id is not None:
        return active_branch_id
    return UUID("00000000-0000-0000-0000-000000000001")


@router.get("/{member_id}/reload", response_model=MemberReloadResponseDTO)
def reload_member_endpoint(
    member_id: UUID,
    visit_limit: int = Query(default=20, ge=1, le=50, description="Max recent visits to return"),
    branch_id: UUID | None = Query(default=None, description="Optional branch context override for Admin"),
    x_branch_id: UUID | None = Header(default=None, alias="X-Branch-ID"),
    x_organization_id: UUID | None = Header(default=None, alias="X-Organization-ID"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
    *, factory: SessionFactoryDep,
) -> MemberReloadResponseDTO:
    """Retrieve durable reloadable operational and entitlement state for a member.

    Satisfies FE05 gap resolution by projecting stable period, debt, sample, and visit UUIDs.
    Enforces D-001 (organization-shared profile with branch-partitioned transactions)
    and D-012 (role-projected financial ledger vs receptionist warning flag).
    """

    with factory() as session:
        caller_branch_id = _resolve_caller_branch(
            session=session,
            principal=principal,
            query_branch_id=branch_id,
            header_branch_id=x_branch_id,
        )

        reload_dto = get_member_reload_data(
            session=session,
            member_id=member_id,
            principal_is_admin=principal.is_admin,
            caller_branch_id=caller_branch_id,
            caller_org_id=x_organization_id,
            visit_limit=visit_limit,
        )

        if reload_dto is None:
            raise HTTPException(status_code=404, detail="The requested resource was not found.")

        return reload_dto
