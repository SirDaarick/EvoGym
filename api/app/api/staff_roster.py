"""Branch-scoped employee roster HTTP transport: parse the request, call one `app.staff.roster` function."""
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.deps import RosterPrincipal, SessionFactoryDep, get_roster_principal as _principal
from app.staff import roster as service
from app.staff.schemas import (
    StaffRosterCreate, StaffRosterItem, StaffRosterPage, StaffRosterPatchResult, StaffRosterUpdate,
)

router = APIRouter(prefix="/api/v1/staff-roster", tags=["staff-roster"])


@router.get("", response_model=StaffRosterPage)
def list_staff_roster(
    branch_id: UUID | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    principal: RosterPrincipal = Depends(_principal),
    *, factory: SessionFactoryDep,
):
    return service.list_staff_roster(factory, principal, branch_id, include_inactive)


@router.post("/branches/{branch_id}", response_model=StaffRosterItem, status_code=201)
def create_staff_profile(
    branch_id: UUID, payload: StaffRosterCreate, principal: RosterPrincipal = Depends(_principal),
    *, factory: SessionFactoryDep,
):
    return service.create_staff_profile(factory, principal, branch_id, payload)


@router.patch("/{profile_id}", response_model=StaffRosterPatchResult, response_model_exclude_unset=True)
def update_staff_profile(
    profile_id: UUID, payload: StaffRosterUpdate, principal: RosterPrincipal = Depends(_principal),
    *, factory: SessionFactoryDep,
):
    return service.update_staff_profile(factory, principal, profile_id, payload)
