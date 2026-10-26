"""Branch-scoped, append-only affirmative staff-attendance records."""
from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.staff_roster import RosterPrincipal, _allowed_branches, _principal
from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.db.models import (
    Branch,
    StaffAttendanceCheckout,
    StaffAttendanceRecord,
    StaffRosterProfile,
    StaffScheduleException,
    StaffScheduleSeries,
)
from app.db.models.staff_attendance import StaffAttendanceCorrection

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

    # STAFF-2 / P6.2 / P6.3 fields
    series_id: UUID | None = None
    occurrence_date: date | None = None
    device_captured_at: datetime | None = None
    server_received_at: datetime | None = None
    idempotency_key: str | None = None
    scheduled_start_time: time | None = None
    scheduled_end_time: time | None = None
    clock_skew_seconds: int | None = None
    clock_validation_status: str = "trusted"
    review_required: bool = False
    schedule_conflict: bool = False


class StaffAttendanceCheckoutItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    attendance_id: UUID
    recorded_by: UUID
    occurred_at: datetime


class StaffAttendanceCorrectionItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    attendance_id: UUID
    corrected_by: UUID
    field_name: str
    original_value: str
    corrected_value: str
    reason: str
    corrected_at: datetime


class StaffAttendanceCreateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    series_id: UUID | None = None
    occurrence_date: date | None = None
    device_captured_at: datetime | None = None
    idempotency_key: str | None = None


class StaffAttendanceCorrectionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    field_name: str = Field(min_length=1, max_length=32)
    corrected_value: str = Field(min_length=1, max_length=255)
    reason: str = Field(min_length=5, max_length=255)
    original_value: str | None = None


class StaffCheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    device_captured_at: datetime | None = None
    idempotency_key: str | None = None


class StaffAttendancePage(BaseModel):
    items: list[StaffAttendanceItem]
    total: int


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise HTTPException(422, "Timestamp must be timezone-aware UTC.")
    return value.astimezone(timezone.utc)


def _checkout_item(checkout: StaffAttendanceCheckout) -> StaffAttendanceCheckoutItem:
    occurred_at = checkout.occurred_at
    if occurred_at.tzinfo is None:
        occurred_at = occurred_at.replace(tzinfo=timezone.utc)
    return StaffAttendanceCheckoutItem(
        id=checkout.id,
        attendance_id=checkout.attendance_id,
        recorded_by=checkout.recorded_by,
        occurred_at=occurred_at.astimezone(timezone.utc),
    )


def _correction_item(correction: StaffAttendanceCorrection) -> StaffAttendanceCorrectionItem:
    corrected_at = correction.corrected_at
    if corrected_at.tzinfo is None:
        corrected_at = corrected_at.replace(tzinfo=timezone.utc)
    return StaffAttendanceCorrectionItem(
        id=correction.id,
        attendance_id=correction.attendance_id,
        corrected_by=correction.corrected_by,
        field_name=correction.field_name,
        original_value=correction.original_value,
        corrected_value=correction.corrected_value,
        reason=correction.reason,
        corrected_at=corrected_at.astimezone(timezone.utc),
    )


