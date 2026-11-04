"""Staff schedule use cases: branch/manage permissions, profile locks, timezone-rule revalidation, recurrence
validation, overlap checks and the series split on edit. Pure date math lives in `app.staff.recurrence`, SQL in
`app.staff.queries`; HTTP transport in `app.api.staff_schedules`.

Failures are typed `HttpStatusError`s. Every use case takes the session `factory` and owns its transaction.
"""
import hashlib
from datetime import date, datetime, time, timedelta, timezone
from importlib.resources import files
from io import BytesIO
from pathlib import Path
from typing import Protocol
from uuid import UUID
from zoneinfo import TZPATH, ZoneInfo, ZoneInfoNotFoundError

from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.db.models import Branch, StaffScheduleException, StaffScheduleSeries
from app.errors import HttpStatusError
from app.staff import queries as q
from app.staff.recurrence import (
    MAX_SCHEDULE_SPAN_DAYS, end_day, local_datetime, occurrence_dates, rule_end, validate_rule_values,
)
from app.staff.schemas import OccurrenceEdit, SeriesCreate, SeriesEdit

_lock_profile = q.lock_profile


class Principal(Protocol):
    staff_id: UUID
    branch_id: UUID | None
    is_admin: bool


def _load_zone(key: str) -> tuple[ZoneInfo, str]:
    """Load and fingerprint the same current TZif bytes, bypassing ZoneInfo's cache."""
    data = None
    for root in TZPATH:
        candidate = Path(root).joinpath(*key.split("/"))
        try:
            data = candidate.read_bytes()
            break
        except OSError:
            continue
    if data is None:
        try:
            data = files("tzdata.zoneinfo").joinpath(*key.split("/")).read_bytes()
        except (ModuleNotFoundError, OSError, TypeError):
            raise HttpStatusError(503) from None
    digest = hashlib.sha256(data).hexdigest()
    try:
        return ZoneInfo.from_file(BytesIO(data), key=key), digest
    except (ValueError, OSError):
        raise HttpStatusError(409) from None


def _revalidate_profile_timezone_rules(session, profile_id: UUID) -> None:
    rows = q.profile_series_ordered(session, profile_id)
    current = {}
    stale = []
    for series in rows:
        branch = q.get_branch(session, series.branch_id)
        zone, digest = _load_zone(branch.timezone)
        current[series.id] = (zone, digest)
        if series.timezone_rules_digest != digest:
            stale.append(series)
    for series in stale:
        _validate_wall_times(session, series, current[series.id][0], status_code=409)
        for other in rows:
            if other.id != series.id and _overlaps(session, series, other):
                raise HttpStatusError(409)
        series.timezone_rules_digest = current[series.id][1]


def zone_for_branch(branch: Branch) -> tuple[ZoneInfo, str]:
    try:
        return _load_zone(branch.timezone)
    except HttpStatusError:
        raise
    except (ZoneInfoNotFoundError, ValueError):
        raise HttpStatusError(503) from None


def _read_branch(session, principal: Principal, branch_id: UUID) -> Branch:
    try:
        authorize(session, principal.staff_id, Permission.STAFF_ROSTER_READ, branch_id)
    except AuthorizationDenied:
        raise HttpStatusError(403) from None
    branch = q.get_branch(session, branch_id)
    if branch is None or not branch.is_active:
        raise HttpStatusError(404)
    return branch


def _manage(session, principal: Principal, branch_id: UUID) -> Branch:
    try:
        authorize(session, principal.staff_id, Permission.STAFF_ROSTER_MANAGE, branch_id)
    except AuthorizationDenied:
        raise HttpStatusError(403) from None
    branch = q.get_branch(session, branch_id)
    if branch is None or not branch.is_active:
        raise HttpStatusError(404)
    return branch


def intervals(session, series: StaffScheduleSeries, first: date, last: date, *, zone: ZoneInfo | None = None,
               ignore_exceptions: bool = False):
    branch = q.get_branch(session, series.branch_id)
    zone = zone or zone_for_branch(branch)[0]
    exceptions = {row.local_date: row for row in q.exceptions_between(session, series.id, first, last)}
    if ignore_exceptions:
        exceptions = {}
    for day in occurrence_dates(series, first, last):
        exception = exceptions.get(day)
        if exception is not None and exception.action == "skip":
            continue
        start = exception.override_start_time if exception else series.start_time
        end = exception.override_end_time if exception else series.end_time
        try:
            start_dt = local_datetime(day, start, zone)
            end_dt = local_datetime(end_day(day, start, end), end, zone)
        except (ValueError, OverflowError):
            raise HttpStatusError(422) from None
        yield start_dt.astimezone(timezone.utc), end_dt.astimezone(timezone.utc), day


