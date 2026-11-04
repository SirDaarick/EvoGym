"""Owner-only role management HTTP transport: parse the request, call one `app.auth.role_management` function."""
from uuid import UUID

from fastapi import APIRouter

from app.api.deps import AdminDep, SessionFactoryDep
from app.auth import role_management as service
from app.auth.schemas import AssignmentPayload, BundlePayload, ReceptionPayload

router = APIRouter(prefix="/api/v1/admin/role-management", tags=["admin role management"])


@router.get("/me")
def get_current_owner_status(principal: AdminDep, *, factory: SessionFactoryDep):
    return service.get_current_owner_status(factory, principal)


@router.get("/staff")
def list_staff_accounts(principal: AdminDep, *, factory: SessionFactoryDep):
    return service.list_staff_accounts(factory, principal)


@router.get("/branches")
def list_active_branches(principal: AdminDep, *, factory: SessionFactoryDep):
    return service.list_active_branches(factory, principal)


@router.get("/bundles")
def list_role_bundles(principal: AdminDep, *, factory: SessionFactoryDep):
    return service.list_role_bundles(factory, principal)


@router.post("/bundles", status_code=201)
def create_role_bundle(payload: BundlePayload, principal: AdminDep, *, factory: SessionFactoryDep):
    return service.create_role_bundle(factory, principal, payload)


@router.put("/bundles/{bundle_id}")
def replace_role_bundle(bundle_id: UUID, payload: BundlePayload, principal: AdminDep, *, factory: SessionFactoryDep):
    return service.replace_role_bundle(factory, principal, bundle_id, payload)


@router.delete("/bundles/{bundle_id}")
def deactivate_role_bundle(bundle_id: UUID, principal: AdminDep, *, factory: SessionFactoryDep):
    return service.deactivate_role_bundle(factory, principal, bundle_id)


@router.post("/assignments", status_code=201)
def assign_role_bundle(payload: AssignmentPayload, principal: AdminDep, *, factory: SessionFactoryDep):
    return service.assign_role_bundle(factory, principal, payload)


@router.get("/assignments")
def list_assignments(principal: AdminDep, *, factory: SessionFactoryDep):
    return service.list_assignments(factory, principal)


@router.delete("/assignments/{assignment_id}")
def revoke_assignment(assignment_id: UUID, principal: AdminDep, *, factory: SessionFactoryDep):
    return service.revoke_assignment(factory, principal, assignment_id)


@router.post("/staff/{staff_id}/admin", status_code=201)
def grant_admin(staff_id: UUID, principal: AdminDep, *, factory: SessionFactoryDep):
    return service.grant_admin(factory, principal, staff_id)


@router.delete("/staff/{staff_id}/admin")
def revoke_admin(staff_id: UUID, principal: AdminDep, *, factory: SessionFactoryDep):
    return service.revoke_admin(factory, principal, staff_id)


@router.post("/staff/{staff_id}/reception", status_code=201)
def grant_reception(staff_id: UUID, payload: ReceptionPayload, principal: AdminDep, *, factory: SessionFactoryDep):
    return service.grant_reception(factory, principal, staff_id, payload)


@router.delete("/staff/{staff_id}/reception/{branch_id}")
def revoke_reception(staff_id: UUID, branch_id: UUID, principal: AdminDep, *, factory: SessionFactoryDep):
    return service.revoke_reception(factory, principal, staff_id, branch_id)
