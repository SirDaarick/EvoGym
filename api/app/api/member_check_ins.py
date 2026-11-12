"""Member check-in HTTP transport: call one `app.memberships.service` function and set the replay status."""
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy import select

from app.api.members import MemberActorPrincipal, get_member_actor_principal
from app.db.models.member_check_ins import MemberCheckIn
from app.db.models.members import Member
from app.db.models.staff import StaffUser
from app.db.models.staff_roster import StaffRosterProfile
from app.errors import CheckInConflictResponse, ValidationErrorResponse
from app.memberships import service
from app.memberships.schemas import ClassSampleCheckInResponse, MemberCheckInResponse

router = APIRouter(prefix="/api/v1/member-check-ins", tags=["member-check-ins"])

_RESPONSES = {409: {"model": CheckInConflictResponse}, 422: {"model": ValidationErrorResponse}}


class CheckInRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm_outstanding_balance: StrictBool = False


@router.get("/branches/{branch_id}/debt-alerts")
def list_debt_alerts(branch_id: UUID, request: Request,
                     principal: MemberActorPrincipal = Depends(get_member_actor_principal)):
    if not principal.is_admin:
        raise HTTPException(403)
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503)
    with factory() as session:
        rows = [
            (event, name, number)
            for event, name, number in session.execute(
                select(MemberCheckIn, Member.full_name, Member.member_number)
                .join(Member, Member.id == MemberCheckIn.member_id)
                .where(MemberCheckIn.branch_id == branch_id)
                .order_by(MemberCheckIn.occurred_at.desc(), MemberCheckIn.id.desc())
            )
            if "outstanding_balance_confirmed" in event.access_warnings
            and "outstanding_balance" in event.access_warnings
        ]
        from app.api.owner_overview import _staff_display_names
        staff_names = _staff_display_names(session, {event.recorded_by for event, _, _ in rows})
        return [
            {
                "id": str(event.id),
                "alert_type": "debt_override_checkin",
                "branch_id": str(event.branch_id),
                "member_id": str(event.member_id),
                "member_name": name,
                "member_number": number,
                "authorized_by_user_id": str(event.recorded_by),
                "authorized_by_name": staff_names.get(event.recorded_by, str(event.recorded_by)),
                "occurred_at": event.occurred_at.isoformat(),
                "reason_codes": event.access_warnings,
            }
            for event, name, number in rows
        ]


@router.post("/branches/{branch_id}/samples/{entitlement_id}", response_model=ClassSampleCheckInResponse, status_code=201,
             responses=_RESPONSES)
def record_class_sample_check_in(
    branch_id: UUID,
    entitlement_id: UUID,
    request: Request,
    response: Response,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128,
                                 pattern=r"^[A-Za-z0-9._:-]+$"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
):
    dto = service.record_class_sample_check_in(
        request.app.state.session_factory, principal, branch_id, entitlement_id, idempotency_key)
    if dto.replayed:
        response.status_code = 200
    return dto


@router.post("/branches/{branch_id}/periods/{period_id}", response_model=MemberCheckInResponse, status_code=201,
             responses=_RESPONSES)
def record_member_check_in(
    branch_id: UUID,
    period_id: UUID,
    request: Request,
    response: Response,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128,
                                 pattern=r"^[A-Za-z0-9._:-]+$"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
    payload: CheckInRequest | None = None,
):
    dto = service.record_member_check_in(
        request.app.state.session_factory, principal, branch_id, period_id, idempotency_key,
        confirm_outstanding_balance=payload.confirm_outstanding_balance if payload else False)
    if dto.replayed:
        response.status_code = 200
    return dto