def _next_future_occurrence(series: StaffScheduleSeries, first: date, zone: ZoneInfo, now_local: datetime) -> date | None:
    for day in occurrence_dates(series, first, _validation_end(series)):
        if local_datetime(day, series.start_time, zone) > now_local:
            return day
    return None


def _validation_end(series: StaffScheduleSeries) -> date:
    if series.end_date is not None:
        return series.end_date
    if series.occurrence_count is not None:
        try:
            return rule_end(series, date.max)
        except OverflowError:
            raise HttpStatusError(422) from None
    # Every supported weekly rule is evaluated over one complete Gregorian cycle.
    # The endpoint is rejected if that cycle cannot be represented by date.
    delta = timedelta(days=MAX_SCHEDULE_SPAN_DAYS)
    if series.start_date > date.max - delta:
        raise HttpStatusError(422)
    cycle_end = series.start_date + delta
    return min(rule_end(series, cycle_end), cycle_end)

def _validate_wall_times(session, series: StaffScheduleSeries, zone: ZoneInfo, *, status_code: int = 422) -> None:
    try:
        end = _validation_end(series)
        exceptions = {row.local_date: row for row in q.exceptions_from(session, series.id, series.start_date)}
        for day in occurrence_dates(series, series.start_date, end):
            exception = exceptions.get(day)
            if exception is not None and exception.action == "skip":
                continue
            start_time = exception.override_start_time if exception else series.start_time
            end_time = exception.override_end_time if exception else series.end_time
            local_datetime(day, start_time, zone)
            local_datetime(end_day(day, start_time, end_time), end_time, zone)
        # The 400-year endpoint is a recurring-baseline proof bound, not the
        # validity limit for finite exceptions stored on an indefinite series.
        for day, exception in exceptions.items():
            if day <= end or exception.action == "skip":
                continue
            if day not in set(occurrence_dates(series, day, day)):
                continue
            start_time = exception.override_start_time
            end_time = exception.override_end_time
            local_datetime(day, start_time, zone)
            local_datetime(end_day(day, start_time, end_time), end_time, zone)
    except (ValueError, OverflowError):
        raise HttpStatusError(status_code) from None


def _overlaps(session, candidate: StaffScheduleSeries, other: StaffScheduleSeries) -> bool:
    first = max(candidate.start_date, other.start_date)
    if first > date.min:
        first -= timedelta(days=1)
    # shortcut: recurring pairs expand every occurrence over a full 400-year cycle (~20k per series), O(n) per check;
    # replace with arithmetic period comparison if schedules per profile grow or checks get slow.
    recurring = candidate.end_date is None and other.end_date is None and candidate.occurrence_count is None and other.occurrence_count is None
    if recurring:
        # Weekly weekdays and the Gregorian/IANA recurring timezone rules repeat
        # within the full 400-year Gregorian cycle; this is not a short lookahead.
        if first > date.max - timedelta(days=146096):
            raise HttpStatusError(422)
        horizon = first + timedelta(days=MAX_SCHEDULE_SPAN_DAYS)
        last = horizon
    else:
        # For a mixed finite/indefinite pair, the indefinite rule continues
        # throughout the finite peer's actual window; its representative cycle
        # endpoint is not a termination date. With two finite rules, scan through
        # the later endpoint while each occurrence generator enforces its own end.
        finite_ends = [
            _validation_end(series)
            for series in (candidate, other)
            if series.end_date is not None or series.occurrence_count is not None
        ]
        last = max(finite_ends)
        if last < date.max:
            # Include a next-day start that may overlap the preceding overnight
            # occurrence at a series boundary.
            last += timedelta(days=1)
    if last < first:
        return False
    left = sorted(intervals(session, candidate, first, last, ignore_exceptions=recurring), key=lambda item: item[0])
    right = sorted(intervals(session, other, first, last, ignore_exceptions=recurring), key=lambda item: item[0])
    left = iter(left)
    right = iter(right)
    a = next(left, None)
    b = next(right, None)
    while a is not None and b is not None:
        if a[0] < b[1] and b[0] < a[1]:
            return True
        if a[1] <= b[0]:
            a = next(left, None)
        else:
            b = next(right, None)
    if not recurring:
        return False

    # Exceptions are finite, even on indefinite series, and may lie beyond the
    # representative Gregorian cycle. Compare each exceptional interval against
    # effective peer occurrences in its adjacent local-date window.
    exception_dates = set()
    for series in (candidate, other):
        exception_dates.update(q.exception_dates_from(session, series.id, max(series.start_date, first)))
    for day in exception_dates:
        window_start = day - timedelta(days=min(2, (day - date.min).days))
        window_end = day + timedelta(days=min(2, (date.max - day).days))
        for changed, peer in ((candidate, other), (other, candidate)):
            if day < changed.start_date:
                continue
            changed_intervals = [item for item in intervals(session, changed, day, day) if item[2] == day]
            peer_intervals = list(intervals(session, peer, window_start, window_end))
            if any(a_start < b_end and b_start < a_end
                   for a_start, a_end, _ in changed_intervals
                   for b_start, b_end, _ in peer_intervals):
                return True
    return False


