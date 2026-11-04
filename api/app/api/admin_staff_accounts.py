"""Admin-only staff-account HTTP transport: parse the request, call one `app.auth.staff_accounts` function."""
from uuid import UUID

from fastapi import APIRouter, Query, Response

from app.api.deps import AdminDep, SessionFactoryDep
from app.auth import staff_accounts as service
from app.auth.schemas import (
    AdminBranchPage, AdminRosterProfilePage, ReceptionStationCreateRequest, ReceptionStationIssued,
    ReceptionStationPage, ResolveProductSaleIntentRequest, StaffAccountLinkRequest, StaffAccountLinkResult,
    StaffAccountPage,
)

router = APIRouter(prefix="/api/v1/admin/staff-accounts", tags=["admin staff accounts"])


@router.post("/deactivate/{staff_id}", status_code=204)
def deactivate_staff_account(staff_id: UUID, principal: AdminDep, *, factory: SessionFactoryDep):
    """Disable one global employee login and revoke only that account's trust."""
    service.deactivate_staff_account(factory, principal, staff_id)
    return Response(status_code=204)


@router.get("/{staff_id}/product-sale-intent")
def get_staff_product_sale_intent(staff_id: UUID, principal: AdminDep, *, factory: SessionFactoryDep):
    return service.get_staff_product_sale_intent(factory, principal, staff_id)


@router.post("/{staff_id}/product-sale-intent/resolve")
def resolve_staff_product_sale_intent(staff_id: UUID, body: ResolveProductSaleIntentRequest, principal: AdminDep, *, factory: SessionFactoryDep):
    return service.resolve_staff_product_sale_intent(factory, principal, staff_id, body)


@router.get("/reception-stations", response_model=ReceptionStationPage)
def list_reception_stations(principal: AdminDep, *, factory: SessionFactoryDep, branch_id: UUID = Query()):
    return service.list_reception_stations(factory, principal, branch_id)


@router.post("/reception-stations", response_model=ReceptionStationIssued, status_code=201)
def issue_reception_station(payload: ReceptionStationCreateRequest, principal: AdminDep, *, factory: SessionFactoryDep):
    result = service.issue_reception_station(factory, principal, payload)
    return Response(content=result.model_dump_json(), status_code=201, media_type="application/json",
                    headers={"Cache-Control": "no-store"})


@router.post("/reception-stations/{station_id}/revoke", status_code=204)
def revoke_reception_station(station_id: UUID, principal: AdminDep, *, factory: SessionFactoryDep, branch_id: UUID = Query()):
    service.revoke_reception_station(factory, principal, station_id, branch_id)
    return Response(status_code=204)


@router.get("", response_model=StaffAccountPage)
def list_staff_accounts(principal: AdminDep, *, factory: SessionFactoryDep, branch_id: UUID = Query()):
    return service.list_staff_accounts(factory, principal, branch_id)


@router.get("/branches", response_model=AdminBranchPage)
def list_admin_branches(principal: AdminDep, *, factory: SessionFactoryDep):
    return service.list_admin_branches(factory, principal)


@router.get("/roster-profiles", response_model=AdminRosterProfilePage, response_model_exclude_unset=True)
def list_admin_roster_profiles(principal: AdminDep, *, factory: SessionFactoryDep, branch_id: UUID = Query()):
    return service.list_admin_roster_profiles(factory, principal, branch_id)


@router.post("/roster-profiles/{profile_id}/link", response_model=StaffAccountLinkResult)
def link_staff_account(profile_id: UUID, payload: StaffAccountLinkRequest, principal: AdminDep, *, factory: SessionFactoryDep):
    return service.link_staff_account(factory, principal, profile_id, payload)
