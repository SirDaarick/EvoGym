"""Branch-scoped, append-only affirmative staff-attendance records."""
from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.staff_roster import RosterPrincipal, _allowed_branches, _principal
from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.db.models import Branch, StaffAttendanceCheckout, StaffAttendanceRecord, StaffRosterProfile

router = APIRouter(prefix="/api/v1/staff-attendance", tags=["staff-attendance"])


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class StaffAttendanceItem(BaseModel):
    id: UUID
    profile_id: UUID
    branch_id: UUID
    full_name: str
    position: str
    recorded_by: UUID
    occurred_at: datetime
    business_date: date
    status: str | None = None
    expected_entry_time: time | None = None
    grace_tolerance_minutes: int | None = None
    checkout_at: datetime | None = None
    checkout_recorded_by: UUID | None = None


class StaffAttendanceCheckoutItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    attendance_id: UUID
    recorded_by: UUID
    occurred_at: datetime


def _checkout_item(checkout: StaffAttendanceCheckout) -> StaffAttendanceCheckoutItem:
    occurred_at = checkout.occurred_at
    if occurred_at.tzinfo is None:
        occurred_at = occurred_at.replace(tzinfo=timezone.utc)
    return StaffAttendanceCheckoutItem(id=checkout.id, attendance_id=checkout.attendance_id,
                                       recorded_by=checkout.recorded_by, occurred_at=occurred_at.astimezone(timezone.utc))


class StaffAttendancePage(BaseModel):
    items: list[StaffAttendanceItem]
    total: int


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise HTTPException(500, "Server clock must return a timezone-aware timestamp.")
    return value.astimezone(timezone.utc)


def _item(record: StaffAttendanceRecord, profile: StaffRosterProfile, checkout: StaffAttendanceCheckout | None = None) -> StaffAttendanceItem:
    occurred_at = record.occurred_at
    if occurred_at.tzinfo is None:
        occurred_at = occurred_at.replace(tzinfo=timezone.utc)
    return StaffAttendanceItem(
        id=record.id,
        profile_id=record.profile_id,
        branch_id=record.branch_id,
        full_name=profile.full_name,
        position=profile.position,
        recorded_by=record.recorded_by,
        occurred_at=occurred_at.astimezone(timezone.utc),
        business_date=record.business_date,
        status=record.status,
        expected_entry_time=record.expected_entry_time,
        grace_tolerance_minutes=record.grace_tolerance_minutes,
        checkout_at=(checkout.occurred_at.replace(tzinfo=timezone.utc) if checkout and checkout.occurred_at.tzinfo is None else checkout.occurred_at.astimezone(timezone.utc) if checkout else None),
        checkout_recorded_by=checkout.recorded_by if checkout else None,
    )


def _recorder_branch(session, principal: RosterPrincipal, branch_id: UUID) -> Branch:
    if principal.branch_id is not None and principal.branch_id != branch_id:
        raise HTTPException(404, "Branch not found.")
    try:
        authorize(session, principal.staff_id, Permission.STAFF_ATTENDANCE_RECORD, branch_id)
    except AuthorizationDenied:
        raise HTTPException(403, "Attendance recording is restricted to reception staff.") from None
    branch = session.get(Branch, branch_id)
    if branch is None or not branch.is_active:
        raise HTTPException(404, "Branch not found.")
    return branch


def _existing_record(session, branch_id: UUID, profile_id: UUID, business_date: date):
    return session.scalar(select(StaffAttendanceRecord).where(
        StaffAttendanceRecord.branch_id == branch_id,
        StaffAttendanceRecord.profile_id == profile_id,
        StaffAttendanceRecord.business_date == business_date,
    ))


@router.get("", response_model=StaffAttendancePage)
def list_staff_attendance(
    request: Request,
    branch_id: UUID | None = Query(default=None),
    business_date: date | None = Query(default=None),
    offset: int = Query(default=0, ge=0, le=2**63 - 1),
    limit: int = Query(default=50, ge=1, le=100),
    principal: RosterPrincipal = Depends(_principal),
):
    factory = request.app.state.session_factory
    with factory() as session:
        branches = _allowed_branches(session, principal, branch_id)
        branch_ids = [branch.id for branch in branches]
        query = (
            select(StaffAttendanceRecord, StaffRosterProfile)
            .join(StaffRosterProfile, StaffRosterProfile.id == StaffAttendanceRecord.profile_id)
            .where(StaffAttendanceRecord.branch_id.in_(branch_ids))
        )
        count_query = select(func.count()).select_from(StaffAttendanceRecord).where(
            StaffAttendanceRecord.branch_id.in_(branch_ids)
        )
        if business_date is not None:
            query = query.where(StaffAttendanceRecord.business_date == business_date)
            count_query = count_query.where(StaffAttendanceRecord.business_date == business_date)
        rows = session.execute(query.order_by(
            StaffAttendanceRecord.business_date.desc(), StaffAttendanceRecord.occurred_at.desc(),
            StaffAttendanceRecord.id,
        ).offset(offset).limit(limit)).all() if branch_ids else []
        total = session.scalar(count_query) if branch_ids else 0
        return StaffAttendancePage(items=[_item(record, profile, session.scalar(select(StaffAttendanceCheckout).where(StaffAttendanceCheckout.attendance_id == record.id))) for record, profile in rows], total=total)