def _ensure_exceptions_fit_rule(session, series: StaffScheduleSeries, first: date) -> None:
    for exception in q.exceptions_from(session, series.id, first):
        if exception.local_date not in set(occurrence_dates(series, exception.local_date, exception.local_date)):
            raise HttpStatusError(409)


def _ensure_self_no_overlap(session, series: StaffScheduleSeries, first: date) -> None:
    _ensure_exceptions_fit_rule(session, series, first)
    for day in q.exception_dates_from(session, series.id, first):
        window_start = day - timedelta(days=min(2, (day - date.min).days))
        window_end = day + timedelta(days=min(2, (date.max - day).days))
        changed = [item for item in intervals(session, series, day, day) if item[2] == day]
        adjacent = [item for item in intervals(session, series, window_start, window_end) if item[2] != day]
        if any(a_start < b_end and b_start < a_end
               for a_start, a_end, _ in changed
               for b_start, b_end, _ in adjacent):
            raise HttpStatusError(409)


def _ensure_no_overlap(session, candidate: StaffScheduleSeries, exclude: UUID | None = None):
    rows = q.profile_series(session, candidate.profile_id)
    rows = [row for row in rows if row.id not in {candidate.id, exclude}]
    if any(_overlaps(session, candidate, row) for row in rows):
        raise HttpStatusError(409)


def _ensure_occurrence_no_overlap(session, series: StaffScheduleSeries, local_date: date) -> None:
    first = local_date - timedelta(days=min(2, (local_date - date.min).days))
    last = local_date + timedelta(days=min(2, (date.max - local_date).days))
    target = list(intervals(session, series, local_date, local_date))
    if not target:
        raise HttpStatusError(422)
    target_interval = target[0]
    same_series = [item for item in intervals(session, series, first, last) if item[2] != local_date]
    comparisons = same_series
    for peer in q.peer_series(session, series.profile_id, series.id):
        comparisons.extend(intervals(session, peer, first, last))
    if any(target_interval[0] < other[1] and other[0] < target_interval[1] for other in comparisons):
        raise HttpStatusError(409)


def _locked_series(session, series_id: UUID) -> StaffScheduleSeries | None:
    profile_id = q.series_profile_id(session, series_id)
    if profile_id is None:
        return None
    profile = _lock_profile(session, profile_id)
    if profile is None:
        return None
    return q.series_fresh(session, series_id)

def _item(series: StaffScheduleSeries):
    return {"id": str(series.id), "profile_id": str(series.profile_id), "branch_id": str(series.branch_id),
            "start_date": series.start_date.isoformat(), "weekdays": sorted(series.weekdays),
            "start_time": series.start_time.isoformat(), "end_time": series.end_time.isoformat(),
            "end_date": series.end_date.isoformat() if series.end_date else None,
            "occurrence_count": series.occurrence_count,
            "cancelled_from": series.cancelled_from.isoformat() if series.cancelled_from else None}

