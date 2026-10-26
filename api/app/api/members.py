"""Member API endpoints."""
from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import InterfaceError, OperationalError, TimeoutError

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.db.models.members import MemberEligibilityRecord, MemberNote
from app.members.queries import (
    DuplicateMemberNumberError,
    add_member_eligibility,
    add_member_note,
    create_member,
    get_member_by_id,
    get_member_pending_balance_minor,
    list_member_eligibility,
    list_member_notes,
    list_members,
    revoke_member_eligibility,
    update_member,
    void_member_note,
)
from app.members.schemas import (
    CreateMemberDTO,
    CreateMemberEligibilityDTO,
    CreateMemberNoteDTO,
    MemberDetailDTO,
    MemberEligibilityDTO,
    MemberListItemDTO,
    MemberListResponseDTO,
    MemberNoteDTO,
    UpdateMemberDTO,
)

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

    # 1. Check if Admin Bearer only when token verification is configured.
    settings = request.app.state.settings
    if settings.admin_auth_configured and settings.admin_token_signing_configured:
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


def _to_note_dto(note: MemberNote) -> MemberNoteDTO:
    return MemberNoteDTO(
        id=str(note.id),
        member_id=str(note.member_id),
        author_id=str(note.author_id),
        body=note.body,
        created_at=note.created_at,
        voided_at=note.voided_at,
        voided_by=str(note.voided_by) if note.voided_by else None,
        is_voided=note.is_voided,
    )


def _to_eligibility_dto(record: MemberEligibilityRecord) -> MemberEligibilityDTO:
    return MemberEligibilityDTO(
        id=str(record.id),
        member_id=str(record.member_id),
        eligibility_type=record.eligibility_type,
        verified_by=str(record.verified_by),
        verified_at=record.verified_at,
        valid_until=record.valid_until,
        notes=record.notes,
        is_valid=record.is_valid,
        revoked_at=record.revoked_at,
        revoked_by=str(record.revoked_by) if record.revoked_by else None,
    )


def _to_member_detail_dto(member, is_admin: bool, pending_balance_minor: int = 0) -> MemberDetailDTO:
    notes = member.notes if is_admin else None
    return MemberDetailDTO(
        id=str(member.id),
        member_number=member.member_number,
        full_name=member.full_name,
        preferred_name=member.preferred_name,
        phone=member.phone,
        email=member.email,
        birth_date=member.birth_date,
        emergency_contact_name=member.emergency_contact_name,
        emergency_contact_phone=member.emergency_contact_phone,
        notes=notes,
        status=member.status,
        joined_on=member.joined_on,
        credit_balance_minor=member.credit_balance_minor,
        photo_url=member.photo_url,
        pending_balance_minor=pending_balance_minor,
        has_pending_balance=pending_balance_minor > 0,
    )



@router.get("", response_model=MemberListResponseDTO)
def list_members_endpoint(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, max_length=100),
    status: str | None = Query(None, max_length=24),
    sort_by: str = Query("full_name", pattern="^(full_name|joined_on|member_number)$"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
) -> MemberListResponseDTO:
    """List members with pagination, optional search, status filtering, and sorting."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        result = list_members(
            session,
            page=page,
            limit=limit,
            search=search,
            status=status,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
        return MemberListResponseDTO(
            items=[
                MemberListItemDTO(
                    id=str(item.id),
                    member_number=item.member_number,
                    full_name=item.full_name,
                    preferred_name=item.preferred_name,
                    phone=item.phone,
                    status=item.status,
                    joined_on=item.joined_on,
                    credit_balance_minor=item.credit_balance_minor,
                    emergency_contact_name=item.emergency_contact_name,
                    emergency_contact_phone=item.emergency_contact_phone,
                    photo_url=item.photo_url,
                )
                for item in result.items
            ],
            total=result.total,
            page=page,
            limit=limit,
            pages=result.pages,
        )


@router.post("", response_model=MemberDetailDTO, status_code=201)
def create_member_endpoint(
    payload: CreateMemberDTO,
    request: Request,
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
) -> MemberDetailDTO:
    """Create a new member. Accessible by Admin and Staff with operational read."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        try:
            member = create_member(
                session,
                payload,
                actor_id=principal.staff_id,
                is_admin=principal.is_admin,
            )
            session.commit()
            return _to_member_detail_dto(member, principal.is_admin)
        except DuplicateMemberNumberError as exc:
            session.rollback()
            raise HTTPException(409, "Member number already exists.") from exc


@router.get("/{member_id}", response_model=MemberDetailDTO)
def get_member_endpoint(
    member_id: UUID,
    request: Request,
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
) -> MemberDetailDTO:
    """Retrieve detailed member profile.

    D-012: Receptionist visibility is restricted to the operational profile.
    Sensitive fields like internal notes are strictly reserved for Admin actors.
    """
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        member = get_member_by_id(session, member_id)
        if member is None:
            raise HTTPException(404, "The requested resource was not found.")
        pending_balance_minor = get_member_pending_balance_minor(session, member.id)
        return _to_member_detail_dto(member, principal.is_admin, pending_balance_minor)


