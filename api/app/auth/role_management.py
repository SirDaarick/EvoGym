"""Owner-only role-management use cases: bundles, bundle assignments, Admin and receptionist grants.
SQL in `app.auth.queries`; HTTP transport in `app.api.admin_role_management`.

Failures are typed `HttpStatusError`s. Every use case takes the session `factory` and owns its transaction.
"""
from typing import Protocol
from uuid import UUID

from app.auth import queries as q
from app.auth.admin import utc_now
from app.auth.authorization import Permission
from app.auth.owner import has_organization_permission, owner_registry
from app.auth.schemas import AssignmentPayload, BundlePayload, ReceptionPayload
from app.db.models import RoleBundle, RoleBundleAssignment, RoleBundlePermission, RoleGrant
from app.errors import HttpStatusError
from app.observability.security import SecurityEventType, make_security_event, queue_security_event


class Principal(Protocol):
    staff_id: UUID


def _lock_staff_and_owner(session, actor_id: UUID, target_id: UUID | None = None):
    ids = sorted({actor_id, *([target_id] if target_id is not None else [])}, key=str)
    staff_by_id = {row.id: row for row in q.lock_staff_fresh(session, ids)}
    actor, target = staff_by_id.get(actor_id), staff_by_id.get(target_id) if target_id else None
    if actor is None or not actor.is_active or (target_id is not None and (target is None or not target.is_active)):
        raise HttpStatusError(404)
    ownership = q.lock_ownership(session)
    if ownership is None or ownership.staff_id != actor_id:
        raise HttpStatusError(403)
    return actor, target, ownership


def _permissions(values: list[str]) -> list[Permission]:
    if not values or len(set(values)) != len(values):
        raise HttpStatusError(422)
    try:
        return [Permission(value) for value in values]
    except (ValueError, TypeError):
        raise HttpStatusError(422) from None


def _bundle_item(session, bundle: RoleBundle) -> dict:
    return {"id": bundle.id, "name": bundle.name, "permissions": q.bundle_permissions(session, bundle.id),
            "is_active": bundle.is_active}


def _assignment_item(row: RoleBundleAssignment) -> dict:
    return {"id": row.id, "staff_id": row.staff_id, "bundle_id": row.bundle_id,
            "scope_kind": row.scope_kind, "branch_id": row.branch_id, "is_active": row.is_active}


def _bundle_inputs(payload: BundlePayload) -> tuple[list[Permission], str]:
    permissions = _permissions(payload.permissions)
    name = payload.name.strip()
    if not name:
        raise HttpStatusError(422)
    return permissions, name


def get_current_owner_status(factory, principal: Principal) -> dict:
    with factory.begin() as session:
        actor = q.lock_staff_one(session, principal.staff_id)
        ownership = owner_registry(session)
        is_owner = bool(actor and actor.is_active and ownership and ownership.staff_id == actor.id)
        return {"staff_id": principal.staff_id, "is_owner": is_owner,
                "can_manage_employees": bool(actor and actor.is_active and has_organization_permission(
                    session, actor.id, Permission.STAFF_EMPLOYEE_MANAGE
                ))}


def list_staff_accounts(factory, principal: Principal) -> dict:
    with factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        rows = q.active_users_with_admin_credential(session)
        admin_ids = {grant.staff_id for grant in q.active_admin_grants(session)}
        reception_by_staff: dict[UUID, list[UUID]] = {}
        for grant in q.active_reception_grants(session):
            if grant.branch_id is not None:
                reception_by_staff.setdefault(grant.staff_id, []).append(grant.branch_id)
        return {"staff": [{"id": user.id, "login_identifier": user.login_identifier,
                            "is_admin": user.id in admin_ids,
                            "can_be_admin": credential is not None,
                            "reception_branch_ids": reception_by_staff.get(user.id, []),
                            "is_owner": user.id == principal.staff_id}
                           for user, credential in rows]}


def list_active_branches(factory, principal: Principal) -> dict:
    with factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        return {"branches": [{"id": row.id, "code": row.code, "name": row.name}
                             for row in q.active_branches(session)]}


def list_role_bundles(factory, principal: Principal) -> dict:
    with factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        return {"bundles": [_bundle_item(session, row) for row in q.all_bundles(session)],
                "permissions": [item.value for item in Permission]}


def create_role_bundle(factory, principal: Principal, payload: BundlePayload) -> dict:
    permissions, name = _bundle_inputs(payload)
    with factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        bundle = RoleBundle(name=name, normalized_name=name.casefold())
        session.add(bundle)
        session.flush()
        session.add_all([RoleBundlePermission(bundle_id=bundle.id, permission=item.value) for item in permissions])
        session.flush()
        return _bundle_item(session, bundle)


