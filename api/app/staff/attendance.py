"""Staff attendance use cases: permissions, branch scope, idempotent replay, occurrence validation and
present/late classification. SQL lives in `app.staff.queries`; HTTP transport in `app.api.staff_attendance`.

Failures are typed `HttpStatusError`s (same wire output as the former HTTPException). Every use case
takes the session `factory` and owns its transaction (`factory.begin()` for writes, `factory()` for reads).
"""
from datetime import date, datetime, time, timedelta, timezone
from typing import Protocol
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.db.models import StaffAttendanceCheckout, StaffAttendanceRecord, StaffRosterProfile
from app.db.models.staff_attendance import StaffAttendanceCorrection
from app.errors import HttpStatusError
# shortcut: imports router helpers; must move to app/staff before any app.api.* module imports app.staff (circular import).
from app.api.staff_roster import _allowed_branches
from app.api.staff_schedules import _occurrence_dates, _zone_for_branch
from app.staff import queries as q
from app.staff.schemas import (
    StaffAttendanceCheckoutItem, StaffAttendanceCorrectionItem, StaffAttendanceCorrectionRequest,
    StaffAttendanceCreateRequest, StaffAttendanceItem, StaffAttendancePage, StaffCheckoutRequest,
)

# Domain field names the UI sends; the original value is always derived server-side.
CORRECTABLE_FIELDS = {"clock_in_at", "clock_out_at", "status", "notes"}


class Principal(Protocol):
    staff_id: UUID
    branch_id: UUID | None
    is_admin: bool


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _is_late(device_time: datetime, day: date, start: time, tolerance_minutes: int, zone) -> bool:
    # Wall-clock start in the branch zone, converted to UTC before adding tolerance so DST shifts count.
    cutoff = datetime.combine(day, start, tzinfo=zone).astimezone(timezone.utc) + timedelta(minutes=tolerance_minutes)
    return device_time > cutoff


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise HttpStatusError(422)
    return value.astimezone(timezone.utc)


# --- DTO assembly ----------------------------------------------------------------------------

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


def _record_notes(
    session,
    record: StaffAttendanceRecord | None,
    profile: StaffRosterProfile,
    explicit_notes: str | None = None,
    covered_profile: StaffRosterProfile | None = None,
) -> str | None:
    if explicit_notes:
        return explicit_notes
    if covered_profile is not None:
        return f"Cubriendo turno de {covered_profile.full_name}"
    if record is not None and record.series_id is not None:
        series = q.get_series(session, record.series_id)
        if series is not None and series.profile_id != profile.id:
            cov = q.get_profile(session, series.profile_id)
            if cov:
                return f"Cubriendo turno de {cov.full_name}"
    elif record is not None and record.scheduled_start_time is None and record.expected_entry_time is None:
        return "Turno de apoyo / extraordinario"
    return None


def _item(
    record: StaffAttendanceRecord,
    profile: StaffRosterProfile,
    checkout: StaffAttendanceCheckout | None = None,
    notes: str | None = None,
    recorder_name: str | None = None,
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
        recorded_by=recorder_name or str(record.recorded_by),
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
        notes=notes,
    )


# --- guards ----------------------------------------------------------------------------------

def _recorder_branch(session, principal: Principal, branch_id: UUID):
    if principal.branch_id is not None and principal.branch_id != branch_id:
        raise HttpStatusError(404)
    try:
        authorize(session, principal.staff_id, Permission.STAFF_ATTENDANCE_RECORD, branch_id)
    except AuthorizationDenied:
        raise HttpStatusError(403) from None
    branch = q.get_branch(session, branch_id)
    if branch is None or not branch.is_active:
        raise HttpStatusError(404)
    return branch


def _require_corrections_view(session, principal: Principal, branch_id: UUID) -> None:
    """Receptionists need the record or roster-manage permission in their own branch; admins pass."""
    if principal.is_admin:
        return
    if principal.branch_id is None or principal.branch_id != branch_id:
        raise HttpStatusError(403)
    try:
        authorize(session, principal.staff_id, Permission.STAFF_ATTENDANCE_RECORD, branch_id)
    except AuthorizationDenied:
        try:
            authorize(session, principal.staff_id, Permission.STAFF_ROSTER_MANAGE, branch_id)
        except AuthorizationDenied:
            raise HttpStatusError(403) from None


# --- use cases -------------------------------------------------------------------------------

