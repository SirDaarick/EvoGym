from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.auth.admin import validate_admin_session, utc_now
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.owner import has_organization_permission, owner_registry
from app.db.models import (
    AdminLoginApproval, AdminPasswordCredential, AdminTrustedDevice, OrganizationOwner,
    RoleBundle, RoleBundleAssignment, RoleBundlePermission, RoleGrant, StaffSession, StaffUser,
)
from app.observability.logging import request_id
from app.observability.security import SecurityEventType, make_security_event, queue_security_event


router = APIRouter(prefix="/api/v1/admin/role-management", tags=["admin role management"])
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class AdminPrincipal:
    staff_id: UUID
    session_id: UUID


class BundlePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    permissions: list[str] = Field(min_length=1, max_length=20)


class AssignmentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    staff_id: UUID
    bundle_id: UUID
    scope_kind: Literal["organization", "branch"]
    branch_id: UUID | None = None


class ReceptionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_id: UUID


def _principal(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> AdminPrincipal:
    settings, factory = request.app.state.settings, request.app.state.session_factory
    if (not settings.admin_auth_configured or not settings.admin_token_signing_configured or factory is None
            or credentials is None or credentials.scheme.lower() != "bearer"):
        raise HTTPException(401, "Authentication failed.")
    try:
        staff_id, session_id = validate_admin_session(
            factory, credentials.credentials, settings.admin_token_signing_secret.get_secret_value()
        )
    except (AuthorizationDenied, ValueError):
        raise HTTPException(401, "Authentication failed.") from None
    return AdminPrincipal(staff_id, session_id)


def _lock_staff_and_owner(session, actor_id: UUID, target_id: UUID | None = None):
    ids = sorted({actor_id, *([target_id] if target_id is not None else [])}, key=str)
    staff_rows = session.scalars(select(StaffUser).where(StaffUser.id.in_(ids)).order_by(StaffUser.id)
                                 .execution_options(populate_existing=True).with_for_update()).all()
    staff_by_id = {row.id: row for row in staff_rows}
    actor, target = staff_by_id.get(actor_id), staff_by_id.get(target_id) if target_id else None
    if actor is None or not actor.is_active or (target_id is not None and (target is None or not target.is_active)):
        raise HTTPException(404, "The requested resource was not found.")
    ownership = session.scalar(select(OrganizationOwner).where(OrganizationOwner.id == 1)
                               .execution_options(populate_existing=True).with_for_update())
    if ownership is None or ownership.staff_id != actor_id:
        raise HTTPException(403, "Owner access is required.")
    return actor, target, ownership


def _permissions(values: list[str]) -> list[Permission]:
    if not values or len(set(values)) != len(values):
        raise HTTPException(422, "Permissions must be non-empty and unique.")
    try:
        return [Permission(value) for value in values]
    except (ValueError, TypeError):
        raise HTTPException(422, "An unknown permission was supplied.") from None


def _bundle_item(session, bundle: RoleBundle) -> dict:
    permissions = session.scalars(select(RoleBundlePermission.permission).where(
        RoleBundlePermission.bundle_id == bundle.id
    ).order_by(RoleBundlePermission.permission)).all()
    return {"id": bundle.id, "name": bundle.name, "permissions": permissions, "is_active": bundle.is_active}


@router.get("/me")
def get_current_owner_status(request: Request, principal: AdminPrincipal = Depends(_principal)):
    factory = request.app.state.session_factory
    with factory.begin() as session:
        actor = session.scalar(select(StaffUser).where(StaffUser.id == principal.staff_id)
                               .execution_options(populate_existing=True).with_for_update())
        ownership = owner_registry(session)
        is_owner = bool(actor and actor.is_active and ownership and ownership.staff_id == actor.id)
        return {"staff_id": principal.staff_id, "is_owner": is_owner,
                "can_manage_employees": bool(actor and actor.is_active and has_organization_permission(
                    session, actor.id, Permission.STAFF_EMPLOYEE_MANAGE
                ))}


@router.get("/staff")
def list_staff_accounts(request: Request, principal: AdminPrincipal = Depends(_principal)):
    with request.app.state.session_factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        rows = session.execute(select(StaffUser, AdminPasswordCredential)
                               .outerjoin(AdminPasswordCredential, AdminPasswordCredential.staff_id == StaffUser.id)
                               .where(StaffUser.is_active.is_(True)).order_by(StaffUser.login_identifier, StaffUser.id)).all()
        admin_ids = {grant.staff_id for grant in session.scalars(select(RoleGrant).where(
            RoleGrant.role == "admin", RoleGrant.scope_kind == "organization", RoleGrant.branch_id.is_(None),
            RoleGrant.is_active.is_(True),
        )).all()}
        reception_grants = session.scalars(select(RoleGrant).where(
            RoleGrant.role == "receptionist", RoleGrant.scope_kind == "branch", RoleGrant.is_active.is_(True)
        )).all()
        reception_by_staff: dict[UUID, list[UUID]] = {}
        for grant in reception_grants:
            if grant.branch_id is not None:
                reception_by_staff.setdefault(grant.staff_id, []).append(grant.branch_id)
        return {"staff": [{"id": user.id, "login_identifier": user.login_identifier,
                            "is_admin": user.id in admin_ids,
                            "can_be_admin": credential is not None,
                            "reception_branch_ids": reception_by_staff.get(user.id, []),
                            "is_owner": user.id == principal.staff_id}
                           for user, credential in rows]}


@router.get("/branches")
def list_active_branches(request: Request, principal: AdminPrincipal = Depends(_principal)):
    from app.db.models import Branch
    with request.app.state.session_factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        rows = session.scalars(select(Branch).where(Branch.is_active.is_(True)).order_by(Branch.code, Branch.id)).all()
        return {"branches": [{"id": row.id, "code": row.code, "name": row.name} for row in rows]}


@router.get("/bundles")
def list_role_bundles(request: Request, principal: AdminPrincipal = Depends(_principal)):
    with request.app.state.session_factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        bundles = session.scalars(select(RoleBundle).order_by(RoleBundle.normalized_name, RoleBundle.id)).all()
        return {"bundles": [_bundle_item(session, row) for row in bundles],
                "permissions": [item.value for item in Permission]}


@router.post("/bundles", status_code=201)
def create_role_bundle(payload: BundlePayload, request: Request, principal: AdminPrincipal = Depends(_principal)):
    permissions = _permissions(payload.permissions)
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "Bundle name must not be empty.")
    with request.app.state.session_factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        bundle = RoleBundle(name=name, normalized_name=name.casefold())
        session.add(bundle)
        session.flush()
        session.add_all([RoleBundlePermission(bundle_id=bundle.id, permission=item.value) for item in permissions])
        session.flush()
        return _bundle_item(session, bundle)


