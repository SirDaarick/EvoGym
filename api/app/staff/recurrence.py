"""Pure weekly-recurrence and wall-time math for staff schedules: no SQL, sessions or HTTP."""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.db.models import StaffScheduleSeries

MAX_SCHEDULE_SPAN_DAYS = 146096


def validate_rule_values(start_date: date, weekdays: list[int], start_time: time, end_time: time,
                          end_date: date | None, occurrence_count: int | None) -> None:
    if not weekdays or len(set(weekdays)) != len(weekdays) or any(day < 0 or day > 6 for day in weekdays):
        raise ValueError("weekdays must contain unique ISO weekday values from 0 to 6")
    if start_time.tzinfo is not None or end_time.tzinfo is not None:
        raise ValueError("Schedule times must be local wall times without offsets")
    if end_date is not None and end_date < start_date:
        raise ValueError("end_date must not precede start_date")
    if end_date is not None and not any(
        (weekday - start_date.weekday()) % 7 <= (end_date - start_date).days for weekday in weekdays
    ):
        raise ValueError("The finite schedule range contains no selected weekday")
    if end_date is not None and occurrence_count is not None:
        raise ValueError("Choose either end_date or occurrence_count")
    if end_date is not None and end_date == date.max and end_time <= start_time:
        raise ValueError("An overnight schedule cannot end on the maximum supported date")
    if end_date is not None and (end_date - start_date).days > MAX_SCHEDULE_SPAN_DAYS:
        raise ValueError("Finite schedules cannot span more than one complete 400-year recurrence cycle")
    if occurrence_count is not None and occurrence_count > 0:
        probe = StaffScheduleSeries(start_date=start_date, weekdays=weekdays, occurrence_count=occurrence_count,
                                    end_date=None, start_time=start_time, end_time=end_time)
        try:
            last = rule_end(probe, date.max)
        except OverflowError:
            raise ValueError("The requested occurrence count exceeds the supported calendar") from None
        if (last - start_date).days > MAX_SCHEDULE_SPAN_DAYS:
            raise ValueError("Finite schedules cannot span more than one complete 400-year recurrence cycle")



def local_datetime(day: date, at: time, zone: ZoneInfo) -> datetime:
    naive = datetime.combine(day, at)
    local = naive.replace(tzinfo=zone, fold=0)
    # A nonexistent wall time does not round-trip through the current IANA rules.
    if local.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != naive:
        raise ValueError("The local schedule time does not exist under the branch timezone rules")
    return local


def end_day(day: date, start: time, end: time) -> date:
    if end <= start:
        if day == date.max:
            raise ValueError("An overnight schedule cannot end beyond the supported calendar")
        return day + timedelta(days=1)
    return day


def occurrence_dates(series: StaffScheduleSeries, first: date, last: date):
    start = max(series.start_date, first)
    if series.end_date is not None:
        last = min(last, series.end_date)
    if series.cancelled_from is not None:
        if series.cancelled_from == date.min:
            return
        last = min(last, series.cancelled_from - timedelta(days=1))
    if last < start:
        return
    weekdays = sorted(set(series.weekdays))
    if not weekdays:
        return
    prior_day = None if start == date.min else start - timedelta(days=1)
    count = sum(weekday_occurrences(series.start_date, prior_day, day) for day in weekdays) if prior_day else 0
    current = start
    initial_delta = min((day - current.weekday()) % 7 for day in weekdays)
    if current > date.max - timedelta(days=initial_delta):
        return
    current += timedelta(days=initial_delta)
    while current <= last:
        count += 1
        if series.occurrence_count is not None and count > series.occurrence_count:
            return
        yield current
        next_weekday = min((day - current.weekday()) % 7 or 7 for day in weekdays)
        if current > date.max - timedelta(days=next_weekday):
            return
        current += timedelta(days=next_weekday)


def weekday_occurrences(first: date, last: date, weekday: int) -> int:
    if last < first:
        return 0
    delta = (weekday - first.weekday()) % 7
    if first > date.max - timedelta(days=delta):
        return 0
    first_match = first + timedelta(days=delta)
    return 0 if first_match > last else (last - first_match).days // 7 + 1


def rule_end(series: StaffScheduleSeries, horizon: date) -> date:
    if series.end_date is not None:
        return min(series.end_date, horizon)
    if series.occurrence_count is not None:
        weekdays = sorted(set(series.weekdays))
        first_week = [day for day in weekdays if day >= series.start_date.weekday()]
        ordinal = series.occurrence_count
        if ordinal <= len(first_week):
            result = series.start_date + timedelta(days=first_week[ordinal - 1] - series.start_date.weekday())
        else:
            remaining = ordinal - len(first_week) - 1
            weeks, index = divmod(remaining, len(weekdays))
            monday = series.start_date - timedelta(days=series.start_date.weekday()) + timedelta(days=7)
            result = monday + timedelta(days=weeks * 7 + weekdays[index])
        return result
    return horizon