def create_series(factory, principal: Principal, branch_id: UUID, profile_id: UUID, payload: SeriesCreate):
    with factory.begin() as session:
        branch = _manage(session, principal, branch_id)
        profile = _lock_profile(session, profile_id)
        if profile is not None:
            _revalidate_profile_timezone_rules(session, profile_id)
        if profile is None or profile.branch_id != branch.id:
            raise HttpStatusError(404)
        zone, digest = zone_for_branch(branch)
        series = StaffScheduleSeries(profile_id=profile_id, branch_id=branch_id, start_date=payload.start_date,
                                     weekdays=sorted(payload.weekdays), start_time=payload.start_time, end_time=payload.end_time,
                                     end_date=payload.end_date, occurrence_count=payload.occurrence_count, created_by=principal.staff_id,
                                     timezone_rules_digest=digest)
        session.add(series)
        session.flush()
        _validate_wall_times(session, series, zone)
        _ensure_no_overlap(session, series)
        return _item(series)


def list_series(factory, principal: Principal, branch_id: UUID):
    with factory.begin() as session:
        _read_branch(session, principal, branch_id)
        for profile_id in q.branch_profile_ids(session, branch_id):
            _lock_profile(session, profile_id)
            _revalidate_profile_timezone_rules(session, profile_id)
        return [_item(row) for row in q.branch_series(session, branch_id)]


def list_occurrences(factory, principal: Principal, series_id: UUID, from_date: date, to_date: date):
    if to_date < from_date or (to_date - from_date).days > 366:
        raise HttpStatusError(422)
    with factory.begin() as session:
        series = _locked_series(session, series_id)
        if series is None:
            raise HttpStatusError(404)
        _manage(session, principal, series.branch_id)
        _revalidate_profile_timezone_rules(session, series.profile_id)
        series = q.series_fresh(session, series_id)
        results = []
        exceptions = {row.local_date: row for row in q.exceptions_between(session, series.id, from_date, to_date)}
        branch = q.get_branch(session, series.branch_id)
        for start, end, day in intervals(session, series, from_date, to_date):
            exception = exceptions.get(day)
            start_time = exception.override_start_time if exception else series.start_time
            end_time = exception.override_end_time if exception else series.end_time
            results.append({"series_id": str(series.id), "local_date": day.isoformat(),
                            "local_start": datetime.combine(day, start_time).isoformat(),
                            "local_end": datetime.combine(end_day(day, start_time, end_time), end_time).isoformat(),
                            "starts_at": start.isoformat(), "ends_at": end.isoformat(), "timezone": branch.timezone,
                            "recorded_exception": exception.action if exception else None})
        return results


def edit_occurrence(factory, principal: Principal, series_id: UUID, local_date: date, payload: OccurrenceEdit):
    with factory.begin() as session:
        series = _locked_series(session, series_id)
        if series is None:
            raise HttpStatusError(404)
        _manage(session, principal, series.branch_id)
        _revalidate_profile_timezone_rules(session, series.profile_id)
        series = q.series_fresh(session, series_id)
        if local_date not in set(occurrence_dates(series, local_date, local_date)):
            raise HttpStatusError(404)
        branch = q.get_branch(session, series.branch_id)
        zone = zone_for_branch(branch)[0]
        if local_datetime(local_date, series.start_time, zone) <= datetime.now(zone):
            raise HttpStatusError(422)
        exception = q.get_schedule_exception(session, series.id, local_date)
        if exception is not None:
            raise HttpStatusError(409)
        exception = StaffScheduleException(series_id=series.id, local_date=local_date, action=payload.action,
                                           original_start_time=series.start_time, original_end_time=series.end_time,
                                           override_start_time=payload.start_time, override_end_time=payload.end_time,
                                           recorded_by=principal.staff_id)
        session.add(exception)
        session.flush()
        if payload.action == "override":
            _ensure_occurrence_no_overlap(session, series, local_date)
        return {"series_id": str(series.id), "local_date": local_date.isoformat(), "action": exception.action,
                "original_start_time": exception.original_start_time.isoformat(),
                "original_end_time": exception.original_end_time.isoformat(),
                "override_start_time": exception.override_start_time.isoformat() if exception.override_start_time else None,
                "override_end_time": exception.override_end_time.isoformat() if exception.override_end_time else None,
                "recorded_by": str(exception.recorded_by), "recorded_at": exception.recorded_at.isoformat()}