def _item(
    record: StaffAttendanceRecord,
    profile: StaffRosterProfile,
    checkout: StaffAttendanceCheckout | None = None,
) -> StaffAttendanceItem:
    occurred_at = record.occurred_at
    if occurred_at.tzinfo is None:
        occurred_at = occurred_at.replace(tzinfo=timezone.utc)

    device_captured_at = record.device_captured_at
    if device_captured_at is not None and device_captured_at.tzinfo is None:
        device_captured_at = device_captured_at.replace(tzinfo=timezone.utc)

    server_received_at = record.server_received_at
    if server_received_at is not None and server_received_at.tzinfo is None:
        server_received_at = server_received_at.replace(tzinfo=timezone.utc)

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
        checkout_at=(
            checkout.occurred_at.replace(tzinfo=timezone.utc)
            if checkout and checkout.occurred_at.tzinfo is None
            else checkout.occurred_at.astimezone(timezone.utc)
            if checkout
            else None
        ),
        checkout_recorded_by=checkout.recorded_by if checkout else None,
        series_id=record.series_id,
        occurrence_date=record.occurrence_date,
        device_captured_at=device_captured_at.astimezone(timezone.utc) if device_captured_at else occurred_at.astimezone(timezone.utc),
        server_received_at=server_received_at.astimezone(timezone.utc) if server_received_at else occurred_at.astimezone(timezone.utc),
        idempotency_key=record.idempotency_key,
        scheduled_start_time=record.scheduled_start_time,
        scheduled_end_time=record.scheduled_end_time,
        clock_skew_seconds=record.clock_skew_seconds,
        clock_validation_status=record.clock_validation_status or "trusted",
        review_required=bool(record.review_required),
        schedule_conflict=bool(record.schedule_conflict),
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
    return session.scalar(
        select(StaffAttendanceRecord).where(
            StaffAttendanceRecord.branch_id == branch_id,
            StaffAttendanceRecord.profile_id == profile_id,
            StaffAttendanceRecord.business_date == business_date,
            StaffAttendanceRecord.series_id.is_(None),
        )
    )


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
        rows = (
            session.execute(
                query.order_by(
                    StaffAttendanceRecord.business_date.desc(),
                    StaffAttendanceRecord.occurred_at.desc(),
                    StaffAttendanceRecord.id,
                )
                .offset(offset)
                .limit(limit)
            ).all()
            if branch_ids
            else []
        )
        total = session.scalar(count_query) if branch_ids else 0
        checkouts = (
            session.scalars(
                select(StaffAttendanceCheckout).where(
                    StaffAttendanceCheckout.attendance_id.in_([record.id for record, _profile in rows])
                )
            ).all()
            if rows
            else []
        )
        checkouts_by_attendance_id = {checkout.attendance_id: checkout for checkout in checkouts}
        return StaffAttendancePage(
            items=[
                _item(record, profile, checkouts_by_attendance_id.get(record.id))
                for record, profile in rows
            ],
            total=total,
        )