def list_staff_attendance(factory, principal: Principal, branch_id: UUID | None, business_date: date | None,
                          offset: int, limit: int) -> StaffAttendancePage:
    with factory() as session:
        branches = _allowed_branches(session, principal, branch_id)
        branch_ids = [branch.id for branch in branches]
        rows, total = q.attendance_page(session, branch_ids, business_date, offset, limit)
        checkouts_by_attendance_id = q.checkouts_by_attendance(session, [record.id for record, _profile in rows])
        series_by_id = q.series_by_id(session, {r.series_id for r, _ in rows if r.series_id is not None})
        cov_profiles = q.profiles_by_id(session, {s.profile_id for s in series_by_id.values()})
        recorder_names = q.recorder_names(session, {record.recorded_by for record, _ in rows}, branch_ids)

        def _row_notes(rec, prof):
            if rec.series_id and rec.series_id in series_by_id:
                s = series_by_id[rec.series_id]
                if s.profile_id != prof.id:
                    cov = cov_profiles.get(s.profile_id)
                    if cov:
                        return f"Cubriendo turno de {cov.full_name}"
            elif rec.series_id is None and rec.scheduled_start_time is None and rec.expected_entry_time is None:
                return "Turno de apoyo / extraordinario"
            return None

        return StaffAttendancePage(
            items=[
                _item(
                    record, profile, checkouts_by_attendance_id.get(record.id),
                    notes=_row_notes(record, profile),
                    recorder_name=recorder_names.get(record.recorded_by),
                )
                for record, profile in rows
            ],
            total=total,
        )


def _replayed(session, record, profile, branch_id: UUID, notes: str | None = None) -> StaffAttendanceItem:
    checkout = q.checkout_for(session, record.id)
    rec_name = q.recorder_name(session, record.recorded_by, branch_id)
    return _item(record, profile, checkout, notes=notes, recorder_name=rec_name)