def edit_series(factory, principal: Principal, series_id: UUID, payload: SeriesEdit):
    with factory.begin() as session:
        old = _locked_series(session, series_id)
        if old is None:
            raise HttpStatusError(404)
        _manage(session, principal, old.branch_id)
        _revalidate_profile_timezone_rules(session, old.profile_id)
        old = q.series_fresh(session, series_id)
        if old.cancelled_from is not None:
            raise HttpStatusError(409)
        branch = q.get_branch(session, old.branch_id)
        zone, digest = zone_for_branch(branch)
        now_local = datetime.now(zone)
        if payload.effective_date < now_local.date():
            raise HttpStatusError(422)
        effective_from = max(now_local.date(), old.start_date) if payload.scope in {"series", "all_future"} else payload.effective_date
        split_day = _next_future_occurrence(old, effective_from, zone, now_local)
        if split_day is None:
            raise HttpStatusError(422)
        original_end_date = old.end_date
        original_count = old.occurrence_count
        edit_fields = payload.model_fields_set
        moved_exceptions = q.exceptions_from(session, old.id, split_day)
        prior_count = sum(1 for _ in occurrence_dates(old, old.start_date, split_day - timedelta(days=1)))
        if prior_count == 0:
            old.start_date = split_day
            old.weekdays = sorted(payload.weekdays if payload.weekdays is not None else old.weekdays)
            old.start_time = payload.start_time or old.start_time
            old.end_time = payload.end_time or old.end_time
            if "end_date" in edit_fields:
                old.end_date = payload.end_date
                old.occurrence_count = payload.occurrence_count if "occurrence_count" in edit_fields else None
            elif "occurrence_count" in edit_fields:
                old.end_date = None
                old.occurrence_count = payload.occurrence_count
            else:
                old.end_date = original_end_date
                old.occurrence_count = original_count
            try:
                validate_rule_values(old.start_date, old.weekdays, old.start_time, old.end_time,
                                      old.end_date, old.occurrence_count)
            except (ValueError, OverflowError):
                raise HttpStatusError(422) from None
            _validate_wall_times(session, old, zone)
            _ensure_self_no_overlap(session, old, split_day)
            _ensure_no_overlap(session, old, exclude=old.id)
            return _item(old)
        if original_count is not None:
            old.occurrence_count = prior_count
            old.end_date = None
            remaining_count = max(1, original_count - prior_count)
        else:
            old.end_date = split_day - timedelta(days=1)
            remaining_count = None
        if "end_date" in edit_fields:
            new_end_date = payload.end_date
            new_count = payload.occurrence_count if "occurrence_count" in edit_fields else None
        elif "occurrence_count" in edit_fields:
            new_end_date = None
            new_count = payload.occurrence_count
        else:
            new_end_date = original_end_date
            new_count = remaining_count
        new_weekdays = sorted(payload.weekdays if payload.weekdays is not None else old.weekdays)
        new_start_time = payload.start_time or old.start_time
        new_end_time = payload.end_time or old.end_time
        try:
            validate_rule_values(split_day, new_weekdays, new_start_time, new_end_time, new_end_date, new_count)
        except (ValueError, OverflowError):
            raise HttpStatusError(422) from None
        new = StaffScheduleSeries(profile_id=old.profile_id, branch_id=old.branch_id, start_date=split_day,
                                  weekdays=new_weekdays, start_time=new_start_time, end_time=new_end_time,
                                  end_date=new_end_date, occurrence_count=new_count, created_by=principal.staff_id,
                                  timezone_rules_digest=digest)
        session.add(new)
        session.flush()
        # Exceptions are append-only: copy them to the new series and leave the originals on the old one.
        for exception in moved_exceptions:
            session.add(StaffScheduleException(
                series_id=new.id, local_date=exception.local_date, action=exception.action,
                original_start_time=exception.original_start_time, original_end_time=exception.original_end_time,
                override_start_time=exception.override_start_time, override_end_time=exception.override_end_time,
                recorded_by=exception.recorded_by, recorded_at=exception.recorded_at))
        session.flush()
        _validate_wall_times(session, new, zone)
        _ensure_self_no_overlap(session, new, split_day)
        _ensure_no_overlap(session, new)
        return _item(new)


def delete_series(factory, principal: Principal, series_id: UUID) -> None:
    with factory.begin() as session:
        series = _locked_series(session, series_id)
        if series is None:
            raise HttpStatusError(404)
        _manage(session, principal, series.branch_id)
        _revalidate_profile_timezone_rules(session, series.profile_id)
        series = q.series_fresh(session, series_id)
        branch = q.get_branch(session, series.branch_id)
        zone = zone_for_branch(branch)[0]
        now_local = datetime.now(zone)
        anchor = _next_future_occurrence(series, max(now_local.date(), series.start_date), zone, now_local)
        if anchor is None:
            return None
        series.cancelled_from = anchor
        return None