@router.post("/branches/{branch_id}/profiles/{profile_id}", response_model=StaffAttendanceItem, status_code=201)
def record_staff_attendance(
    branch_id: UUID,
    profile_id: UUID,
    request: Request,
    response: Response,
    payload: StaffAttendanceCreateRequest | None = None,
    series_id: UUID | None = Query(default=None),
    occurrence_date: date | None = Query(default=None),
    device_captured_at: datetime | None = Query(default=None),
    idempotency_key: str | None = Query(default=None),
    principal: RosterPrincipal = Depends(_principal),
):
    factory = request.app.state.session_factory
    try:
        with factory.begin() as session:
            branch = _recorder_branch(session, principal, branch_id)
            profile = session.get(StaffRosterProfile, profile_id)
            if profile is None or profile.branch_id != branch.id:
                raise HTTPException(404, "Staff profile not found.")

            # Resolve effective input parameters from body or query
            eff_series_id = payload.series_id if (payload and payload.series_id is not None) else series_id
            eff_occurrence_date = payload.occurrence_date if (payload and payload.occurrence_date is not None) else occurrence_date
            eff_device_captured_at = payload.device_captured_at if (payload and payload.device_captured_at is not None) else device_captured_at
            eff_idempotency_key = payload.idempotency_key if (payload and payload.idempotency_key is not None) else idempotency_key

            server_received_at = _utc(utc_now())

            if eff_device_captured_at is not None:
                if eff_device_captured_at.tzinfo is None or eff_device_captured_at.utcoffset() is None:
                    raise HTTPException(422, "device_captured_at must be an explicit UTC timestamp.")
                device_time = eff_device_captured_at.astimezone(timezone.utc)
                skew_seconds = int((server_received_at - device_time).total_seconds())
                abs_skew = abs(skew_seconds)
                clock_skew_seconds = skew_seconds
                if abs_skew > 300:
                    clock_validation_status = "review_required"
                    clock_review_flag = True
                else:
                    clock_validation_status = "trusted"
                    clock_review_flag = False
            else:
                device_time = server_received_at
                clock_skew_seconds = 0
                clock_validation_status = "trusted"
                clock_review_flag = False

            if eff_occurrence_date is not None:
                business_date = eff_occurrence_date
                occ_date = eff_occurrence_date
            else:
                business_date = device_time.astimezone(ZoneInfo(branch.timezone)).date()
                occ_date = business_date

            # 1. Idempotency key lookup
            if eff_idempotency_key:
                existing_by_key = session.scalar(
                    select(StaffAttendanceRecord).where(
                        StaffAttendanceRecord.branch_id == branch.id,
                        StaffAttendanceRecord.idempotency_key == eff_idempotency_key,
                    )
                )
                if existing_by_key is not None:
                    if (
                        existing_by_key.profile_id != profile.id
                        or (eff_series_id is not None and existing_by_key.series_id != eff_series_id)
                        or (eff_occurrence_date is not None and existing_by_key.occurrence_date != eff_occurrence_date)
                    ):
                        raise HTTPException(409, "Idempotency key conflict: payload does not match existing record.")
                    if eff_device_captured_at is not None and existing_by_key.device_captured_at is not None:
                        rec_dev = existing_by_key.device_captured_at
                        if rec_dev.tzinfo is None:
                            rec_dev = rec_dev.replace(tzinfo=timezone.utc)
                        if abs((rec_dev - device_time).total_seconds()) > 0.001:
                            raise HTTPException(409, "Idempotency key conflict: capture time does not match.")
                    response.status_code = 200
                    checkout = session.scalar(
                        select(StaffAttendanceCheckout).where(
                            StaffAttendanceCheckout.attendance_id == existing_by_key.id
                        )
                    )
                    return _item(existing_by_key, profile, checkout)

            # 2. Existing scheduled series occurrence lookup
            if eff_series_id is not None and occ_date is not None:
                existing_series_rec = session.scalar(
                    select(StaffAttendanceRecord).where(
                        StaffAttendanceRecord.branch_id == branch.id,
                        StaffAttendanceRecord.profile_id == profile.id,
                        StaffAttendanceRecord.series_id == eff_series_id,
                        StaffAttendanceRecord.occurrence_date == occ_date,
                    )
                )
                if existing_series_rec is not None:
                    if eff_idempotency_key is not None and existing_series_rec.idempotency_key != eff_idempotency_key:
                        raise HTTPException(409, "Attendance already recorded for this scheduled occurrence.")
                    response.status_code = 200
                    checkout = session.scalar(
                        select(StaffAttendanceCheckout).where(
                            StaffAttendanceCheckout.attendance_id == existing_series_rec.id
                        )
                    )
                    return _item(existing_series_rec, profile, checkout)

            # 3. Existing ad-hoc / legacy lookup (when neither series_id nor idempotency_key is supplied)
            if eff_series_id is None and eff_idempotency_key is None:
                existing = _existing_record(session, branch.id, profile.id, business_date)
                if existing is not None:
                    response.status_code = 200
                    checkout = session.scalar(
                        select(StaffAttendanceCheckout).where(
                            StaffAttendanceCheckout.attendance_id == existing.id
                        )
                    )
                    return _item(existing, profile, checkout)

            if not profile.is_active:
                raise HTTPException(409, "Inactive staff cannot be marked for attendance.")

            schedule_conflict = False
            review_required = clock_review_flag
            scheduled_start_time: time | None = None
            scheduled_end_time: time | None = None

            if eff_series_id is not None:
                series = session.get(StaffScheduleSeries, eff_series_id)
                if series is None:
                    raise HTTPException(404, "Schedule series not found.")
                if series.profile_id != profile.id or series.branch_id != branch.id:
                    raise HTTPException(400, "Schedule series does not match profile or branch.")

                # If series was cancelled, retain and store mark with conflict flag
                if series.cancelled_from is not None and occ_date >= series.cancelled_from:
                    schedule_conflict = True
                    review_required = True

                exception = session.scalar(
                    select(StaffScheduleException).where(
                        StaffScheduleException.series_id == series.id,
                        StaffScheduleException.local_date == occ_date,
                    )
                )

                if exception is not None:
                    if exception.action == "skip":
                        schedule_conflict = True
                        review_required = True
                        scheduled_start_time = series.start_time
                        scheduled_end_time = series.end_time
                    elif exception.action == "override":
                        scheduled_start_time = exception.override_start_time or series.start_time
                        scheduled_end_time = exception.override_end_time or series.end_time
                else:
                    scheduled_start_time = series.start_time
                    scheduled_end_time = series.end_time

                tolerance_minutes = (
                    profile.grace_tolerance_minutes
                    if profile.grace_tolerance_minutes is not None
                    else 15
                )
                local_time = device_time.astimezone(ZoneInfo(branch.timezone))
                ref_date = occ_date
                cutoff = datetime.combine(ref_date, scheduled_start_time) + timedelta(minutes=tolerance_minutes)
                status = "present" if local_time.replace(tzinfo=None) <= cutoff else "late"
            else:
                # Ad-hoc / legacy flow
                if profile.expected_entry_time is None or profile.grace_tolerance_minutes is None:
                    raise HTTPException(409, "A complete staff entry schedule is required before attendance can be recorded.")
                local_time = device_time.astimezone(ZoneInfo(branch.timezone))
                cutoff = datetime.combine(local_time.date(), profile.expected_entry_time) + timedelta(
                    minutes=profile.grace_tolerance_minutes
                )
                status = "present" if local_time.replace(tzinfo=None) <= cutoff else "late"
                scheduled_start_time = profile.expected_entry_time
                scheduled_end_time = None
                tolerance_minutes = profile.grace_tolerance_minutes

            record = StaffAttendanceRecord(
                branch_id=branch.id,
                profile_id=profile.id,
                recorded_by=principal.staff_id,
                occurred_at=device_time,
                business_date=business_date,
                status=status,
                expected_entry_time=scheduled_start_time if scheduled_start_time is not None else profile.expected_entry_time,
                grace_tolerance_minutes=tolerance_minutes,
                series_id=eff_series_id,
                occurrence_date=occ_date,
                device_captured_at=device_time,
                server_received_at=server_received_at,
                idempotency_key=eff_idempotency_key,
                scheduled_start_time=scheduled_start_time,
                scheduled_end_time=scheduled_end_time,
                clock_skew_seconds=clock_skew_seconds,
                clock_validation_status=clock_validation_status,
                review_required=review_required,
                schedule_conflict=schedule_conflict,
            )

            try:
                with session.begin_nested():
                    session.add(record)
                    session.flush()
            except IntegrityError:
                if eff_idempotency_key:
                    existing = session.scalar(
                        select(StaffAttendanceRecord).where(
                            StaffAttendanceRecord.branch_id == branch.id,
                            StaffAttendanceRecord.idempotency_key == eff_idempotency_key,
                        )
                    )
                elif eff_series_id and occ_date:
                    existing = session.scalar(
                        select(StaffAttendanceRecord).where(
                            StaffAttendanceRecord.branch_id == branch.id,
                            StaffAttendanceRecord.profile_id == profile.id,
                            StaffAttendanceRecord.series_id == eff_series_id,
                            StaffAttendanceRecord.occurrence_date == occ_date,
                        )
                    )
                else:
                    existing = _existing_record(session, branch.id, profile.id, business_date)

                if existing is None:
                    raise HTTPException(409, "Attendance already exists for this employee and branch date.")
                response.status_code = 200
                checkout = session.scalar(
                    select(StaffAttendanceCheckout).where(
                        StaffAttendanceCheckout.attendance_id == existing.id
                    )
                )
                return _item(existing, profile, checkout)

            return _item(record, profile)

    except IntegrityError as exc:
        orig_msg = str(getattr(exc, "orig", exc))
        if any(c in orig_msg for c in ("uq_staff_attendance", "UNIQUE constraint", "unique constraint")):
            raise HTTPException(409, "Attendance already exists for this employee and branch date.") from None
        raise