def record_staff_attendance(
    factory, principal: Principal, branch_id: UUID, profile_id: UUID, payload: StaffAttendanceCreateRequest | None, *,
    series_id: UUID | None, occurrence_date: date | None, device_captured_at: datetime | None,
    idempotency_key: str | None,
) -> tuple[StaffAttendanceItem, bool]:
    """Returns (item, replayed); replayed maps to HTTP 200 instead of 201."""
    try:
        with factory.begin() as session:
            branch = _recorder_branch(session, principal, branch_id)
            profile = q.get_profile(session, profile_id)
            if profile is None or profile.branch_id != branch.id:
                raise HttpStatusError(404)

            # Resolve effective input parameters from body or query
            eff_series_id = payload.series_id if (payload and payload.series_id is not None) else series_id
            eff_occurrence_date = payload.occurrence_date if (payload and payload.occurrence_date is not None) else occurrence_date
            eff_device_captured_at = payload.device_captured_at if (payload and payload.device_captured_at is not None) else device_captured_at
            eff_idempotency_key = payload.idempotency_key if (payload and payload.idempotency_key is not None) else idempotency_key

            server_received_at = _utc(utc_now())
            zone = _zone_for_branch(branch)[0]

            if eff_device_captured_at is not None:
                if eff_device_captured_at.tzinfo is None or eff_device_captured_at.utcoffset() is None:
                    raise HttpStatusError(422)
                device_time = eff_device_captured_at.astimezone(timezone.utc)
                skew_seconds = int((server_received_at - device_time).total_seconds())
                clock_skew_seconds = skew_seconds
                if abs(skew_seconds) > 300:
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
                business_date = device_time.astimezone(zone).date()
                occ_date = business_date

            # 1. Idempotency key lookup
            if eff_idempotency_key:
                existing_by_key = q.record_by_key(session, branch.id, eff_idempotency_key)
                if existing_by_key is not None:
                    rec_dev = existing_by_key.device_captured_at
                    if rec_dev is not None and rec_dev.tzinfo is None:
                        rec_dev = rec_dev.replace(tzinfo=timezone.utc)
                    # shortcut: notes/covered_profile_id are not persisted, so they cannot be compared; needs a column.
                    if (
                        existing_by_key.profile_id != profile.id
                        or existing_by_key.series_id != eff_series_id
                        or existing_by_key.occurrence_date != occ_date
                        or (eff_device_captured_at is not None and rec_dev is not None and abs((rec_dev - device_time).total_seconds()) > 0.001)
                    ):
                        raise HttpStatusError(409)
                    return _replayed(session, existing_by_key, profile, branch.id), True

            # 2. Existing scheduled series occurrence lookup
            if eff_series_id is not None and occ_date is not None:
                existing_series_rec = q.record_by_occurrence(session, branch.id, profile.id, eff_series_id, occ_date)
                if existing_series_rec is not None:
                    if eff_idempotency_key is not None and existing_series_rec.idempotency_key != eff_idempotency_key:
                        raise HttpStatusError(409)
                    notes = _record_notes(session, existing_series_rec, profile, explicit_notes=payload.notes if payload else None)
                    return _replayed(session, existing_series_rec, profile, branch.id, notes), True

            # 3. Existing ad-hoc / legacy lookup: one ad-hoc mark per day, whatever the key
            if eff_series_id is None:
                existing = q.adhoc_record(session, branch.id, profile.id, business_date)
                if existing is not None:
                    notes = _record_notes(session, existing, profile, explicit_notes=payload.notes if payload else None)
                    return _replayed(session, existing, profile, branch.id, notes), True

            if not profile.is_active:
                raise HttpStatusError(409)

            schedule_conflict = False
            covered_profile: StaffRosterProfile | None = None
            review_required = clock_review_flag
            scheduled_start_time: time | None = None
            scheduled_end_time: time | None = None

            if eff_series_id is not None:
                series = q.get_series(session, eff_series_id)
                if series is None:
                    raise HttpStatusError(404)
                if series.branch_id != branch.id:
                    raise HttpStatusError(400)
                if series.profile_id != profile.id:
                    target_cov_id = payload.covered_profile_id if (payload and payload.covered_profile_id) else series.profile_id
                    covered_profile = q.get_profile(session, target_cov_id)
                    if covered_profile is None or covered_profile.branch_id != branch.id:
                        raise HttpStatusError(400)
                elif payload and payload.covered_profile_id and payload.covered_profile_id != profile.id:
                    covered_profile = q.get_profile(session, payload.covered_profile_id)
                    if covered_profile is None or covered_profile.branch_id != branch.id:
                        raise HttpStatusError(400)

                # Cancelled series or a date that is not a real occurrence: retain for review (D-033).
                if next(_occurrence_dates(series, occ_date, occ_date), None) is None:
                    schedule_conflict = True
                    review_required = True

                exception = q.get_schedule_exception(session, series.id, occ_date)

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
                status = "late" if _is_late(device_time, occ_date, scheduled_start_time, tolerance_minutes, zone) else "present"
            else:
                # Ad-hoc / legacy flow
                if profile.expected_entry_time is None:
                    if payload and payload.notes:
                        status = "present"
                        scheduled_start_time = None
                        scheduled_end_time = None
                        tolerance_minutes = profile.grace_tolerance_minutes or 15
                    else:
                        raise HttpStatusError(409)
                else:
                    tolerance_minutes = profile.grace_tolerance_minutes if profile.grace_tolerance_minutes is not None else 15
                    local_day = device_time.astimezone(zone).date()
                    status = "late" if _is_late(device_time, local_day, profile.expected_entry_time, tolerance_minutes, zone) else "present"
                    scheduled_start_time = profile.expected_entry_time
                    scheduled_end_time = None

            eff_notes = _record_notes(
                session, None, profile,
                explicit_notes=payload.notes if payload else None,
                covered_profile=covered_profile,
            )
            if not eff_notes and eff_series_id is None and scheduled_start_time is None:
                eff_notes = (payload and payload.notes) or "Turno de apoyo / extraordinario"

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
                q.insert_in_savepoint(session, record)
            except IntegrityError:
                if eff_idempotency_key:
                    existing = q.record_by_key(session, branch.id, eff_idempotency_key)
                elif eff_series_id and occ_date:
                    existing = q.record_by_occurrence(session, branch.id, profile.id, eff_series_id, occ_date)
                else:
                    existing = q.adhoc_record(session, branch.id, profile.id, business_date)

                if existing is None:
                    raise HttpStatusError(409) from None
                return _replayed(session, existing, profile, branch.id), True

            rec_name = q.recorder_name(session, principal.staff_id, branch.id)
            return _item(record, profile, notes=eff_notes, recorder_name=rec_name), False

    except IntegrityError as exc:
        orig_msg = str(getattr(exc, "orig", exc))
        if any(c in orig_msg for c in ("uq_staff_attendance", "UNIQUE constraint", "unique constraint")):
            raise HttpStatusError(409) from None
        raise


