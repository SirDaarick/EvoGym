"""Owner attendance use case: read-only hourly / weekday check-in bins for one authorized branch."""
from collections import Counter
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.errors import HttpStatusError, session_factory
from app.finance import queries as q
from app.finance.service import authorized_branches

GYM_CAPACITY = 50  # same constant as owner_overview and the frontend selector
DAY_NAMES = ("Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo")
DAY_SHORT = ("Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom")


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _hour_label(hour: int) -> str:
    return f"{hour:02d}:00"


def build_bins(occurred_at, zone):
    """Pure aggregation: UTC-ish timestamps -> (hour counter, weekday counter) in the branch zone."""
    hours, days = Counter(), Counter()
    for value in occurred_at:
        local = _utc(value).astimezone(zone)
        hours[local.hour] += 1
        days[local.weekday()] += 1
    return hours, days


def _extreme(hours, picker):
    if not hours:
        return None
    hour = picker(hours, key=hours.get)
    return {"hour": hour, "label": _hour_label(hour), "visits": hours[hour]}


def owner_attendance(factory, principal, from_date, to_date, branch_id):
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

        checkins = q.member_check_ins(session, branch.id, start, end)
        samples = q.class_sample_check_ins(session, branch.id, start, end)
        hours, days = build_bins([row.occurred_at for row in [*checkins, *samples]], zone)
        total = len(checkins) + len(samples)

        # Live occupancy: identical window to owner_overview (today's start or the last 90 minutes).
        current_start = datetime.combine(today, time.min, zone).astimezone(timezone.utc)
        recent_start = max(current_start, now - timedelta(minutes=90))
        live = len(set(q.recent_member_ids(session, branch.id, recent_start, now))
                   | set(q.recent_sample_member_ids(session, branch.id, recent_start, now)))

        busiest = max(days, key=days.get) if days else None
        return {
            "period": {"from": first, "to": last, "branch_id": branch.id, "timezone": str(zone)},
            "gym_capacity": GYM_CAPACITY,
            "live_occupancy_count": live,
            "live_occupancy_percent": min(100, round(100 * live / GYM_CAPACITY)),
            "total_check_ins": total,
            "member_check_ins": len(checkins),
            "class_sample_check_ins": len(samples),
            "peak_hour": _extreme(hours, max),
            "valley_hour": _extreme(hours, min),
            "busiest_day": None if busiest is None else {
                "day_index": busiest, "day_name": DAY_NAMES[busiest], "visits": days[busiest],
                "percent": round(100 * days[busiest] / total, 1)},
            "hourly_bins": [{"hour": h, "hour_label": _hour_label(h), "time_range": f"{_hour_label(h)}–{_hour_label((h + 1) % 24)}",
                             "raw_visits": hours.get(h, 0), "is_peak": bool(hours) and hours.get(h, 0) == max(hours.values()),
                             "is_valley": bool(hours) and h == min(hours, key=hours.get)} for h in range(24)],
            "day_of_week_bins": [{"day_index": d, "day_name": DAY_NAMES[d], "short_name": DAY_SHORT[d],
                                  "raw_visits": days.get(d, 0), "percent": round(100 * days.get(d, 0) / total, 1) if total else 0,
                                  "is_busiest": busiest == d} for d in range(7)],
        }