@router.post("/{attendance_id}/checkout", response_model=StaffAttendanceCheckoutItem, status_code=201)
def record_staff_checkout(
    attendance_id: UUID,
    request: Request,
    response: Response,
    payload: StaffCheckoutRequest | None = None,
    principal: RosterPrincipal = Depends(_principal),
):
    factory = request.app.state.session_factory
    try:
        with factory.begin() as session:
            record = session.get(StaffAttendanceRecord, attendance_id)
            if record is None:
                raise HTTPException(404, "Attendance entry not found.")
            _recorder_branch(session, principal, record.branch_id)
            existing = session.scalar(
                select(StaffAttendanceCheckout).where(StaffAttendanceCheckout.attendance_id == record.id)
            )
            if existing is not None:
                response.status_code = 200
                return _checkout_item(existing)

            if payload and payload.device_captured_at is not None:
                occurred_at = _utc(payload.device_captured_at)
            else:
                occurred_at = _utc(utc_now())

            entry_at = record.occurred_at
            if entry_at.tzinfo is None:
                entry_at = entry_at.replace(tzinfo=timezone.utc)
            if occurred_at < entry_at:
                raise HTTPException(422, "Checkout cannot occur before its attendance entry.")

            checkout = StaffAttendanceCheckout(
                attendance_id=record.id,
                recorded_by=principal.staff_id,
                occurred_at=occurred_at,
            )
            try:
                with session.begin_nested():
                    session.add(checkout)
                    session.flush()
            except IntegrityError:
                existing = session.scalar(
                    select(StaffAttendanceCheckout).where(StaffAttendanceCheckout.attendance_id == record.id)
                )
                if existing is None:
                    raise
                response.status_code = 200
                return _checkout_item(existing)
            return _checkout_item(checkout)
    except IntegrityError:
        raise HTTPException(409, "Checkout could not be recorded.") from None


