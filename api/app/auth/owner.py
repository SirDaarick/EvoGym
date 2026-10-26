from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.authorization import AuthorizationDenied, Permission
from app.observability.security import SecurityEventType, make_security_event, queue_security_event
from app.auth.passwords import hash_admin_password
from app.db.models import (
    AdminPasswordCredential, OrganizationOwner, RoleBundle, RoleBundleAssignment,
    RoleBundlePermission, RoleGrant, StaffUser,
)


def owner_registry(session: Session, *, lock: bool = False) -> OrganizationOwner | None:
    statement = select(OrganizationOwner).where(OrganizationOwner.id == 1).execution_options(populate_existing=True)
    if lock:
        statement = statement.with_for_update()
    return session.scalar(statement)


def is_owner(session: Session, staff_id: UUID, *, lock: bool = False) -> bool:
    record = owner_registry(session, lock=lock)
    return record is not None and record.staff_id == staff_id


def owner_configured(session: Session) -> bool:
    return owner_registry(session) is not None


def require_owner(session: Session, staff_id: UUID, *, lock: bool = True) -> None:
    if not is_owner(session, staff_id, lock=lock):
        raise AuthorizationDenied("Authorization denied")


def require_owner_or_legacy_admin(session: Session, staff_id: UUID) -> None:
    """Before the owner migration exists, retain test/upgrade compatibility; afterward, require the owner."""
    record = owner_registry(session, lock=True)
    if record is not None:
        if record.staff_id != staff_id:
            raise AuthorizationDenied("Authorization denied")
        return
    from app.db.models import RoleGrant, StaffUser
    staff = session.scalar(select(StaffUser).where(StaffUser.id == staff_id)
                           .execution_options(populate_existing=True).with_for_update())
    grants = session.scalars(select(RoleGrant).where(RoleGrant.staff_id == staff_id)
                             .execution_options(populate_existing=True).with_for_update()).all()
    if staff is None or not staff.is_active or not any(
        grant.is_active and grant.role == "admin" and grant.scope_kind == "organization"
        and grant.branch_id is None for grant in grants
    ):
        raise AuthorizationDenied("Authorization denied")


def has_organization_permission(session: Session, staff_id: UUID, permission: Permission | str) -> bool:
    """Resolve live organization-wide permissions for protected Admin operations."""
    try:
        requested = Permission(permission)
    except (TypeError, ValueError):
        return False
    record = owner_registry(session)
    if record is None:
        # Compatibility for pre-owner fixtures only. Installed schema always has row 1.
        from app.db.models import RoleGrant, StaffUser
        staff = session.scalar(select(StaffUser).where(StaffUser.id == staff_id))
        grants = session.scalars(select(RoleGrant).where(RoleGrant.staff_id == staff_id)).all()
        return bool(staff and staff.is_active and any(
            grant.is_active and grant.role == "admin" and grant.scope_kind == "organization"
            and grant.branch_id is None for grant in grants
        ))
    if record.staff_id == staff_id:
        return True
    assignments = session.scalars(select(RoleBundleAssignment).where(
        RoleBundleAssignment.staff_id == staff_id,
        RoleBundleAssignment.scope_kind == "organization",
        RoleBundleAssignment.branch_id.is_(None),
        RoleBundleAssignment.is_active.is_(True),
    ).with_for_update()).all()
    for assignment in assignments:
        bundle = session.scalar(select(RoleBundle).where(
            RoleBundle.id == assignment.bundle_id, RoleBundle.is_active.is_(True)
        ))
        if bundle is not None and session.scalar(select(RoleBundlePermission.id).where(
            RoleBundlePermission.bundle_id == bundle.id,
            RoleBundlePermission.permission == requested.value,
        )) is not None:
            return True
    return False


def require_organization_permission(session: Session, staff_id: UUID, permission: Permission | str) -> None:
    if not has_organization_permission(session, staff_id, permission):
        raise AuthorizationDenied("Authorization denied")


def validate_owner_password(password: str) -> None:
    if not isinstance(password, str) or len(password.encode("utf-8", errors="ignore")) > 4096:
        raise ValueError("Password does not meet the owner password policy.")
    classes = sum(bool(pattern.search(password)) for pattern in (
        re.compile(r"[a-z]"), re.compile(r"[A-Z]"), re.compile(r"[0-9]"), re.compile(r"[^A-Za-z0-9]"),
    ))
    if len(password) < 14 or classes < 3:
        raise ValueError("Password must be at least 14 characters and use at least three character classes.")


def bootstrap_owner(session_factory, login_identifier: str, recovery_email: str, password: str) -> UUID:
    """Atomically claim the migrated empty owner slot by creating one new Admin identity."""
    validate_owner_password(password)
    login = login_identifier.strip().casefold() if isinstance(login_identifier, str) else ""
    email = recovery_email.strip().casefold() if isinstance(recovery_email, str) else ""
    if len(login) > 320 or not login or "@" not in login:
        raise ValueError("A valid owner login email is required.")
    if len(email) > 320 or not email or "@" not in email:
        raise ValueError("A valid recovery email is required.")
    encoded = hash_admin_password(password)
    with session_factory.begin() as session:
        ownership = session.scalar(select(OrganizationOwner).where(OrganizationOwner.id == 1)
                                   .execution_options(populate_existing=True).with_for_update())
        if ownership is None:
            raise RuntimeError("Install the owner role-bundle migration before bootstrapping an owner.")
        if ownership.staff_id is not None:
            raise RuntimeError("The organization owner has already been bootstrapped.")
        if session.scalar(select(StaffUser.id).where(StaffUser.login_identifier == login)) is not None:
            raise ValueError("The owner login must be a new individual identity.")
        owner = StaffUser(login_identifier=login)
        session.add(owner)
        session.flush()
        session.add(AdminPasswordCredential(staff_id=owner.id, password_hash=encoded, recovery_email=email,
                                            recovery_email_verified_at=None, is_owner=True))
        session.add(RoleGrant(staff_id=owner.id, role="admin", scope_kind="organization", branch_id=None))
        ownership.staff_id = owner.id
        session.flush()
        queue_security_event(session, make_security_event(
            SecurityEventType.OWNER_GRANTED,
            employee_id=owner.id,
        ))
        return owner.id