@router.post("/branches/{branch_id}/profiles/{profile_id}", response_model=StaffAttendanceItem, status_code=201)
def record_staff_attendance(
    branch_id: UUID,
    profile_id: UUID,
    request: Request,
    response: Response,
    principal: RosterPrincipal = Depends(_principal),
):
    factory = request.app.state.session_factory
    try:
        with factory.begin() as session:
            branch = _recorder_branch(session, principal, branch_id)
            profile = session.get(StaffRosterProfile, profile_id)
            if profile is None or profile.branch_id != branch.id:
                raise HTTPException(404, "Staff profile not found.")
            observed_at = _utc(utc_now())
            business_date = observed_at.astimezone(ZoneInfo(branch.timezone)).date()
            existing = _existing_record(session, branch.id, profile.id, business_date)
            if existing is not None:
                response.status_code = 200
                return _item(existing, profile)
            if not profile.is_active:
                raise HTTPException(409, "Inactive staff cannot be marked for attendance.")
            if profile.expected_entry_time is None or profile.grace_tolerance_minutes is None:
                raise HTTPException(409, "A complete staff entry schedule is required before attendance can be recorded.")
            local_time = observed_at.astimezone(ZoneInfo(branch.timezone))
            cutoff = datetime.combine(local_time.date(), profile.expected_entry_time) + timedelta(minutes=profile.grace_tolerance_minutes)
            status = "present" if local_time.replace(tzinfo=None) <= cutoff else "late"
            record = StaffAttendanceRecord(
                branch_id=branch.id,
                profile_id=profile.id,
                recorded_by=principal.staff_id,
                occurred_at=observed_at,
                business_date=business_date,
                status=status,
                expected_entry_time=profile.expected_entry_time,
                grace_tolerance_minutes=profile.grace_tolerance_minutes,
            )
            try:
                with session.begin_nested():
                    session.add(record)
                    session.flush()
            except IntegrityError:
                existing = _existing_record(session, branch.id, profile.id, business_date)
                if existing is None:
                    raise
                response.status_code = 200
                return _item(existing, profile)
            return _item(record, profile)
    except IntegrityError as exc:
        if "uq_staff_attendance_branch_profile_date" not in str(exc.orig):
            raise
        raise HTTPException(409, "Attendance already exists for this employee and branch date.") from None


@router.post("/{attendance_id}/checkout", response_model=StaffAttendanceCheckoutItem, status_code=201)
def record_staff_checkout(attendance_id: UUID, request: Request, response: Response,
                          principal: RosterPrincipal = Depends(_principal)):
    factory = request.app.state.session_factory
    try:
        with factory.begin() as session:
            record = session.get(StaffAttendanceRecord, attendance_id)
            if record is None:
                raise HTTPException(404, "Attendance entry not found.")
            _recorder_branch(session, principal, record.branch_id)
            existing = session.scalar(select(StaffAttendanceCheckout).where(StaffAttendanceCheckout.attendance_id == record.id))
            if existing is not None:
                response.status_code = 200
                return _checkout_item(existing)
            occurred_at = _utc(utc_now())
            entry_at = record.occurred_at
            if entry_at.tzinfo is None:
                entry_at = entry_at.replace(tzinfo=timezone.utc)
            if occurred_at < entry_at:
                raise HTTPException(422, "Checkout cannot occur before its attendance entry.")
            checkout = StaffAttendanceCheckout(attendance_id=record.id, recorded_by=principal.staff_id, occurred_at=occurred_at)
            try:
                with session.begin_nested():
                    session.add(checkout)
                    session.flush()
            except IntegrityError:
                existing = session.scalar(select(StaffAttendanceCheckout).where(StaffAttendanceCheckout.attendance_id == record.id))
                if existing is None:
                    raise
                response.status_code = 200
                return _checkout_item(existing)
            return _checkout_item(checkout)
    except IntegrityError:
        raise HTTPException(409, "Checkout could not be recorded.") from None
