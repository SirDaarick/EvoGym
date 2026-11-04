"""Staff attendance HTTP transport: parse the request, call one `app.staff.attendance` function, shape the response."""
from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import SessionFactoryDep
from app.api.staff_roster import RosterPrincipal, _principal
from app.staff import attendance as service
from app.staff.schemas import (
    StaffAttendanceCheckoutItem, StaffAttendanceCorrectionItem, StaffAttendanceCorrectionRequest,
    StaffAttendanceCreateRequest, StaffAttendanceItem, StaffAttendancePage, StaffCheckoutRequest,
)

router = APIRouter(prefix="/api/v1/staff-attendance", tags=["staff-attendance"])


def _status(response: Response, replayed: bool) -> None:
    if replayed:
        response.status_code = 200


@router.get("", response_model=StaffAttendancePage)
def list_staff_attendance(
    branch_id: UUID | None = Query(default=None),
    business_date: date | None = Query(default=None),
    offset: int = Query(default=0, ge=0, le=2**63 - 1),
    limit: int = Query(default=50, ge=1, le=100),
    principal: RosterPrincipal = Depends(_principal),
    *, factory: SessionFactoryDep,
):
    return service.list_staff_attendance(factory, principal, branch_id, business_date, offset, limit)


@router.post("/branches/{branch_id}/profiles/{profile_id}", response_model=StaffAttendanceItem, status_code=201)
def record_staff_attendance(
    branch_id: UUID,
    profile_id: UUID,
    response: Response,
    payload: StaffAttendanceCreateRequest | None = None,
    series_id: UUID | None = Query(default=None),
    occurrence_date: date | None = Query(default=None),
    device_captured_at: datetime | None = Query(default=None),
    idempotency_key: str | None = Query(default=None),
    principal: RosterPrincipal = Depends(_principal),
    *, factory: SessionFactoryDep,
):
    item, replayed = service.record_staff_attendance(
        factory, principal, branch_id, profile_id, payload, series_id=series_id,
        occurrence_date=occurrence_date, device_captured_at=device_captured_at, idempotency_key=idempotency_key,
    )
    _status(response, replayed)
    return item


@router.post("/{attendance_id}/checkout", response_model=StaffAttendanceCheckoutItem, status_code=201)
def record_staff_checkout(
    attendance_id: UUID,
    response: Response,
    payload: StaffCheckoutRequest | None = None,
    principal: RosterPrincipal = Depends(_principal),
    *, factory: SessionFactoryDep,
):
    item, replayed = service.record_staff_checkout(factory, principal, attendance_id, payload)
    _status(response, replayed)
    return item


@router.post("/{attendance_id}/corrections", response_model=StaffAttendanceCorrectionItem, status_code=201)
def record_staff_attendance_correction(
    attendance_id: UUID,
    payload: StaffAttendanceCorrectionRequest,
    principal: RosterPrincipal = Depends(_principal),
    *, factory: SessionFactoryDep,
):
    return service.record_staff_attendance_correction(factory, principal, attendance_id, payload)


@router.get("/branches/{branch_id}/corrections", response_model=list[StaffAttendanceCorrectionItem])
def list_branch_attendance_corrections(
    branch_id: UUID,
    business_date: date | None = Query(default=None),
    principal: RosterPrincipal = Depends(_principal),
    *, factory: SessionFactoryDep,
):
    return service.list_branch_attendance_corrections(factory, principal, branch_id, business_date)


@router.get("/{attendance_id}/corrections", response_model=list[StaffAttendanceCorrectionItem])
@router.get("/records/{attendance_id}/corrections", response_model=list[StaffAttendanceCorrectionItem])
def list_staff_attendance_corrections(
    attendance_id: UUID,
    principal: RosterPrincipal = Depends(_principal),
    *, factory: SessionFactoryDep,
):
    return service.list_staff_attendance_corrections(factory, principal, attendance_id)