def replace_role_bundle(factory, principal: Principal, bundle_id: UUID, payload: BundlePayload) -> dict:
    permissions, name = _bundle_inputs(payload)
    with factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        bundle = q.lock_bundle(session, bundle_id)
        if bundle is None:
            raise HttpStatusError(404)
        bundle.name, bundle.normalized_name = name, name.casefold()
        q.delete_bundle_permissions(session, bundle.id)
        session.add_all([RoleBundlePermission(bundle_id=bundle.id, permission=item.value) for item in permissions])
        session.flush()
        return _bundle_item(session, bundle)


def deactivate_role_bundle(factory, principal: Principal, bundle_id: UUID) -> dict:
    with factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        bundle = q.lock_bundle(session, bundle_id)
        if bundle is None:
            raise HttpStatusError(404)
        bundle.is_active = False
    return {"deactivated": True}


def assign_role_bundle(factory, principal: Principal, payload: AssignmentPayload) -> dict:
    with factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id, payload.staff_id)
        if payload.staff_id == principal.staff_id:
            raise HttpStatusError(409)
        bundle = q.lock_bundle(session, payload.bundle_id)
        if bundle is None or not bundle.is_active:
            raise HttpStatusError(404)
        if payload.scope_kind == "organization" and payload.branch_id is not None:
            raise HttpStatusError(422)
        if payload.scope_kind == "branch" and payload.branch_id is None:
            raise HttpStatusError(422)
        if payload.branch_id is not None and q.active_branch(session, payload.branch_id) is None:
            raise HttpStatusError(404)
        assignment = q.lock_assignment(session, payload.staff_id, payload.bundle_id, payload.scope_kind, payload.branch_id)
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
        return _assignment_item(assignment)


def list_assignments(factory, principal: Principal) -> dict:
    with factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        return {"assignments": [_assignment_item(row) for row in q.all_assignments(session)]}


def revoke_assignment(factory, principal: Principal, assignment_id: UUID) -> dict:
    with factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id)
        assignment = q.lock_assignment_by_id(session, assignment_id)
        if assignment is None:
            raise HttpStatusError(404)
        assignment.is_active = False
        queue_security_event(session, make_security_event(
            SecurityEventType.ADMIN_ROLE_REVOKED,
            employee_id=assignment.staff_id,
            initiating_actor_id=principal.staff_id,
        ))
    return {"revoked": True}


def grant_admin(factory, principal: Principal, staff_id: UUID) -> dict:
    with factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id, staff_id)
        if staff_id == principal.staff_id:
            raise HttpStatusError(409)
        if q.admin_credential(session, staff_id) is None:
            raise HttpStatusError(409)
        grant = q.lock_admin_grant(session, staff_id)
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


def revoke_admin(factory, principal: Principal, staff_id: UUID) -> dict:
    now = utc_now()
    with factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id, staff_id)
        if staff_id == principal.staff_id:
            raise HttpStatusError(409)
        grant = q.lock_admin_grant(session, staff_id)
        if grant is not None:
            grant.is_active = False
        q.deactivate_admin_access(session, staff_id, now)
        queue_security_event(session, make_security_event(
            SecurityEventType.ADMIN_ROLE_REVOKED,
            employee_id=staff_id,
            initiating_actor_id=principal.staff_id,
            occurred_at=now,
        ))
    return {"revoked": True}


def grant_reception(factory, principal: Principal, staff_id: UUID, payload: ReceptionPayload) -> dict:
    with factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id, staff_id)
        if q.lock_active_branch(session, payload.branch_id) is None:
            raise HttpStatusError(404)
        grant = q.lock_reception_grant(session, staff_id, payload.branch_id)
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


def revoke_reception(factory, principal: Principal, staff_id: UUID, branch_id: UUID) -> dict:
    with factory.begin() as session:
        _lock_staff_and_owner(session, principal.staff_id, staff_id)
        if staff_id == principal.staff_id:
            raise HttpStatusError(409)
        grant = q.lock_reception_grant(session, staff_id, branch_id)
        if grant is not None:
            grant.is_active = False
            queue_security_event(session, make_security_event(
                SecurityEventType.ADMIN_ROLE_REVOKED,
                employee_id=staff_id,
                initiating_actor_id=principal.staff_id,
            ))
    return {"revoked": True}