@router.put("/bundles/{bundle_id}")
def replace_role_bundle(bundle_id: UUID, payload: BundlePayload, request: Request,
                        principal: AdminPrincipal = Depends(_principal)):
    permissions = _permissions(payload.permissions)
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "Bundle name must not be empty.")
    with request.app.state.session_factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        bundle = session.scalar(select(RoleBundle).where(RoleBundle.id == bundle_id)
                                .execution_options(populate_existing=True).with_for_update())
        if bundle is None:
            raise HTTPException(404, "The requested resource was not found.")
        bundle.name, bundle.normalized_name = name, name.casefold()
        session.query(RoleBundlePermission).filter_by(bundle_id=bundle.id).delete(synchronize_session=False)
        session.add_all([RoleBundlePermission(bundle_id=bundle.id, permission=item.value) for item in permissions])
        session.flush()
        return _bundle_item(session, bundle)


@router.delete("/bundles/{bundle_id}")
def deactivate_role_bundle(bundle_id: UUID, request: Request, principal: AdminPrincipal = Depends(_principal)):
    with request.app.state.session_factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        bundle = session.scalar(select(RoleBundle).where(RoleBundle.id == bundle_id)
                                .execution_options(populate_existing=True).with_for_update())
        if bundle is None:
            raise HTTPException(404, "The requested resource was not found.")
        bundle.is_active = False
    return {"deactivated": True}


