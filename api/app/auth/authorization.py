from __future__ import annotations

from enum import StrEnum
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Branch, RoleGrant, StaffUser


class Permission(StrEnum):
    MEMBER_OPERATIONAL_READ = "member_operational_read"
    FINANCE_READ = "finance_read"
    STAFF_COMPENSATION_READ = "staff_compensation_read"
    ADMIN_AUDIT_READ = "admin_audit_read"
    TRANSFER_REVIEW = "transfer_review"
    STAFF_ROSTER_READ = "staff_roster_read"
    STAFF_ROSTER_MANAGE = "staff_roster_manage"
    STAFF_ATTENDANCE_RECORD = "staff_attendance_record"


class AuthorizationDenied(Exception):
    """Raised for every invalid, inactive, unknown, or out-of-scope authority."""


def _lock_authority(session: Session, staff_id: UUID, branch_id: UUID):
    staff = session.scalar(select(StaffUser).where(StaffUser.id == staff_id).execution_options(populate_existing=True).with_for_update())
    branch = session.scalar(select(Branch).where(Branch.id == branch_id).execution_options(populate_existing=True).with_for_update())
    grants = session.scalars(
        select(RoleGrant).where(RoleGrant.staff_id == staff_id).execution_options(populate_existing=True).with_for_update()
    ).all()
    return staff, branch, grants


def _permits(staff, branch, grants, permission: Permission | str, branch_id: UUID) -> bool:
    try:
        requested = Permission(permission)
    except (TypeError, ValueError):
        return False
    if staff is None or not staff.is_active or branch is None or not branch.is_active:
        return False
    for grant in grants:
        if not grant.is_active:
            continue
        if grant.role == "admin":
            if requested is Permission.STAFF_ATTENDANCE_RECORD:
                continue
            if grant.scope_kind == "organization":
                return True
            if grant.scope_kind == "branch" and grant.branch_id == branch_id:
                return True
        if (
            grant.role == "receptionist"
            and grant.scope_kind == "branch"
            and grant.branch_id == branch_id
            and requested in {Permission.MEMBER_OPERATIONAL_READ, Permission.STAFF_ROSTER_READ, Permission.STAFF_ATTENDANCE_RECORD}
        ):
            return True
    return False


def _has_permission(session: Session, staff_id: UUID, permission: Permission | str, branch_id: UUID) -> bool:
    staff, branch, grants = _lock_authority(session, staff_id, branch_id)
    return _permits(staff, branch, grants, permission, branch_id)


def authorize(session: Session, staff_id: UUID, permission: Permission | str, branch_id: UUID) -> None:
    """Re-read active staff, branch, and explicit grants for every operation."""
    if not isinstance(staff_id, UUID) or not isinstance(branch_id, UUID):
        raise AuthorizationDenied("Authorization denied")
    if not _has_permission(session, staff_id, permission, branch_id):
        raise AuthorizationDenied("Authorization denied")