@router.patch("/{member_id}", response_model=MemberDetailDTO)
def update_member_endpoint(
    member_id: UUID,
    payload: UpdateMemberDTO,
    request: Request,
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
) -> MemberDetailDTO:
    """Update existing member attributes under concurrency row locking.

    Accessible by Admin and Staff with operational read.
    Sensitive notes field is redacted for Receptionist principals (D-012).
    """
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        member = update_member(session, member_id, payload)
        if member is None:
            raise HTTPException(404, "The requested resource was not found.")
        session.commit()
        pending_balance_minor = get_member_pending_balance_minor(session, member.id)
        return _to_member_detail_dto(member, principal.is_admin, pending_balance_minor)



@router.get("/{member_id}/notes", response_model=list[MemberNoteDTO])
def list_member_notes_endpoint(
    member_id: UUID,
    request: Request,
    include_voided: bool = Query(False),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
) -> list[MemberNoteDTO]:
    """List restricted notes for a member. Admin only."""
    if not principal.is_admin:
        raise HTTPException(403, "Access restricted to admin.")

    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        member = get_member_by_id(session, member_id)
        if member is None:
            raise HTTPException(404, "The requested resource was not found.")
        notes = list_member_notes(session, member_id, include_voided=include_voided)
        return [_to_note_dto(n) for n in notes]


@router.post("/{member_id}/notes", response_model=MemberNoteDTO, status_code=201)
def create_member_note_endpoint(
    member_id: UUID,
    payload: CreateMemberNoteDTO,
    request: Request,
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
) -> MemberNoteDTO:
    """Create a new restricted note for a member. Admin only."""
    if not principal.is_admin:
        raise HTTPException(403, "Access restricted to admin.")

    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        member = get_member_by_id(session, member_id)
        if member is None:
            raise HTTPException(404, "The requested resource was not found.")
        note = add_member_note(session, member_id, principal.staff_id, payload.body)
        session.commit()
        return _to_note_dto(note)


@router.post("/{member_id}/notes/{note_id}/void", response_model=MemberNoteDTO)
def void_member_note_endpoint(
    member_id: UUID,
    note_id: UUID,
    request: Request,
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
) -> MemberNoteDTO:
    """Soft-delete / void a restricted member note. Admin only."""
    if not principal.is_admin:
        raise HTTPException(403, "Access restricted to admin.")

    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        member = get_member_by_id(session, member_id)
        if member is None:
            raise HTTPException(404, "The requested resource was not found.")
        note = session.get(MemberNote, note_id)
        if note is None or note.member_id != member_id:
            raise HTTPException(404, "The requested resource was not found.")
        voided_note = void_member_note(session, note_id, principal.staff_id)
        session.commit()
        return _to_note_dto(voided_note)


@router.get("/{member_id}/eligibility", response_model=list[MemberEligibilityDTO])
def list_member_eligibility_endpoint(
    member_id: UUID,
    request: Request,
    only_active: bool = Query(True),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
) -> list[MemberEligibilityDTO]:
    """List eligibility attestation records for a member. Accessible by Admin and Staff."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        member = get_member_by_id(session, member_id)
        if member is None:
            raise HTTPException(404, "The requested resource was not found.")
        records = list_member_eligibility(session, member_id, only_active=only_active)
        return [_to_eligibility_dto(r) for r in records]


@router.post("/{member_id}/eligibility", response_model=MemberEligibilityDTO, status_code=201)
def create_member_eligibility_endpoint(
    member_id: UUID,
    payload: CreateMemberEligibilityDTO,
    request: Request,
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
) -> MemberEligibilityDTO:
    """Create a verified eligibility record for a member. Admin only."""
    if not principal.is_admin:
        raise HTTPException(403, "Access restricted to admin.")

    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        member = get_member_by_id(session, member_id)
        if member is None:
            raise HTTPException(404, "The requested resource was not found.")
        record = add_member_eligibility(
            session,
            member_id=member_id,
            eligibility_type=payload.eligibility_type,
            verified_by=principal.staff_id,
            valid_until=payload.valid_until,
            notes=payload.notes,
        )
        session.commit()
        return _to_eligibility_dto(record)


@router.post("/{member_id}/eligibility/{record_id}/revoke", response_model=MemberEligibilityDTO)
def revoke_member_eligibility_endpoint(
    member_id: UUID,
    record_id: UUID,
    request: Request,
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
) -> MemberEligibilityDTO:
    """Revoke an active eligibility record. Admin only."""
    if not principal.is_admin:
        raise HTTPException(403, "Access restricted to admin.")

    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    with factory() as session:
        member = get_member_by_id(session, member_id)
        if member is None:
            raise HTTPException(404, "The requested resource was not found.")
        record = session.get(MemberEligibilityRecord, record_id)
        if record is None or record.member_id != member_id:
            raise HTTPException(404, "The requested resource was not found.")
        revoked_record = revoke_member_eligibility(session, record_id, principal.staff_id)
        session.commit()
        return _to_eligibility_dto(revoked_record)

