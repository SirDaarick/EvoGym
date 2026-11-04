"""Member HTTP transport: parse the request, call one `app.members.service` function, shape the response."""
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import InterfaceError, OperationalError, TimeoutError

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.members import service
from app.members.schemas import (
    CreateMemberDTO,
    CreateMemberEligibilityDTO,
    CreateMemberNoteDTO,
    MemberDetailDTO,
    MemberEligibilityDTO,
    MemberListResponseDTO,
    MemberNoteDTO,
    UpdateMemberDTO,
)
from app.api.deps import SessionFactoryDep

router = APIRouter(prefix="/api/v1/members", tags=["members"])
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class MemberActorPrincipal:
    """Authenticated actor principal for member operations."""

    staff_id: UUID
    is_admin: bool
    branch_id: UUID | None


def get_member_actor_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> MemberActorPrincipal:
    """Authenticate either an Admin or Staff actor with member read permission."""
    factory = request.app.state.session_factory
    if factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")

    token = credentials.credentials

    # Admin sessions require the configured signed-token contract; never fall back to an unsigned admin token.
    settings = getattr(request.app.state, "settings", None)
    if (
        settings
        and getattr(settings, "admin_auth_configured", False)
        and getattr(settings, "admin_token_signing_configured", False)
    ):
        try:
            staff_id, _session_id = validate_admin_session(
                factory, token, settings.admin_token_signing_secret.get_secret_value()
            )
            return MemberActorPrincipal(staff_id=staff_id, is_admin=True, branch_id=None)
        except AuthorizationDenied:
            pass
        except (OperationalError, InterfaceError, TimeoutError):
            raise HTTPException(503, "Authentication service unavailable.") from None

    # 2. Check if Staff Bearer with Permission.MEMBER_OPERATIONAL_READ
    try:
        principal = validate_session(factory, token, Permission.MEMBER_OPERATIONAL_READ)
        return MemberActorPrincipal(
            staff_id=principal.staff_id,
            is_admin=False,
            branch_id=principal.branch_id,
        )
    except AuthorizationDenied:
        pass
    except (OperationalError, InterfaceError, TimeoutError):
        raise HTTPException(503, "Authentication service unavailable.") from None

    raise HTTPException(401, "Authentication failed.")


Principal = Annotated[MemberActorPrincipal, Depends(get_member_actor_principal)]


@router.get("", response_model=MemberListResponseDTO)
def list_members_endpoint(
    principal: Principal,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, max_length=100),
    status: str | None = Query(None, max_length=24),
    sort_by: str = Query("full_name", pattern="^(full_name|joined_on|member_number)$"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    *, factory: SessionFactoryDep,
) -> MemberListResponseDTO:
    """List members with pagination, optional search, status filtering, and sorting."""
    return service.list_members(factory, page=page, limit=limit, search=search, status=status,
                                sort_by=sort_by, sort_dir=sort_dir)


@router.post("", response_model=MemberDetailDTO, status_code=201)
def create_member_endpoint(payload: CreateMemberDTO, principal: Principal, *, factory: SessionFactoryDep) -> MemberDetailDTO:
    """Create a new member. Accessible by Admin and Staff with operational read."""
    return service.create_member(factory, principal, payload)


@router.get("/{member_id}", response_model=MemberDetailDTO)
def get_member_endpoint(member_id: UUID, principal: Principal, *, factory: SessionFactoryDep) -> MemberDetailDTO:
    """Retrieve detailed member profile (internal notes are Admin-only, D-012)."""
    return service.get_member(factory, principal, member_id)


@router.patch("/{member_id}", response_model=MemberDetailDTO)
def update_member_endpoint(
    member_id: UUID, payload: UpdateMemberDTO, principal: Principal, *, factory: SessionFactoryDep,
) -> MemberDetailDTO:
    """Update member attributes under row locking; notes are redacted for Receptionist principals (D-012)."""
    return service.update_member(factory, principal, member_id, payload)


@router.get("/{member_id}/notes", response_model=list[MemberNoteDTO])
def list_member_notes_endpoint(
    member_id: UUID, principal: Principal, include_voided: bool = Query(False), *, factory: SessionFactoryDep,
) -> list[MemberNoteDTO]:
    """List member notes for authenticated member-service staff and admins."""
    return service.list_notes(factory, member_id, include_voided)


@router.post("/{member_id}/notes", response_model=MemberNoteDTO, status_code=201)
def create_member_note_endpoint(
    member_id: UUID, payload: CreateMemberNoteDTO, principal: Principal, *, factory: SessionFactoryDep,
) -> MemberNoteDTO:
    """Create a member note for authenticated member-service staff and admins."""
    return service.create_note(factory, principal, member_id, payload)


@router.post("/{member_id}/notes/{note_id}/void", response_model=MemberNoteDTO)
def void_member_note_endpoint(
    member_id: UUID, note_id: UUID, principal: Principal, *, factory: SessionFactoryDep,
) -> MemberNoteDTO:
    """Soft-delete / void a restricted member note. Admin only."""
    return service.void_note(factory, principal, member_id, note_id)


@router.get("/{member_id}/eligibility", response_model=list[MemberEligibilityDTO])
def list_member_eligibility_endpoint(
    member_id: UUID, principal: Principal, only_active: bool = Query(True), *, factory: SessionFactoryDep,
) -> list[MemberEligibilityDTO]:
    """List eligibility attestation records for a member. Accessible by Admin and Staff."""
    return service.list_eligibility(factory, member_id, only_active)


@router.post("/{member_id}/eligibility", response_model=MemberEligibilityDTO, status_code=201)
def create_member_eligibility_endpoint(
    member_id: UUID, payload: CreateMemberEligibilityDTO, principal: Principal, *, factory: SessionFactoryDep,
) -> MemberEligibilityDTO:
    """Create a verified eligibility record for a member. Admin only."""
    return service.create_eligibility(factory, principal, member_id, payload)


@router.post("/{member_id}/eligibility/{record_id}/revoke", response_model=MemberEligibilityDTO)
def revoke_member_eligibility_endpoint(
    member_id: UUID, record_id: UUID, principal: Principal, *, factory: SessionFactoryDep,
) -> MemberEligibilityDTO:
    """Revoke an active eligibility record. Admin only."""
    return service.revoke_eligibility(factory, principal, member_id, record_id)
