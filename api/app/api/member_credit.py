"""Member credit (saldo a favor) HTTP transport: parse the request, call one `app.credit.service` function."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response

from app.api.deps import SessionDep, SessionFactoryDep
from app.api.shifts import ShiftActorPrincipal, get_shift_actor_principal
from app.credit import service
from app.credit.schemas import MemberCreditDepositRequest, MemberCreditMovementDTO, MemberCreditMovementPage

router = APIRouter(prefix="/api/v1", tags=["member-credit"])

IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128,
                                       pattern=r"^[A-Za-z0-9._:-]+$")]
Principal = Annotated[ShiftActorPrincipal, Depends(get_shift_actor_principal)]


@router.post("/registers/{register_id}/member-credit-deposits", response_model=MemberCreditMovementDTO, status_code=201)
def post_credit_deposit_endpoint(
    register_id: UUID, payload: MemberCreditDepositRequest, response: Response, idempotency_key: IdempotencyKey,
    principal: Principal, *, factory: SessionFactoryDep,
) -> MemberCreditMovementDTO:
    """Collect cash into a member's saldo a favor on the current open branch shift."""
    dto, replayed = service.post_credit_deposit(factory, principal, register_id, payload, idempotency_key)
    if replayed:
        response.status_code = 200
    return dto


@router.get("/members/{member_id}/credit-movements", response_model=MemberCreditMovementPage)
def list_credit_movements_endpoint(
    member_id: UUID, principal: Principal, *, session: SessionDep,
    offset: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=200),
) -> MemberCreditMovementPage:
    """Newest-first saldo a favor ledger for one member."""
    return service.list_credit_movements(session, principal, member_id, offset, limit)
