"""Owner overview use case: a read-only, branch-scoped operations summary (no writes, no commits)."""
from collections import Counter
from datetime import datetime, time, timedelta, timezone
from statistics import median
from zoneinfo import ZoneInfo

from app.errors import HttpStatusError
from app.finance import queries as q
from app.finance.service import authorized_branches
from app.errors import session_factory
from app.shifts.queries import shift_financial_summary
from app.staff.roster import weekly_base
from app.staff.schedules import intervals


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


_METHOD_LABELS = (("cash", "Efectivo"), ("transfer", "Transferencia confirmada"), ("card", "Tarjeta"))


def _by_method(session, payments, refunds):
    """Confirmed money per method (net of refunds) and card charges grouped by Point terminal."""
    confirmed = [row for row in payments if row["status"] == "confirmed" and row["method"] in dict(_METHOD_LABELS)]
    terminal_of = q.payment_terminal_ids(session, [row["id"] for row in confirmed if row["method"] == "card"])
    names = q.terminal_names(session, set(terminal_of.values()))
    result = []
    for method, label in _METHOD_LABELS:
        rows = [row for row in confirmed if row["method"] == method]
        refunded = -sum(row["amount_minor"] for row in rows if row["amount_minor"] < 0)
        refunded += sum(row.amount_minor for row in refunds if row.payout_method == method)
        charges = [row for row in rows if row["amount_minor"] >= 0]
        gross = sum(row["amount_minor"] for row in charges)
        entry = {"method": method, "label": label, "count": len(charges), "gross_minor": gross,
                 "refunds_minor": refunded, "amount_minor": gross - refunded}
        if method == "card":
            groups = {}
            for row in charges:
                group = groups.setdefault(terminal_of.get(row["id"]), {"count": 0, "amount_minor": 0})
                group["count"] += 1
                group["amount_minor"] += row["amount_minor"]
            entry["terminals"] = [{"terminal_id": tid, "terminal_name": names.get(tid) if tid else None, **group}
                                  for tid, group in sorted(groups.items(), key=lambda kv: (kv[0] is None, str(kv[0])))]
        result.append(entry)
    return result


def _cancellations(session, branch_id, start, end, refunds):
    sales = q.product_sale_cancellations(session, branch_id, start, end)
    rentals = q.rental_cancellations(session, branch_id, start, end)
    return {"total_count": len(sales) + len(refunds) + len(rentals),
            "product_sales": {"count": len(sales)},
            "product_refunds": {"count": len(refunds), "amount_minor": sum(r.amount_minor for r in refunds)},
            "rental_cancellations": {"count": len(rentals),
                "refund_amount_minor": sum(r.refund_amount_minor for r in rentals),
                "cancelled_debt_minor": sum(r.cancelled_debt_minor for r in rentals),
                "unreviewed_count": sum(1 for r in rentals if r.reviewed_at is None)}}


def owner_overview(factory, principal, from_date, to_date, branch_id):
    with session_factory(factory)() as session:
        try:
            branches = authorized_branches(session, principal, branch_id)
        except HttpStatusError as exc:
            if exc.status == 404:
                raise HttpStatusError(403) from None
            raise
        if not branches:
            raise HttpStatusError(403)
        branch = branches[0]
        zone = ZoneInfo(branch.timezone or "America/Mexico_City")
        now = datetime.now(timezone.utc)
        today = now.astimezone(zone).date()
        first, last = from_date or today, to_date or today
        if last < first:
            raise HttpStatusError(422)
        start = datetime.combine(first, time.min, zone).astimezone(timezone.utc)
        end = datetime.combine(last + timedelta(days=1), time.min, zone).astimezone(timezone.utc)
        in_window = lambda value: start <= _utc(value) < end

        shifts = q.branch_shifts(session, branch.id)
        payments = []
        for shift in shifts:
            payments.extend(row for row in shift_financial_summary(session, shift)["payments"] if in_window(row["recorded_at"]))
        overtime = q.overtime_payments(session, branch.id, start, end)
        payments.extend({"id": row.id, "method": row.method, "status": row.status,
                         "amount_minor": row.amount_minor, "recorded_at": row.received_at} for row in overtime)
        # Only confirmed payments count as money received; transfers under review stay pending.
        cash = sum(row["amount_minor"] for row in payments if row["status"] == "confirmed" and row["method"] == "cash")
        card = sum(row["amount_minor"] for row in payments if row["status"] == "confirmed" and row["method"] == "card")
        refunds = q.product_refunds(session, branch.id, start, end)
        cash -= sum(row.amount_minor for row in refunds if row.payout_method == "cash")
        card -= sum(row.amount_minor for row in refunds if row.payout_method == "card")
        by_method = _by_method(session, payments, refunds)
        pending = [row for row in payments if row["method"] == "transfer" and row["status"] in ("pending", "under_review")]
        register_names = q.register_names(session, branch.id)
        discrepancies = [{"shift_id": str(s.id), "difference_minor": s.difference_minor,
                          "register_id": str(s.cash_register_id), "register_name": register_names.get(s.cash_register_id),
                          "opened_at": _utc(s.opened_at) if s.opened_at else None, "closed_at": _utc(s.closed_at)} for s in shifts
                         if s.status == "closed" and s.closed_at and in_window(s.closed_at) and s.difference_minor]
        counts = [{"shift_id": str(review.shift_id), "product": item.name, "expected_quantity": item.expected_quantity,
                   "physical_quantity": obs.physical_quantity}
                  for obs, item, review in q.count_discrepancies(session, branch.id, start, end)]

        periods = q.membership_periods(session, branch.id)
        by_member = {}
        for period in periods:
            by_member.setdefault(period.member_id, []).append(period)
        members = q.members_by_ids(session, by_member) if by_member else []
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

        checkins = q.member_check_ins(session, branch.id, start, end)
        samples = q.class_sample_check_ins(session, branch.id, start, end)
        hours = Counter(_utc(row.occurred_at).astimezone(zone).hour for row in [*checkins, *samples])
        current_start = datetime.combine(today, time.min, zone).astimezone(timezone.utc)
        recent_start = max(current_start, now - timedelta(minutes=90))
        recent_members = q.recent_member_ids(session, branch.id, recent_start, now)
        recent_samples = q.recent_sample_member_ids(session, branch.id, recent_start, now)

        products = q.active_products(session)
        initial = q.initial_stock(session, branch.id)
        stock = dict(initial)
        for product_id, kind, quantity in q.stock_movement_totals(session, branch.id):
            stock[product_id] = stock.get(product_id, 0) + (quantity if kind in ("restock", "return") else -quantity)
        low = sum(1 for product in products if product.id in initial and stock[product.id] <= 5)
        retail = q.retail_totals(session, branch.id, start, end)
        overdue = q.overdue_lockers(session, branch.id, today)
        cancellations = q.unreviewed_cancellations(session, branch.id)
        cancellation_summary = _cancellations(session, branch.id, start, end, refunds)

        profiles = q.active_profiles(session, branch.id)
        entries = q.attendance_entries(session, branch.id, today)
        checkout_ids = q.checkout_attendance_ids(session, [entry.id for entry in entries])
        on_duty = len({entry.profile_id for entry in entries if entry.id not in checkout_ids and _utc(entry.occurred_at) <= now})
        absent = set()
        for series in q.schedule_series(session, branch.id, [profile.id for profile in profiles]):
            for begins, _, day in intervals(session, series, today, today, zone=zone):
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
                "shift_discrepancies": discrepancies, "count_discrepancies": counts, "by_method": by_method},
            "cancellations": cancellation_summary,
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
