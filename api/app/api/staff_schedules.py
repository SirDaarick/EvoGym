"""Admin-managed weekly employee schedules in branch-local wall time."""
from dataclasses import dataclass
import hashlib
from io import BytesIO
from importlib.resources import files
from pathlib import Path
from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID
from zoneinfo import TZPATH, ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.auth.sessions import validate_session
from app.db.models import Branch, StaffRosterProfile, StaffScheduleException, StaffScheduleSeries

router = APIRouter(prefix="/api/v1/staff-schedules", tags=["staff-schedules"])
_bearer = HTTPBearer(auto_error=False)
MAX_SCHEDULE_SPAN_DAYS = 146096


def _validate_rule_values(start_date: date, weekdays: list[int], start_time: time, end_time: time,
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
            last = _rule_end(probe, date.max)
        except OverflowError:
            raise ValueError("The requested occurrence count exceeds the supported calendar") from None
        if (last - start_date).days > MAX_SCHEDULE_SPAN_DAYS:
            raise ValueError("Finite schedules cannot span more than one complete 400-year recurrence cycle")


@dataclass(frozen=True, slots=True)
class Principal:
    staff_id: UUID
    branch_id: UUID | None
    is_admin: bool


class SeriesCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_date: date
    weekdays: list[int] = Field(min_length=1, max_length=7)
    start_time: time
    end_time: time
    end_date: date | None = None
    occurrence_count: int | None = Field(default=None, ge=1, le=100000)

    @model_validator(mode="after")
    def validate_rule(self):
        _validate_rule_values(self.start_date, self.weekdays, self.start_time, self.end_time,
                              self.end_date, self.occurrence_count)
        return self


class OccurrenceEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str
    start_time: time | None = None
    end_time: time | None = None

    @model_validator(mode="after")
    def validate_edit(self):
        if self.action == "skip":
            if self.start_time is not None or self.end_time is not None:
                raise ValueError("Skipped occurrences cannot include override times")
        elif self.action == "override":
            if self.start_time is None or self.end_time is None:
                raise ValueError("Override requires start_time and end_time")
        else:
            raise ValueError("action must be skip or override")
        if self.start_time is not None and self.start_time.tzinfo is not None:
            raise ValueError("Schedule times must be local wall times without offsets")
        if self.end_time is not None and self.end_time.tzinfo is not None:
            raise ValueError("Schedule times must be local wall times without offsets")
        return self


class SeriesEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    effective_date: date
    scope: str
    weekdays: list[int] | None = Field(default=None, min_length=1, max_length=7)
    start_time: time | None = None
    end_time: time | None = None
    end_date: date | None = None
    occurrence_count: int | None = Field(default=None, ge=1, le=100000)

    @model_validator(mode="after")
    def validate_scope(self):
        if self.scope not in {"this_and_future", "series"}:
            raise ValueError("scope must be this_and_future or series")
        if self.end_date is not None and self.occurrence_count is not None:
            raise ValueError("Choose either end_date or occurrence_count")
        if self.weekdays is not None and (len(set(self.weekdays)) != len(self.weekdays)
                                          or any(day < 0 or day > 6 for day in self.weekdays)):
            raise ValueError("weekdays must contain unique ISO weekday values from 0 to 6")
        if self.start_time is not None and self.start_time.tzinfo is not None:
            raise ValueError("Schedule times must be local wall times without offsets")
        if self.end_time is not None and self.end_time.tzinfo is not None:
            raise ValueError("Schedule times must be local wall times without offsets")
        return self

def _principal(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Principal:
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503, "Database unavailable.")
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")
    if request.app.state.settings.admin_auth_configured:
        try:
            staff_id, _ = validate_admin_session(factory, credentials.credentials)
            return Principal(staff_id, None, True)
        except (AuthorizationDenied, ValueError):
            pass
    try:
        session = validate_session(factory, credentials.credentials, Permission.STAFF_ROSTER_READ)
        return Principal(session.staff_id, session.branch_id, False)
    except (AuthorizationDenied, ValueError):
        raise HTTPException(401, "Authentication failed.") from None


def _lock_profile(session, profile_id: UUID) -> StaffRosterProfile | None:
    return session.scalar(select(StaffRosterProfile).where(StaffRosterProfile.id == profile_id).with_for_update())

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
            raise HTTPException(503, "IANA timezone rule data cannot be loaded.") from None
    digest = hashlib.sha256(data).hexdigest()
    try:
        return ZoneInfo.from_file(BytesIO(data), key=key), digest
    except (ValueError, OSError):
        raise HTTPException(409, "Branch timezone rules are invalid; schedules require revalidation.") from None


def _revalidate_profile_timezone_rules(session, profile_id: UUID) -> None:
    rows = session.scalars(select(StaffScheduleSeries).where(
        StaffScheduleSeries.profile_id == profile_id
    ).order_by(StaffScheduleSeries.id)).all()
    current = {}
    stale = []
    for series in rows:
        branch = session.get(Branch, series.branch_id)
        zone, digest = _load_zone(branch.timezone)
        current[series.id] = (zone, digest)
        if series.timezone_rules_digest != digest:
            stale.append(series)
    for series in stale:
        try:
            _validate_wall_times(session, series, current[series.id][0], status_code=409)
        except HTTPException:
            raise
        for other in rows:
            if other.id != series.id and _overlaps(session, series, other):
                raise HTTPException(409, "Timezone rules changed and created a schedule overlap; schedules require correction.")
        series.timezone_rules_digest = current[series.id][1]


def _zone_for_branch(branch: Branch) -> tuple[ZoneInfo, str]:
    try:
        return _load_zone(branch.timezone)
    except HTTPException:
        raise
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(503, "IANA timezone rule data cannot be fingerprinted.") from None


def _manage(session, principal: Principal, branch_id: UUID) -> Branch:
    try:
        authorize(session, principal.staff_id, Permission.STAFF_ROSTER_MANAGE, branch_id)
    except AuthorizationDenied:
        raise HTTPException(403, "Schedule management is restricted to Admin.") from None
    branch = session.get(Branch, branch_id)
    if branch is None or not branch.is_active:
        raise HTTPException(404, "Branch not found.")
    return branch


def _local_datetime(day: date, at: time, zone: ZoneInfo) -> datetime:
    naive = datetime.combine(day, at)
    local = naive.replace(tzinfo=zone, fold=0)
    # A nonexistent wall time does not round-trip through the current IANA rules.
    if local.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != naive:
        raise ValueError("The local schedule time does not exist under the branch timezone rules")
    return local


def _end_day(day: date, start: time, end: time) -> date:
    if end <= start:
        if day == date.max:
            raise ValueError("An overnight schedule cannot end beyond the supported calendar")
        return day + timedelta(days=1)
    return day


def _occurrence_dates(series: StaffScheduleSeries, first: date, last: date):
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
    count = sum(_weekday_occurrences(series.start_date, prior_day, day) for day in weekdays) if prior_day else 0
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


def _weekday_occurrences(first: date, last: date, weekday: int) -> int:
    if last < first:
        return 0
    delta = (weekday - first.weekday()) % 7
    if first > date.max - timedelta(days=delta):
        return 0
    first_match = first + timedelta(days=delta)
    return 0 if first_match > last else (last - first_match).days // 7 + 1


def _rule_end(series: StaffScheduleSeries, horizon: date) -> date:
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


def _intervals(session, series: StaffScheduleSeries, first: date, last: date, *, zone: ZoneInfo | None = None,
               ignore_exceptions: bool = False):
    branch = session.get(Branch, series.branch_id)
    zone = zone or _zone_for_branch(branch)[0]
    exceptions = {row.local_date: row for row in session.scalars(select(StaffScheduleException).where(
        StaffScheduleException.series_id == series.id,
        StaffScheduleException.local_date >= first,
        StaffScheduleException.local_date <= last,
    )).all()}
    if ignore_exceptions:
        exceptions = {}
    for day in _occurrence_dates(series, first, last):
        exception = exceptions.get(day)
        if exception is not None and exception.action == "skip":
            continue
        start = exception.override_start_time if exception else series.start_time
        end = exception.override_end_time if exception else series.end_time
        try:
            start_dt = _local_datetime(day, start, zone)
            end_dt = _local_datetime(_end_day(day, start, end), end, zone)
        except (ValueError, OverflowError) as exc:
            raise HTTPException(422, str(exc)) from None
        yield start_dt.astimezone(timezone.utc), end_dt.astimezone(timezone.utc), day


def _validation_end(series: StaffScheduleSeries) -> date:
    if series.end_date is not None:
        return series.end_date
    if series.occurrence_count is not None:
        try:
            return _rule_end(series, date.max)
        except OverflowError:
            raise HTTPException(422, "The requested occurrence count exceeds the supported calendar.") from None
    # Every supported weekly rule is evaluated over one complete Gregorian cycle.
    # The endpoint is rejected if that cycle cannot be represented by date.
    delta = timedelta(days=MAX_SCHEDULE_SPAN_DAYS)
    if series.start_date > date.max - delta:
        raise HTTPException(422, "Indefinite schedules must start early enough for the complete recurrence cycle.")
    cycle_end = series.start_date + delta
    return min(_rule_end(series, cycle_end), cycle_end)


def _validate_wall_times(session, series: StaffScheduleSeries, zone: ZoneInfo, *, status_code: int = 422) -> None:
    try:
        end = _validation_end(series)
        exceptions = {row.local_date: row for row in session.scalars(select(StaffScheduleException).where(
            StaffScheduleException.series_id == series.id,
            StaffScheduleException.local_date >= series.start_date,
        )).all()}
        for day in _occurrence_dates(series, series.start_date, end):
            exception = exceptions.get(day)
            if exception is not None and exception.action == "skip":
                continue
            start_time = exception.override_start_time if exception else series.start_time
            end_time = exception.override_end_time if exception else series.end_time
            _local_datetime(day, start_time, zone)
            _local_datetime(_end_day(day, start_time, end_time), end_time, zone)
        # The 400-year endpoint is a recurring-baseline proof bound, not the
        # validity limit for finite exceptions stored on an indefinite series.
        for day, exception in exceptions.items():
            if day <= end or exception.action == "skip":
                continue
            if day not in set(_occurrence_dates(series, day, day)):
                continue
            start_time = exception.override_start_time
            end_time = exception.override_end_time
            _local_datetime(day, start_time, zone)
            _local_datetime(_end_day(day, start_time, end_time), end_time, zone)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(status_code, str(exc)) from None


def _overlaps(session, candidate: StaffScheduleSeries, other: StaffScheduleSeries) -> bool:
    first = max(candidate.start_date, other.start_date)
    if first > date.min:
        first -= timedelta(days=1)
    recurring = candidate.end_date is None and other.end_date is None and candidate.occurrence_count is None and other.occurrence_count is None
    if recurring:
        # Weekly weekdays and the Gregorian/IANA recurring timezone rules repeat
        # within the full 400-year Gregorian cycle; this is not a short lookahead.
        if first > date.max - timedelta(days=146096):
            raise HTTPException(422, "Indefinite schedules must start early enough for the complete recurrence cycle.")
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
    left = sorted(_intervals(session, candidate, first, last, ignore_exceptions=recurring), key=lambda item: item[0])
    right = sorted(_intervals(session, other, first, last, ignore_exceptions=recurring), key=lambda item: item[0])
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
        exception_dates.update(session.scalars(select(StaffScheduleException.local_date).where(
            StaffScheduleException.series_id == series.id,
            StaffScheduleException.local_date >= series.start_date,
            StaffScheduleException.local_date >= first,
        )).all())
    for day in exception_dates:
        window_start = day - timedelta(days=min(2, (day - date.min).days))
        window_end = day + timedelta(days=min(2, (date.max - day).days))
        for changed, peer in ((candidate, other), (other, candidate)):
            if day < changed.start_date:
                continue
            changed_intervals = [item for item in _intervals(session, changed, day, day) if item[2] == day]
            peer_intervals = list(_intervals(session, peer, window_start, window_end))
            if any(a_start < b_end and b_start < a_end
                   for a_start, a_end, _ in changed_intervals
                   for b_start, b_end, _ in peer_intervals):
                return True
    return False


def _ensure_exceptions_fit_rule(session, series: StaffScheduleSeries, first: date) -> None:
    exceptions = session.scalars(select(StaffScheduleException).where(
        StaffScheduleException.series_id == series.id,
        StaffScheduleException.local_date >= first,
    )).all()
    for exception in exceptions:
        if exception.local_date not in set(_occurrence_dates(series, exception.local_date, exception.local_date)):
            raise HTTPException(409, "The edit would orphan a retained occurrence exception.")


def _ensure_self_no_overlap(session, series: StaffScheduleSeries, first: date) -> None:
    _ensure_exceptions_fit_rule(session, series, first)
    exceptions = session.scalars(select(StaffScheduleException.local_date).where(
        StaffScheduleException.series_id == series.id,
        StaffScheduleException.local_date >= first,
    )).all()
    for day in exceptions:
        window_start = day - timedelta(days=min(2, (day - date.min).days))
        window_end = day + timedelta(days=min(2, (date.max - day).days))
        changed = [item for item in _intervals(session, series, day, day) if item[2] == day]
        adjacent = [item for item in _intervals(session, series, window_start, window_end) if item[2] != day]
        if any(a_start < b_end and b_start < a_end
               for a_start, a_end, _ in changed
               for b_start, b_end, _ in adjacent):
            raise HTTPException(409, "The edit makes an occurrence exception overlap another shift in the series.")


def _ensure_no_overlap(session, candidate: StaffScheduleSeries, exclude: UUID | None = None):
    rows = session.scalars(select(StaffScheduleSeries).where(StaffScheduleSeries.profile_id == candidate.profile_id)).all()
    rows = [row for row in rows if row.id not in {candidate.id, exclude}]
    if any(_overlaps(session, candidate, row) for row in rows):
        raise HTTPException(409, "This schedule overlaps another schedule for the employee.")


def _ensure_occurrence_no_overlap(session, series: StaffScheduleSeries, local_date: date) -> None:
    first = local_date - timedelta(days=min(2, (local_date - date.min).days))
    last = local_date + timedelta(days=min(2, (date.max - local_date).days))
    target = list(_intervals(session, series, local_date, local_date))
    if not target:
        raise HTTPException(422, "The edited schedule occurrence is not valid under the branch timezone rules.")
    target_interval = target[0]
    same_series = [item for item in _intervals(session, series, first, last) if item[2] != local_date]
    peers = session.scalars(select(StaffScheduleSeries).where(
        StaffScheduleSeries.profile_id == series.profile_id,
        StaffScheduleSeries.id != series.id,
    )).all()
    comparisons = same_series
    for peer in peers:
        comparisons.extend(_intervals(session, peer, first, last))
    if any(target_interval[0] < other[1] and other[0] < target_interval[1] for other in comparisons):
        raise HTTPException(409, "This occurrence overlaps another scheduled shift.")


def _locked_series(session, series_id: UUID) -> StaffScheduleSeries | None:
    profile_id = session.scalar(select(StaffScheduleSeries.profile_id).where(StaffScheduleSeries.id == series_id))
    if profile_id is None:
        return None
    profile = _lock_profile(session, profile_id)
    if profile is None:
        return None
    return session.scalar(select(StaffScheduleSeries).where(
        StaffScheduleSeries.id == series_id
    ).execution_options(populate_existing=True))

def _item(series: StaffScheduleSeries):
    return {"id": str(series.id), "profile_id": str(series.profile_id), "branch_id": str(series.branch_id),
            "start_date": series.start_date.isoformat(), "weekdays": sorted(series.weekdays),
            "start_time": series.start_time.isoformat(), "end_time": series.end_time.isoformat(),
            "end_date": series.end_date.isoformat() if series.end_date else None,
            "occurrence_count": series.occurrence_count,
            "cancelled_from": series.cancelled_from.isoformat() if series.cancelled_from else None}


@router.post("/branches/{branch_id}/profiles/{profile_id}", status_code=201)
def create_series(branch_id: UUID, profile_id: UUID, payload: SeriesCreate, request: Request,
                  principal: Principal = Depends(_principal)):
    factory = request.app.state.session_factory
    with factory.begin() as session:
        branch = _manage(session, principal, branch_id)
        profile = _lock_profile(session, profile_id)
        if profile is not None:
            _revalidate_profile_timezone_rules(session, profile_id)
        if profile is None or profile.branch_id != branch.id:
            raise HTTPException(404, "Staff profile not found.")
        zone, digest = _zone_for_branch(branch)
        series = StaffScheduleSeries(profile_id=profile_id, branch_id=branch_id, start_date=payload.start_date,
                                     weekdays=sorted(payload.weekdays), start_time=payload.start_time, end_time=payload.end_time,
                                     end_date=payload.end_date, occurrence_count=payload.occurrence_count, created_by=principal.staff_id,
                                     timezone_rules_digest=digest)
        session.add(series)
        session.flush()
        _validate_wall_times(session, series, zone)
        _ensure_no_overlap(session, series)
        return _item(series)


@router.get("/branches/{branch_id}")
def list_series(branch_id: UUID, request: Request, principal: Principal = Depends(_principal)):
    factory = request.app.state.session_factory
    with factory.begin() as session:
        _manage(session, principal, branch_id)
        for profile_id in session.scalars(select(StaffRosterProfile.id).where(StaffRosterProfile.branch_id == branch_id)).all():
            _lock_profile(session, profile_id)
            _revalidate_profile_timezone_rules(session, profile_id)
        return [_item(row) for row in session.scalars(select(StaffScheduleSeries).where(
            StaffScheduleSeries.branch_id == branch_id).order_by(StaffScheduleSeries.start_date, StaffScheduleSeries.id)).all()]


@router.get("/{series_id}/occurrences")
def list_occurrences(series_id: UUID, request: Request, from_date: date = Query(), to_date: date = Query(),
                     principal: Principal = Depends(_principal)):
    if to_date < from_date or (to_date - from_date).days > 366:
        raise HTTPException(422, "Occurrence query range must be between 0 and 366 days.")
    factory = request.app.state.session_factory
    with factory.begin() as session:
        series = _locked_series(session, series_id)
        if series is None:
            raise HTTPException(404, "Schedule not found.")
        _manage(session, principal, series.branch_id)
        _revalidate_profile_timezone_rules(session, series.profile_id)
        series = session.scalar(select(StaffScheduleSeries).where(
            StaffScheduleSeries.id == series_id
        ).execution_options(populate_existing=True))
        results = []
        for start, end, day in _intervals(session, series, from_date, to_date):
            exception = session.scalar(select(StaffScheduleException).where(StaffScheduleException.series_id == series.id,
                                                                           StaffScheduleException.local_date == day))
            start_time = exception.override_start_time if exception else series.start_time
            end_time = exception.override_end_time if exception else series.end_time
            branch = session.get(Branch, series.branch_id)
            results.append({"series_id": str(series.id), "local_date": day.isoformat(),
                            "local_start": datetime.combine(day, start_time).isoformat(),
                            "local_end": datetime.combine(_end_day(day, start_time, end_time), end_time).isoformat(),
                            "starts_at": start.isoformat(), "ends_at": end.isoformat(), "timezone": branch.timezone,
                            "recorded_exception": exception.action if exception else None})
        return results


@router.put("/{series_id}/occurrences/{local_date}")
def edit_occurrence(series_id: UUID, local_date: date, payload: OccurrenceEdit, request: Request,
                    principal: Principal = Depends(_principal)):
    factory = request.app.state.session_factory
    with factory.begin() as session:
        series = _locked_series(session, series_id)
        if series is None:
            raise HTTPException(404, "Schedule not found.")
        _manage(session, principal, series.branch_id)
        _revalidate_profile_timezone_rules(session, series.profile_id)
        series = session.scalar(select(StaffScheduleSeries).where(
            StaffScheduleSeries.id == series_id
        ).execution_options(populate_existing=True))
        if local_date not in set(_occurrence_dates(series, local_date, local_date)):
            raise HTTPException(404, "Schedule occurrence not found.")
        branch = session.get(Branch, series.branch_id)
        zone = _zone_for_branch(branch)[0]
        if _local_datetime(local_date, series.start_time, zone) <= datetime.now(zone):
            raise HTTPException(422, "Only future occurrences can be edited.")
        exception = session.scalar(select(StaffScheduleException).where(StaffScheduleException.series_id == series.id,
                                                                         StaffScheduleException.local_date == local_date))
        if exception is not None:
            raise HTTPException(409, "Occurrence already has a retained exception.")
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


@router.patch("/{series_id}/edit", status_code=201)
def edit_series(series_id: UUID, payload: SeriesEdit, request: Request, principal: Principal = Depends(_principal)):
    factory = request.app.state.session_factory
    with factory.begin() as session:
        old = _locked_series(session, series_id)
        if old is None:
            raise HTTPException(404, "Schedule not found.")
        _manage(session, principal, old.branch_id)
        _revalidate_profile_timezone_rules(session, old.profile_id)
        old = session.scalar(select(StaffScheduleSeries).where(
            StaffScheduleSeries.id == series_id
        ).execution_options(populate_existing=True))
        if old.cancelled_from is not None:
            raise HTTPException(409, "Cancelled schedules cannot be edited.")
        branch = session.get(Branch, old.branch_id)
        zone, _digest = _zone_for_branch(branch)
        now_local = datetime.now(zone)
        if payload.effective_date < now_local.date():
            raise HTTPException(422, "Series edits must start on a future local date.")
        effective_from = max(now_local.date(), old.start_date) if payload.scope == "series" else payload.effective_date
        search_end = date.max if effective_from > date.max - timedelta(days=13) else effective_from + timedelta(days=13)
        split_day = next((
            day for day in _occurrence_dates(old, effective_from, search_end)
            if _local_datetime(day, old.start_time, zone) > now_local
        ), None)
        if split_day is None:
            raise HTTPException(422, "No future scheduled occurrence exists within two weeks.")
        original_end_date = old.end_date
        original_count = old.occurrence_count
        edit_fields = payload.model_fields_set
        moved_exceptions = session.scalars(select(StaffScheduleException).where(StaffScheduleException.series_id == old.id,
                                                                                  StaffScheduleException.local_date >= split_day)).all()
        prior_count = sum(1 for _ in _occurrence_dates(old, old.start_date, split_day - timedelta(days=1)))
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
                _validate_rule_values(old.start_date, old.weekdays, old.start_time, old.end_time,
                                      old.end_date, old.occurrence_count)
            except (ValueError, OverflowError) as exc:
                raise HTTPException(422, str(exc)) from None
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
            _validate_rule_values(split_day, new_weekdays, new_start_time, new_end_time, new_end_date, new_count)
        except (ValueError, OverflowError) as exc:
            raise HTTPException(422, str(exc)) from None
        _zone, digest = _zone_for_branch(branch)
        new = StaffScheduleSeries(profile_id=old.profile_id, branch_id=old.branch_id, start_date=split_day,
                                  weekdays=new_weekdays, start_time=new_start_time, end_time=new_end_time,
                                  end_date=new_end_date, occurrence_count=new_count, created_by=principal.staff_id,
                                  timezone_rules_digest=digest)
        session.add(new)
        session.flush()
        for exception in moved_exceptions:
            exception.series_id = new.id
        session.flush()
        _validate_wall_times(session, new, _zone)
        _ensure_self_no_overlap(session, new, split_day)
        _ensure_no_overlap(session, new)
        return _item(new)


@router.delete("/{series_id}", status_code=204)
def delete_series(series_id: UUID, request: Request, principal: Principal = Depends(_principal)):
    factory = request.app.state.session_factory
    with factory.begin() as session:
        series = _locked_series(session, series_id)
        if series is None:
            raise HTTPException(404, "Schedule not found.")
        _manage(session, principal, series.branch_id)
        _revalidate_profile_timezone_rules(session, series.profile_id)
        series = session.scalar(select(StaffScheduleSeries).where(
            StaffScheduleSeries.id == series_id
        ).execution_options(populate_existing=True))
        branch = session.get(Branch, series.branch_id)
        zone = _zone_for_branch(branch)[0]
        now_local = datetime.now(zone)
        try:
            search_end = _validation_end(series)
        except HTTPException:
            raise
        anchor = None
        for day in _occurrence_dates(series, max(now_local.date(), series.start_date), search_end):
            occurrence = _local_datetime(day, series.start_time, zone)
            if occurrence > now_local:
                anchor = day
                break
        if anchor is None:
            return None
        series.cancelled_from = anchor
        return None



