@router.post("/assignments", status_code=201)
def assign_role_bundle(payload: AssignmentPayload, request: Request,
                       principal: AdminPrincipal = Depends(_principal)):
    with request.app.state.session_factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id, payload.staff_id)
        if payload.staff_id == principal.staff_id:
            raise HTTPException(409, "The owner already has permanent owner authority.")
        bundle = session.scalar(select(RoleBundle).where(RoleBundle.id == payload.bundle_id)
                                .execution_options(populate_existing=True).with_for_update())
        if bundle is None or not bundle.is_active:
            raise HTTPException(404, "The requested resource was not found.")
        if payload.scope_kind == "organization" and payload.branch_id is not None:
            raise HTTPException(422, "Organization assignments cannot name a branch.")
        if payload.scope_kind == "branch" and payload.branch_id is None:
            raise HTTPException(422, "Branch assignments require a branch.")
        if payload.branch_id is not None:
            from app.db.models import Branch
            branch = session.scalar(select(Branch).where(Branch.id == payload.branch_id, Branch.is_active.is_(True)))
            if branch is None:
                raise HTTPException(404, "The requested resource was not found.")
        assignment = session.scalar(select(RoleBundleAssignment).where(
            RoleBundleAssignment.staff_id == payload.staff_id, RoleBundleAssignment.bundle_id == payload.bundle_id,
            RoleBundleAssignment.scope_kind == payload.scope_kind,
            RoleBundleAssignment.branch_id == payload.branch_id,
        ).execution_options(populate_existing=True).with_for_update())
        if assignment is None:
            assignment = RoleBundleAssignment(staff_id=payload.staff_id, bundle_id=payload.bundle_id,
                                              scope_kind=payload.scope_kind, branch_id=payload.branch_id)
            session.add(assignment)
        else:
            assignment.is_active = True
        session.flush()
        queue_security_event(session, make_security_event(
            SecurityEventType.ADMIN_ROLE_GRANTED,
            employee_id=payload.staff_id,
            initiating_actor_id=principal.staff_id,
        ))
        return {"id": assignment.id, "staff_id": assignment.staff_id, "bundle_id": assignment.bundle_id,
                "scope_kind": assignment.scope_kind, "branch_id": assignment.branch_id, "is_active": assignment.is_active}


@router.get("/assignments")
def list_assignments(request: Request, principal: AdminPrincipal = Depends(_principal)):
    with request.app.state.session_factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        assignments = session.scalars(select(RoleBundleAssignment).order_by(
            RoleBundleAssignment.staff_id, RoleBundleAssignment.scope_kind, RoleBundleAssignment.branch_id,
            RoleBundleAssignment.bundle_id,
        )).all()
        return {"assignments": [{"id": row.id, "staff_id": row.staff_id, "bundle_id": row.bundle_id,
                                "scope_kind": row.scope_kind, "branch_id": row.branch_id,
                                "is_active": row.is_active} for row in assignments]}


@router.delete("/assignments/{assignment_id}")
def revoke_assignment(assignment_id: UUID, request: Request, principal: AdminPrincipal = Depends(_principal)):
    with request.app.state.session_factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        assignment = session.scalar(select(RoleBundleAssignment).where(RoleBundleAssignment.id == assignment_id)
                                    .execution_options(populate_existing=True).with_for_update())
        if assignment is None:
            raise HTTPException(404, "The requested resource was not found.")
        assignment.is_active = False
        queue_security_event(session, make_security_event(
            SecurityEventType.ADMIN_ROLE_REVOKED,
            employee_id=assignment.staff_id,
            initiating_actor_id=principal.staff_id,
        ))
    return {"revoked": True}


@router.post("/staff/{staff_id}/admin", status_code=201)
def grant_admin(staff_id: UUID, request: Request, principal: AdminPrincipal = Depends(_principal)):
    with request.app.state.session_factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id, staff_id)
        if staff_id == principal.staff_id:
            raise HTTPException(409, "The owner cannot be changed through an Admin grant.")
        credential = session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == staff_id))
        if credential is None:
            raise HTTPException(409, "Only an existing Admin account can receive an Admin grant.")
        grant = session.scalar(select(RoleGrant).where(RoleGrant.staff_id == staff_id, RoleGrant.role == "admin",
            RoleGrant.scope_kind == "organization", RoleGrant.branch_id.is_(None)).execution_options(populate_existing=True).with_for_update())
        if grant is None:
            grant = RoleGrant(staff_id=staff_id, role="admin", scope_kind="organization", is_active=True)
            session.add(grant)
        else:
            grant.is_active = True
        session.flush()
        queue_security_event(session, make_security_event(
            SecurityEventType.ADMIN_ROLE_GRANTED,
            employee_id=staff_id,
            initiating_actor_id=principal.staff_id,
        ))
    return {"granted": True}


