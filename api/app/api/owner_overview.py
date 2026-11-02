"""Read-only, branch-scoped owner operations summary."""
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from statistics import median
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select

from app.api.pending_money import FinancePrincipal, _authorized_branches, _bearer, _principal
from app.api.payroll import weekly_base
from app.api.staff_schedules import _intervals
from app.db.models import (
    CashRegister, ClassSampleCheckIn, Member, MemberCheckIn, MembershipPeriod,
    Order, OrderItem, Payment, Product, ProductRefund, RegisterInventorySnapshotItem,
    Rental, RentalCancellation, Shift, ShiftInventoryObservation,
    ShiftInventoryReview, StaffAttendanceCheckout, StaffAttendanceRecord,
    StaffRosterProfile, StaffScheduleSeries, StockInitialization, StockMovement,
)
from app.shifts.queries import shift_financial_summary

router = APIRouter(prefix="/api/v1/owner/overview", tags=["owner-overview"])


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _overview_principal(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> FinancePrincipal:
    try:
        return _principal(request, credentials)
    except HTTPException as exc:
        if exc.status_code == 401:
            raise HTTPException(403, "Finance access denied.") from None
        raise


@router.get("")
def owner_overview(
    request: Request,
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    branch_id: UUID | None = None,
    principal: FinancePrincipal = Depends(_overview_principal),
):
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503, "Database unavailable.")
    with factory() as session:
        try:
            branches = _authorized_branches(session, principal, branch_id)
        except HTTPException as exc:
            if exc.status_code == 404:
                raise HTTPException(403, "Access restricted to authorized branch.") from None
            raise
        if not branches:
            raise HTTPException(403, "Finance access denied.")
        branch = branches[0]
        zone = ZoneInfo(branch.timezone or "America/Mexico_City")
        now = datetime.now(timezone.utc)
        today = now.astimezone(zone).date()
        first, last = from_date or today, to_date or today
        if last < first:
            raise HTTPException(422, "End date must not precede start date.")
        start = datetime.combine(first, time.min, zone).astimezone(timezone.utc)
        end = datetime.combine(last + timedelta(days=1), time.min, zone).astimezone(timezone.utc)
        in_window = lambda value: start <= _utc(value) < end

        shifts = session.scalars(select(Shift).join(CashRegister).where(CashRegister.branch_id == branch.id)).all()
        payments = []
        for shift in shifts:
            payments.extend(row for row in shift_financial_summary(session, shift)["payments"] if in_window(row["recorded_at"]))
        overtime = session.scalars(select(Payment).join(Order, Payment.order_id == Order.id).where(
            Order.branch_id == branch.id, Order.financial_shift_id.is_(None), Payment.method.in_(("cash", "card")),
            Payment.received_at >= start, Payment.received_at < end)).all()
        payments.extend({"id": row.id, "method": row.method, "status": row.status,
                         "amount_minor": row.amount_minor, "recorded_at": row.received_at} for row in overtime)
        cash = sum(row["amount_minor"] for row in payments if row["status"] == "confirmed" and row["method"] == "cash")
        card = sum(row["amount_minor"] for row in payments if row["status"] == "confirmed" and row["method"] == "card")
        refunds = session.scalars(select(ProductRefund).where(ProductRefund.branch_id == branch.id,
            ProductRefund.created_at >= start, ProductRefund.created_at < end)).all()
        cash -= sum(row.amount_minor for row in refunds if row.payout_method == "cash")
        card -= sum(row.amount_minor for row in refunds if row.payout_method == "card")
        pending = [row for row in payments if row["method"] == "transfer" and row["status"] in ("pending", "under_review")]
        discrepancies = [{"shift_id": str(s.id), "difference_minor": s.difference_minor} for s in shifts
                         if s.status == "closed" and s.closed_at and in_window(s.closed_at) and s.difference_minor]
        count_rows = session.execute(select(ShiftInventoryObservation, RegisterInventorySnapshotItem, ShiftInventoryReview)
            .join(RegisterInventorySnapshotItem, RegisterInventorySnapshotItem.id == ShiftInventoryObservation.snapshot_item_id)
            .join(ShiftInventoryReview, ShiftInventoryReview.id == ShiftInventoryObservation.review_id)
            .join(Shift, Shift.id == ShiftInventoryReview.shift_id).join(CashRegister)
            .where(CashRegister.branch_id == branch.id, ShiftInventoryReview.confirmed_at >= start,
                   ShiftInventoryReview.confirmed_at < end,
                   ShiftInventoryObservation.physical_quantity != RegisterInventorySnapshotItem.expected_quantity)).all()
        counts = [{"shift_id": str(review.shift_id), "product": item.name, "expected_quantity": item.expected_quantity,
                   "physical_quantity": obs.physical_quantity} for obs, item, review in count_rows]

        periods = session.scalars(select(MembershipPeriod).join(OrderItem).join(Order)
                                  .where(Order.branch_id == branch.id)).all()
        by_member = {}
        for period in periods:
            by_member.setdefault(period.member_id, []).append(period)
        members = session.scalars(select(Member).where(Member.id.in_(by_member))).all() if by_member else []
        active = [member for member in members if any(p.starts_on <= today < p.ends_on for p in by_member[member.id])]
        latest_end = {member.id: max(p.ends_on for p in by_member[member.id]) for member in members}
        tenures = [max(0, (today - min(p.starts_on for p in by_member[m.id])).days / 30.4375) for m in members]
        sold = renewed = 0
        for member_periods in by_member.values():
            ordered = sorted(member_periods, key=lambda p: (_utc(p.created_at), str(p.id)))
            for index, period in enumerate(ordered):
                if in_window(period.created_at):
                    if index:
                        renewed += 1
                    else:
                        sold += 1

        checkins = session.scalars(select(MemberCheckIn).where(MemberCheckIn.branch_id == branch.id,
            MemberCheckIn.occurred_at >= start, MemberCheckIn.occurred_at < end)).all()
        samples = session.scalars(select(ClassSampleCheckIn).where(ClassSampleCheckIn.branch_id == branch.id,
            ClassSampleCheckIn.occurred_at >= start, ClassSampleCheckIn.occurred_at < end)).all()
        hours = Counter(_utc(row.occurred_at).astimezone(zone).hour for row in [*checkins, *samples])
        current_start = datetime.combine(today, time.min, zone).astimezone(timezone.utc)
        recent_start = max(current_start, now - timedelta(minutes=90))
        recent_members = session.scalars(select(MemberCheckIn.member_id).where(MemberCheckIn.branch_id == branch.id,
            MemberCheckIn.occurred_at >= recent_start, MemberCheckIn.occurred_at <= now)).all()
        recent_samples = session.scalars(select(ClassSampleCheckIn.member_id).where(ClassSampleCheckIn.branch_id == branch.id,
            ClassSampleCheckIn.occurred_at >= recent_start, ClassSampleCheckIn.occurred_at <= now)).all()

        products = session.scalars(select(Product).where(Product.is_active.is_(True))).all()
        initial = dict(session.execute(select(StockInitialization.product_id, StockInitialization.quantity)
            .where(StockInitialization.branch_id == branch.id)).all())
        movements = session.execute(select(StockMovement.product_id, StockMovement.kind, func.sum(StockMovement.quantity))
            .where(StockMovement.branch_id == branch.id).group_by(StockMovement.product_id, StockMovement.kind)).all()
        stock = dict(initial)
        for product_id, kind, quantity in movements:
            stock[product_id] = stock.get(product_id, 0) + (quantity if kind in ("restock", "return") else -quantity)
        low = sum(1 for product in products if product.id in initial and stock[product.id] <= 5)
        retail = session.execute(select(func.coalesce(func.sum(OrderItem.quantity), 0),
            func.coalesce(func.sum(OrderItem.line_total_minor), 0)).join(Order).join(Payment, Payment.order_id == Order.id).where(Order.branch_id == branch.id,
            Payment.status == "confirmed",
            OrderItem.item_kind == "product", Order.created_at >= start, Order.created_at < end)).one()
        overdue = session.scalar(select(func.count()).select_from(Rental).where(Rental.branch_id == branch.id,
            Rental.kind == "locker", Rental.status == "active", Rental.ends_on < today)) or 0
        cancellations = session.scalar(select(func.count()).select_from(RentalCancellation).where(
            RentalCancellation.branch_id == branch.id, RentalCancellation.reviewed_at.is_(None))) or 0

        profiles = session.scalars(select(StaffRosterProfile).where(StaffRosterProfile.branch_id == branch.id,
            StaffRosterProfile.is_active.is_(True))).all()
        entries = session.scalars(select(StaffAttendanceRecord).where(StaffAttendanceRecord.branch_id == branch.id,
            StaffAttendanceRecord.business_date == today)).all()
        checkout_ids = set(session.scalars(select(StaffAttendanceCheckout.attendance_id).where(
            StaffAttendanceCheckout.attendance_id.in_([entry.id for entry in entries]))).all())
        on_duty = len({entry.profile_id for entry in entries if entry.id not in checkout_ids and _utc(entry.occurred_at) <= now})
        absent = set()
        series_rows = session.scalars(select(StaffScheduleSeries).where(StaffScheduleSeries.branch_id == branch.id,
            StaffScheduleSeries.profile_id.in_([profile.id for profile in profiles]))).all()
        for series in series_rows:
            for begins, _, day in _intervals(session, series, today, today, zone=zone):
                if begins <= now and not any(e.series_id == series.id and e.occurrence_date == day and _utc(e.occurred_at) <= now for e in entries):
                    absent.add(series.profile_id)
        payday = today + timedelta(days=(5 - today.weekday()) % 7)
        categories = [{"category": name, "count": count} for name, count in (
            ("Diferencias de caja", len(discrepancies)), ("Diferencias de inventario", len(counts)),
            ("Stock bajo", low), ("Casilleros vencidos", overdue), ("Cancelaciones sin revisar", cancellations)) if count]
        return {
            "period": {"from": first, "to": last, "branch_id": branch.id, "timezone": str(zone)},
            "pulse": {"confirmed_minor": cash + card, "alerts_count": sum(c["count"] for c in categories)},
            "finances": {"cash_minor": cash, "card_minor": card,
                "confirmed_count": sum(1 for row in payments if row["status"] == "confirmed" and row["amount_minor"] >= 0),
                "pending_transfer_minor": sum(row["amount_minor"] for row in pending), "pending_transfer_count": len(pending),
                "shift_discrepancies": discrepancies, "count_discrepancies": counts},
            "members": {"total_members": len(members), "active_members": len(active),
                "active_percent": round(100 * len(active) / len(members), 1) if members else 0,
                "median_tenure_months": round(median(tenures), 1) if tenures else 0,
                "expiring_soon_count": sum(today < end_date <= today + timedelta(days=7) for end_date in latest_end.values()),
                "expired_count": sum(end_date <= today for end_date in latest_end.values())},
            "attendance": {"live_occupancy_count": len(set(recent_members) | set(recent_samples)), "gym_capacity": 50,
                "peak_hour": max(hours, key=hours.get) if hours else None,
                "valley_hour": min(hours, key=hours.get) if hours else None, "total_check_ins": len(checkins) + len(samples),
                "memberships_sold_count": sold, "memberships_renewed_count": renewed},
            "inventory": {"active_products_count": len(products), "low_stock_count": low,
                "retail_units_sold": retail[0], "retail_revenue_minor": retail[1]},
            "staff": {"next_payday": payday, "days_until_payday": (payday - today).days,
                "estimated_payroll_minor": sum(weekly_base(p.monthly_salary_minor) for p in profiles),
                "staff_on_duty_count": on_duty, "staff_absent_count": len(absent)},
            "alerts": {"total_count": sum(c["count"] for c in categories), "category_counts": categories},
        }
