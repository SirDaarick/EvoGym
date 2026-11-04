"""Member reads HTTP transport: parse the request, call one `app.members.service` function."""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query

from app.api.deps import SessionFactoryDep
from app.api.members import MemberActorPrincipal, get_member_actor_principal
from app.members import service
from app.members.read_schemas import MemberReloadResponseDTO

router = APIRouter(prefix="/api/v1/members", tags=["member-reads"])


@router.get("/{member_id}/purchases")
def member_purchases(
    member_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    from_date: date | None = None,
    to_date: date | None = None,
    branch_id: UUID | None = Query(default=None),
    x_branch_id: UUID | None = Header(default=None, alias="X-Branch-ID"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
    *, factory: SessionFactoryDep,
) -> dict:
    return service.member_purchases(factory, principal, member_id, page=page, page_size=page_size,
                                    from_date=from_date, to_date=to_date, branch_id=branch_id, x_branch_id=x_branch_id)


@router.get("/{member_id}/summary")
def member_summary(
    member_id: UUID,
    branch_id: UUID | None = Query(default=None),
    x_branch_id: UUID | None = Header(default=None, alias="X-Branch-ID"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
    *, factory: SessionFactoryDep,
) -> dict:
    return service.member_summary(factory, principal, member_id, branch_id, x_branch_id)


@router.get("/{member_id}/check-ins")
def member_check_in_history(
    member_id: UUID,
    month: int = Query(ge=1, le=12),
    year: int = Query(ge=1, le=9998),
    branch_id: UUID | None = Query(default=None),
    x_branch_id: UUID | None = Header(default=None, alias="X-Branch-ID"),
    x_organization_id: UUID | None = Header(default=None, alias="X-Organization-ID"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
    *, factory: SessionFactoryDep,
) -> list[dict]:
    return service.member_check_in_history(factory, principal, member_id, month=month, year=year, branch_id=branch_id,
                                           x_branch_id=x_branch_id, x_organization_id=x_organization_id)


@router.get("/{member_id}/reload", response_model=MemberReloadResponseDTO)
def reload_member_endpoint(
    member_id: UUID,
    visit_limit: int = Query(default=20, ge=1, le=50, description="Max recent visits to return"),
    branch_id: UUID | None = Query(default=None, description="Optional branch context override for Admin"),
    x_branch_id: UUID | None = Header(default=None, alias="X-Branch-ID"),
    x_organization_id: UUID | None = Header(default=None, alias="X-Organization-ID"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
    *, factory: SessionFactoryDep,
) -> MemberReloadResponseDTO:
    """Retrieve durable reloadable operational and entitlement state for a member (D-001, D-012)."""
    return service.reload_member(factory, principal, member_id, visit_limit=visit_limit, branch_id=branch_id,
                                 x_branch_id=x_branch_id, x_organization_id=x_organization_id)