@router.post("/{attendance_id}/corrections", response_model=StaffAttendanceCorrectionItem, status_code=201)
def record_staff_attendance_correction(
    attendance_id: UUID,
    payload: StaffAttendanceCorrectionRequest,
    request: Request,
    principal: RosterPrincipal = Depends(_principal),
):
    factory = request.app.state.session_factory
    with factory.begin() as session:
        record = session.get(StaffAttendanceRecord, attendance_id)
        if record is None:
            raise HTTPException(404, "Attendance entry not found.")

        # RBAC Check: Receptionist can only correct records in their own branch. Admin can correct any branch.
        if not principal.is_admin:
            if principal.branch_id is None or principal.branch_id != record.branch_id:
                raise HTTPException(403, "Receptionists may only correct records in their assigned branch.")
            try:
                authorize(session, principal.staff_id, Permission.STAFF_ATTENDANCE_RECORD, record.branch_id)
            except AuthorizationDenied:
                raise HTTPException(403, "Receptionists may only correct records in their assigned branch.") from None

        reason = payload.reason.strip()
        if len(reason) < 5:
            raise HTTPException(422, "Reason must be at least 5 characters.")

        if payload.original_value is not None:
            orig_val = payload.original_value
        else:
            orig = getattr(record, payload.field_name, None)
            orig_val = str(orig) if orig is not None else ""

        correction = StaffAttendanceCorrection(
            attendance_id=record.id,
            corrected_by=principal.staff_id,
            field_name=payload.field_name,
            original_value=orig_val,
            corrected_value=payload.corrected_value,
            reason=reason,
            corrected_at=_utc(utc_now()),
        )
        session.add(correction)
        session.flush()
        return _correction_item(correction)
