"""Staff attendance SQL and projections. No permission checks, commits or HTTP concerns."""
from datetime import date
from uuid import UUID

from sqlalchemy import func, select

from app.db.models import (
    Branch, StaffAttendanceCheckout, StaffAttendanceRecord, StaffRosterProfile, StaffScheduleException,
    StaffScheduleSeries,
)
from app.db.models.staff_attendance import StaffAttendanceCorrection


def get_branch(session, branch_id: UUID) -> Branch | None:
    return session.get(Branch, branch_id)


def get_profile(session, profile_id: UUID) -> StaffRosterProfile | None:
    return session.get(StaffRosterProfile, profile_id)


def get_record(session, attendance_id: UUID) -> StaffAttendanceRecord | None:
    return session.get(StaffAttendanceRecord, attendance_id)


def get_series(session, series_id: UUID) -> StaffScheduleSeries | None:
    return session.get(StaffScheduleSeries, series_id)


def get_schedule_exception(session, series_id: UUID, local_date: date):
    return session.scalar(select(StaffScheduleException).where(
        StaffScheduleException.series_id == series_id, StaffScheduleException.local_date == local_date))


def record_by_key(session, branch_id: UUID, idempotency_key: str):
    return session.scalar(select(StaffAttendanceRecord).where(
        StaffAttendanceRecord.branch_id == branch_id, StaffAttendanceRecord.idempotency_key == idempotency_key))


def record_by_occurrence(session, branch_id: UUID, profile_id: UUID, series_id: UUID, occurrence_date: date):
    return session.scalar(select(StaffAttendanceRecord).where(
        StaffAttendanceRecord.branch_id == branch_id,
        StaffAttendanceRecord.profile_id == profile_id,
        StaffAttendanceRecord.series_id == series_id,
        StaffAttendanceRecord.occurrence_date == occurrence_date,
    ))


def adhoc_record(session, branch_id: UUID, profile_id: UUID, business_date: date):
    return session.scalar(select(StaffAttendanceRecord).where(
        StaffAttendanceRecord.branch_id == branch_id,
        StaffAttendanceRecord.profile_id == profile_id,
        StaffAttendanceRecord.business_date == business_date,
        StaffAttendanceRecord.series_id.is_(None),
    ))


def checkout_for(session, attendance_id: UUID):
    return session.scalar(select(StaffAttendanceCheckout).where(StaffAttendanceCheckout.attendance_id == attendance_id))


def checkout_time(session, attendance_id: UUID):
    return session.scalar(select(StaffAttendanceCheckout.occurred_at).where(
        StaffAttendanceCheckout.attendance_id == attendance_id))


def insert_in_savepoint(session, row) -> None:
    """Add + flush inside a savepoint so a unique violation leaves the outer transaction usable."""
    with session.begin_nested():
        session.add(row)
        session.flush()


def add_correction(session, correction: StaffAttendanceCorrection) -> None:
    session.add(correction)
    session.flush()


def recorder_name(session, staff_user_id: UUID, branch_id: UUID | None = None) -> str:
    if branch_id:
        p = session.scalar(select(StaffRosterProfile).where(
            StaffRosterProfile.staff_user_id == staff_user_id,
            StaffRosterProfile.branch_id == branch_id,
            StaffRosterProfile.is_active.is_(True),
        ))
        if p and p.full_name:
            return p.full_name
    p = session.scalar(select(StaffRosterProfile).where(
        StaffRosterProfile.staff_user_id == staff_user_id,
        StaffRosterProfile.is_active.is_(True),
    ))
    if p and p.full_name:
        return p.full_name
    return str(staff_user_id)


def recorder_names(session, staff_user_ids: set[UUID], branch_ids: list[UUID] | None = None) -> dict[UUID, str]:
    if not staff_user_ids:
        return {}
    profiles = session.scalars(select(StaffRosterProfile).where(
        StaffRosterProfile.staff_user_id.in_(staff_user_ids),
        StaffRosterProfile.is_active.is_(True),
    )).all()
    names: dict[UUID, str] = {}
    for p in profiles:
        if p.staff_user_id is not None:
            if p.staff_user_id not in names or (branch_ids and p.branch_id in branch_ids):
                names[p.staff_user_id] = p.full_name
    return {uid: names.get(uid, str(uid)) for uid in staff_user_ids}


def attendance_page(session, branch_ids: list[UUID], business_date: date | None, offset: int, limit: int):
    """(rows of (record, profile), total) for the branches, newest first."""
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
    rows = session.execute(
        query.order_by(
            StaffAttendanceRecord.business_date.desc(),
            StaffAttendanceRecord.occurred_at.desc(),
            StaffAttendanceRecord.id,
        ).offset(offset).limit(limit)
    ).all() if branch_ids else []
    total = session.scalar(count_query) if branch_ids else 0
    return rows, total


def checkouts_by_attendance(session, attendance_ids: list[UUID]) -> dict[UUID, StaffAttendanceCheckout]:
    if not attendance_ids:
        return {}
    return {c.attendance_id: c for c in session.scalars(select(StaffAttendanceCheckout).where(
        StaffAttendanceCheckout.attendance_id.in_(attendance_ids))).all()}


def series_by_id(session, series_ids: set[UUID]) -> dict[UUID, StaffScheduleSeries]:
    if not series_ids:
        return {}
    return {s.id: s for s in session.scalars(
        select(StaffScheduleSeries).where(StaffScheduleSeries.id.in_(series_ids))).all()}


def profiles_by_id(session, profile_ids: set[UUID]) -> dict[UUID, StaffRosterProfile]:
    if not profile_ids:
        return {}
    return {p.id: p for p in session.scalars(
        select(StaffRosterProfile).where(StaffRosterProfile.id.in_(profile_ids))).all()}


def branch_corrections(session, branch_id: UUID, business_date: date | None):
    query = (
        select(StaffAttendanceCorrection)
        .join(StaffAttendanceRecord, StaffAttendanceRecord.id == StaffAttendanceCorrection.attendance_id)
        .where(StaffAttendanceRecord.branch_id == branch_id)
    )
    if business_date is not None:
        query = query.where(StaffAttendanceRecord.business_date == business_date)
    return session.scalars(
        query.order_by(StaffAttendanceCorrection.corrected_at.asc(), StaffAttendanceCorrection.id.asc())
    ).all()


def record_corrections(session, attendance_id: UUID):
    return session.scalars(
        select(StaffAttendanceCorrection)
        .where(StaffAttendanceCorrection.attendance_id == attendance_id)
        .order_by(StaffAttendanceCorrection.corrected_at.asc(), StaffAttendanceCorrection.id.asc())
    ).all()