@router.delete("/staff/{staff_id}/admin")
def revoke_admin(staff_id: UUID, request: Request, principal: AdminPrincipal = Depends(_principal)):
    now = utc_now()
    with request.app.state.session_factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id, staff_id)
        if staff_id == principal.staff_id:
            raise HTTPException(409, "The owner cannot be revoked.")
        grant = session.scalar(select(RoleGrant).where(RoleGrant.staff_id == staff_id, RoleGrant.role == "admin",
            RoleGrant.scope_kind == "organization", RoleGrant.branch_id.is_(None)).execution_options(populate_existing=True).with_for_update())
        if grant is not None:
            grant.is_active = False
        session.query(RoleBundleAssignment).filter_by(staff_id=staff_id).update({"is_active": False}, synchronize_session=False)
        session.query(StaffSession).filter(StaffSession.staff_id == staff_id, StaffSession.scope_kind == "organization",
                                            StaffSession.auth_method == "admin_password", StaffSession.revoked_at.is_(None)).update(
            {"revoked_at": now}, synchronize_session=False)
        session.query(AdminTrustedDevice).filter(AdminTrustedDevice.staff_id == staff_id,
                                                  AdminTrustedDevice.revoked_at.is_(None)).update(
            {"revoked_at": now}, synchronize_session=False)
        session.query(AdminLoginApproval).filter(AdminLoginApproval.staff_id == staff_id,
            AdminLoginApproval.consumed_at.is_(None), AdminLoginApproval.revoked_at.is_(None)).update(
            {"revoked_at": now}, synchronize_session=False)
        queue_security_event(session, make_security_event(
            SecurityEventType.ADMIN_ROLE_REVOKED,
            employee_id=staff_id,
            initiating_actor_id=principal.staff_id,
            occurred_at=now,
        ))
    return {"revoked": True}


@router.post("/staff/{staff_id}/reception", status_code=201)
def grant_reception(staff_id: UUID, payload: ReceptionPayload, request: Request,
                    principal: AdminPrincipal = Depends(_principal)):
    from app.db.models import Branch
    with request.app.state.session_factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id, staff_id)
        branch = session.scalar(select(Branch).where(Branch.id == payload.branch_id, Branch.is_active.is_(True))
                                .execution_options(populate_existing=True).with_for_update())
        if branch is None:
            raise HTTPException(404, "The requested resource was not found.")
        grant = session.scalar(select(RoleGrant).where(
            RoleGrant.staff_id == staff_id, RoleGrant.role == "receptionist",
            RoleGrant.scope_kind == "branch", RoleGrant.branch_id == payload.branch_id,
        ).execution_options(populate_existing=True).with_for_update())
        if grant is None:
            grant = RoleGrant(staff_id=staff_id, role="receptionist", scope_kind="branch", branch_id=payload.branch_id)
            session.add(grant)
        else:
            grant.is_active = True
        queue_security_event(session, make_security_event(
            SecurityEventType.ADMIN_ROLE_GRANTED,
            employee_id=staff_id,
            initiating_actor_id=principal.staff_id,
        ))
    return {"granted": True}


@router.delete("/staff/{staff_id}/reception/{branch_id}")
def revoke_reception(staff_id: UUID, branch_id: UUID, request: Request,
                     principal: AdminPrincipal = Depends(_principal)):
    with request.app.state.session_factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id, staff_id)
        if staff_id == principal.staff_id:
            raise HTTPException(409, "The owner's individual identity cannot be revoked.")
        grant = session.scalar(select(RoleGrant).where(
            RoleGrant.staff_id == staff_id, RoleGrant.role == "receptionist",
            RoleGrant.scope_kind == "branch", RoleGrant.branch_id == branch_id,
        ).execution_options(populate_existing=True).with_for_update())
        if grant is not None:
            grant.is_active = False
            queue_security_event(session, make_security_event(
                SecurityEventType.ADMIN_ROLE_REVOKED,
                employee_id=staff_id,
                initiating_actor_id=principal.staff_id,
            ))
    return {"revoked": True}