def record_staff_checkout(factory, principal: Principal, attendance_id: UUID,
                          payload: StaffCheckoutRequest | None) -> tuple[StaffAttendanceCheckoutItem, bool]:
    """Returns (item, replayed); replayed maps to HTTP 200 instead of 201."""
    try:
        with factory.begin() as session:
            record = q.get_record(session, attendance_id)
            if record is None:
                raise HttpStatusError(404)
            _recorder_branch(session, principal, record.branch_id)
            existing = q.checkout_for(session, record.id)
            if existing is not None:
                return _checkout_item(existing), True

            if payload and payload.device_captured_at is not None:
                occurred_at = _utc(payload.device_captured_at)
            else:
                occurred_at = _utc(utc_now())

            entry_at = record.occurred_at
            if entry_at.tzinfo is None:
                entry_at = entry_at.replace(tzinfo=timezone.utc)
            if occurred_at < entry_at:
                raise HttpStatusError(422)

            checkout = StaffAttendanceCheckout(
                attendance_id=record.id,
                recorded_by=principal.staff_id,
                occurred_at=occurred_at,
            )
            try:
                q.insert_in_savepoint(session, checkout)
            except IntegrityError:
                existing = q.checkout_for(session, record.id)
                if existing is None:
                    raise
                return _checkout_item(existing), True
            return _checkout_item(checkout), False
    except IntegrityError:
        raise HttpStatusError(409) from None


def record_staff_attendance_correction(factory, principal: Principal, attendance_id: UUID,
                                       payload: StaffAttendanceCorrectionRequest) -> StaffAttendanceCorrectionItem:
    with factory.begin() as session:
        record = q.get_record(session, attendance_id)
        if record is None:
            raise HttpStatusError(404)

        # RBAC Check: Receptionist can only correct records in their own branch. Admin can correct any branch.
        if not principal.is_admin:
            if principal.branch_id is None or principal.branch_id != record.branch_id:
                raise HttpStatusError(403)
            try:
                authorize(session, principal.staff_id, Permission.STAFF_ATTENDANCE_RECORD, record.branch_id)
            except AuthorizationDenied:
                raise HttpStatusError(403) from None

        reason = payload.reason.strip()
        if len(reason) < 5:
            raise HttpStatusError(422)

        if payload.field_name not in CORRECTABLE_FIELDS:
            raise HttpStatusError(422)
        if payload.field_name == "clock_in_at":
            orig = record.occurred_at
        elif payload.field_name == "clock_out_at":
            orig = q.checkout_time(session, record.id)
        elif payload.field_name == "status":
            orig = record.status
        else:
            profile = q.get_profile(session, record.profile_id)
            orig = _record_notes(session, record, profile)
        orig_val = str(orig) if orig is not None else ""

        value = payload.corrected_value
        if payload.field_name == "status" and value not in ("present", "late"):
            raise HttpStatusError(422)
        if payload.field_name in ("clock_in_at", "clock_out_at"):
            try:
                _utc(datetime.fromisoformat(value))
            except ValueError:
                raise HttpStatusError(422) from None

        correction = StaffAttendanceCorrection(
            attendance_id=record.id,
            corrected_by=principal.staff_id,
            field_name=payload.field_name,
            original_value=orig_val,
            corrected_value=payload.corrected_value,
            reason=reason,
            corrected_at=_utc(utc_now()),
        )
        q.add_correction(session, correction)
        return _correction_item(correction)


def list_branch_attendance_corrections(factory, principal: Principal, branch_id: UUID,
                                       business_date: date | None) -> list[StaffAttendanceCorrectionItem]:
    with factory() as session:
        _require_corrections_view(session, principal, branch_id)
        return [_correction_item(c) for c in q.branch_corrections(session, branch_id, business_date)]


def list_staff_attendance_corrections(factory, principal: Principal,
                                      attendance_id: UUID) -> list[StaffAttendanceCorrectionItem]:
    with factory() as session:
        record = q.get_record(session, attendance_id)
        if record is None:
            raise HttpStatusError(404)
        _require_corrections_view(session, principal, record.branch_id)
        return [_correction_item(c) for c in q.record_corrections(session, record.id)]
