"""Staff schedules HTTP transport: parse the request, call one `app.staff.schedules` function."""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.deps import RosterPrincipal, SessionFactoryDep, get_roster_principal as _principal
from app.staff import schedules as service
from app.staff.schemas import OccurrenceEdit, SeriesCreate, SeriesEdit

router = APIRouter(prefix="/api/v1/staff-schedules", tags=["staff-schedules"])


@router.post("/branches/{branch_id}/profiles/{profile_id}", status_code=201)
def create_series(branch_id: UUID, profile_id: UUID, payload: SeriesCreate,
                  principal: RosterPrincipal = Depends(_principal), *, factory: SessionFactoryDep):
    return service.create_series(factory, principal, branch_id, profile_id, payload)


@router.get("/branches/{branch_id}")
def list_series(branch_id: UUID, principal: RosterPrincipal = Depends(_principal), *, factory: SessionFactoryDep):
    return service.list_series(factory, principal, branch_id)


@router.get("/{series_id}/occurrences")
def list_occurrences(series_id: UUID, from_date: date = Query(), to_date: date = Query(),
                     principal: RosterPrincipal = Depends(_principal), *, factory: SessionFactoryDep):
    return service.list_occurrences(factory, principal, series_id, from_date, to_date)


@router.put("/{series_id}/occurrences/{local_date}")
def edit_occurrence(series_id: UUID, local_date: date, payload: OccurrenceEdit,
                    principal: RosterPrincipal = Depends(_principal), *, factory: SessionFactoryDep):
    return service.edit_occurrence(factory, principal, series_id, local_date, payload)


@router.patch("/{series_id}/edit", status_code=201)
def edit_series(series_id: UUID, payload: SeriesEdit, principal: RosterPrincipal = Depends(_principal),
                *, factory: SessionFactoryDep):
    return service.edit_series(factory, principal, series_id, payload)


@router.delete("/{series_id}", status_code=204)
def delete_series(series_id: UUID, principal: RosterPrincipal = Depends(_principal), *, factory: SessionFactoryDep):
    service.delete_series(factory, principal, series_id)
