"""Member reloadable read endpoints conforming to P2.2 specification."""
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.members import MemberActorPrincipal, get_member_actor_principal
from app.db.models.authorization import Branch
from app.members.read_queries import get_member_reload_data
from app.members.read_schemas import MemberReloadResponseDTO

router = APIRouter(prefix="/api/v1/members", tags=["member-reads"])


def _resolve_caller_branch(
    session: Session,
    principal: MemberActorPrincipal,
    query_branch_id: UUID | None,
    header_branch_id: UUID | None,
) -> UUID:
    """Resolve authoritative branch context, validating non-admin branch assignment."""
    if not principal.is_admin:
        if principal.branch_id is None:
            raise HTTPException(
                status_code=403,
                detail="Actor lacks member read grant or branch assignment.",
            )
        target_branch = query_branch_id or header_branch_id
        if target_branch is not None and target_branch != principal.branch_id:
            raise HTTPException(
                status_code=403,
                detail="Actor attempted an action outside their assigned branch context.",
            )
        return principal.branch_id

    # Admin may specify target branch via query or header, or fall back to default
    if query_branch_id is not None:
        return query_branch_id
    if header_branch_id is not None:
        return header_branch_id
    if principal.branch_id is not None:
        return principal.branch_id

    # Resolve first active branch from database or fallback UUID
    active_branch_id = session.scalar(
        select(Branch.id).where(Branch.is_active.is_(True)).limit(1)
    )
    if active_branch_id is not None:
        return active_branch_id
    return UUID("00000000-0000-0000-0000-000000000001")


@router.get("/{member_id}/reload", response_model=MemberReloadResponseDTO)
def reload_member_endpoint(
    member_id: UUID,
    request: Request,
    visit_limit: int = Query(default=20, ge=1, le=50, description="Max recent visits to return"),
    branch_id: UUID | None = Query(default=None, description="Optional branch context override for Admin"),
    x_branch_id: UUID | None = Header(default=None, alias="X-Branch-ID"),
    x_organization_id: UUID | None = Header(default=None, alias="X-Organization-ID"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
) -> MemberReloadResponseDTO:
    """Retrieve durable reloadable operational and entitlement state for a member.

    Satisfies FE05 gap resolution by projecting stable period, debt, sample, and visit UUIDs.
    Enforces D-001 (organization-shared profile with branch-partitioned transactions)
    and D-012 (role-projected financial ledger vs receptionist warning flag).
    """
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(status_code=500, detail="Database session factory not configured.")

    with factory() as session:
        caller_branch_id = _resolve_caller_branch(
            session=session,
            principal=principal,
            query_branch_id=branch_id,
            header_branch_id=x_branch_id,
        )

        reload_dto = get_member_reload_data(
            session=session,
            member_id=member_id,
            principal_is_admin=principal.is_admin,
            caller_branch_id=caller_branch_id,
            caller_org_id=x_organization_id,
            visit_limit=visit_limit,
        )

        if reload_dto is None:
            raise HTTPException(status_code=404, detail="The requested resource was not found.")

        return reload_dto
