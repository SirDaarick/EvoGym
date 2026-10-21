"""Branch-scoped employee roster, separate from staff authentication accounts."""
from dataclasses import dataclass
from datetime import datetime, time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.auth.sessions import validate_session
from app.db.models import Branch, StaffRosterProfile

router = APIRouter(prefix="/api/v1/staff-roster", tags=["staff-roster"])
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class RosterPrincipal:
    staff_id: UUID
    is_admin: bool
    branch_id: UUID | None


class StaffRosterCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str = Field(min_length=1, max_length=160)
    position: str = Field(min_length=1, max_length=80)


class StaffRosterUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str | None = Field(default=None, min_length=1, max_length=160)
    position: str | None = Field(default=None, min_length=1, max_length=80)
    is_active: bool | None = None
    expected_entry_time: time | None = None
    grace_tolerance_minutes: int | None = Field(default=None, ge=0, le=1440)


class StaffRosterItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    branch_id: UUID
    full_name: str
    position: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    expected_entry_time: time | None = None
    grace_tolerance_minutes: int | None = None


class StaffRosterPage(BaseModel):
    items: list[StaffRosterItem]
    total: int


def _principal(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> RosterPrincipal:
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503, "Database unavailable.")
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")
    token = credentials.credentials
    if request.app.state.settings.admin_auth_configured:
        try:
            staff_id, _session_id = validate_admin_session(factory, token)
            return RosterPrincipal(staff_id, True, None)
        except (AuthorizationDenied, ValueError):
            pass
    try:
        principal = validate_session(factory, token, Permission.STAFF_ROSTER_READ)
        return RosterPrincipal(principal.staff_id, False, principal.branch_id)
    except (AuthorizationDenied, ValueError):
        raise HTTPException(401, "Authentication failed.") from None


def _allowed_branches(session, principal: RosterPrincipal, requested_id: UUID | None) -> list[Branch]:
    if not principal.is_admin:
        if requested_id is not None and requested_id != principal.branch_id:
            raise HTTPException(404, "Branch not found.")
        requested_id = principal.branch_id
    query = select(Branch).where(Branch.is_active.is_(True))
    if requested_id is not None:
        query = query.where(Branch.id == requested_id)
    branches = session.scalars(query.order_by(Branch.code)).all()
    authorized = []
    for branch in branches:
        try:
            authorize(session, principal.staff_id, Permission.STAFF_ROSTER_READ, branch.id)
        except AuthorizationDenied:
            continue
        authorized.append(branch)
    if requested_id is not None and not authorized:
        raise HTTPException(404, "Branch not found.")
    return authorized


def _require_manage(session, principal: RosterPrincipal, branch_id: UUID) -> Branch:
    try:
        authorize(session, principal.staff_id, Permission.STAFF_ROSTER_MANAGE, branch_id)
    except AuthorizationDenied:
        raise HTTPException(403, "Roster management is restricted to Admin.") from None
    branch = session.get(Branch, branch_id)
    if branch is None or not branch.is_active:
        raise HTTPException(404, "Branch not found.")
    return branch


@router.get("", response_model=StaffRosterPage)
def list_staff_roster(
    request: Request,
    branch_id: UUID | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    principal: RosterPrincipal = Depends(_principal),
):
    factory = request.app.state.session_factory
    with factory() as session:
        branches = _allowed_branches(session, principal, branch_id)
        ids = [branch.id for branch in branches]
        query = select(StaffRosterProfile).where(StaffRosterProfile.branch_id.in_(ids))
        count_query = select(func.count()).select_from(StaffRosterProfile).where(StaffRosterProfile.branch_id.in_(ids))
        if not include_inactive:
            query = query.where(StaffRosterProfile.is_active.is_(True))
            count_query = count_query.where(StaffRosterProfile.is_active.is_(True))
        rows = session.scalars(query.order_by(StaffRosterProfile.full_name, StaffRosterProfile.id)).all() if ids else []
        total = session.scalar(count_query) if ids else 0
        return StaffRosterPage(items=rows, total=total)


@router.post("/branches/{branch_id}", response_model=StaffRosterItem, status_code=201)
def create_staff_profile(
    branch_id: UUID, payload: StaffRosterCreate, request: Request,
    principal: RosterPrincipal = Depends(_principal),
):
    factory = request.app.state.session_factory
    try:
        with factory.begin() as session:
            _require_manage(session, principal, branch_id)
            profile = StaffRosterProfile(branch_id=branch_id, full_name=payload.full_name, position=payload.position)
            session.add(profile)
            session.flush()
            return StaffRosterItem.model_validate(profile)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from None
    except IntegrityError as exc:
        if "uq_staff_roster_branch_name" not in str(exc.orig) and "staff_roster_profiles.branch_id" not in str(exc.orig):
            raise
        raise HTTPException(409, "An employee with this name already exists in the branch.") from None


@router.patch("/{profile_id}", response_model=StaffRosterItem)
def update_staff_profile(
    profile_id: UUID, payload: StaffRosterUpdate, request: Request,
    principal: RosterPrincipal = Depends(_principal),
):
    factory = request.app.state.session_factory
    try:
        with factory.begin() as session:
            profile = session.get(StaffRosterProfile, profile_id)
            if profile is None:
                raise HTTPException(404, "Staff profile not found.")
            _require_manage(session, principal, profile.branch_id)
            changes = payload.model_dump(exclude_unset=True)
            if "branch_id" in changes:
                raise HTTPException(422, "A roster profile cannot be moved between branches.")
            for key, value in changes.items():
                if value is None:
                    raise HTTPException(422, "Roster fields cannot be null.")
                setattr(profile, key, value)
            if (profile.expected_entry_time is None) != (profile.grace_tolerance_minutes is None):
                raise HTTPException(422, "Expected entry time and grace tolerance must be configured together.")
            session.flush()
            return StaffRosterItem.model_validate(profile)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from None
    except IntegrityError as exc:
        if "uq_staff_roster_branch_name" not in str(exc.orig) and "staff_roster_profiles.branch_id" not in str(exc.orig):
            raise
        raise HTTPException(409, "An employee with this name already exists in the branch.") from None
