"""Member check-in HTTP transport: call one `app.memberships.service` function and set the replay status."""
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request, Response

from app.api.members import MemberActorPrincipal, get_member_actor_principal
from app.errors import CheckInConflictResponse, ValidationErrorResponse
from app.memberships import service
from app.memberships.schemas import ClassSampleCheckInResponse, MemberCheckInResponse

router = APIRouter(prefix="/api/v1/member-check-ins", tags=["member-check-ins"])

_RESPONSES = {409: {"model": CheckInConflictResponse}, 422: {"model": ValidationErrorResponse}}


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
):
    dto = service.record_member_check_in(
        request.app.state.session_factory, principal, branch_id, period_id, idempotency_key)
    if dto.replayed:
        response.status_code = 200
    return dto
