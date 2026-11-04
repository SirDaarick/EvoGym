"""SQL for the admin staff-account and role-management use cases (no commits, no authorization)."""
from uuid import UUID

from sqlalchemy import select

from app.db.models import (
    AdminLoginApproval, AdminPasswordCredential, AdminTrustedDevice, Branch, OrganizationOwner,
    ReceptionStation, RoleBundle, RoleBundleAssignment, RoleBundlePermission, RoleGrant,
    StaffCredential, StaffDevicePairingCode, StaffPairedDevice, StaffRosterProfile, StaffSession, StaffUser,
)

_FRESH = {"populate_existing": True}


# --- staff accounts: live-admin locks (order is load-bearing) ---------------------------------

def lock_staff_key_share(session, staff_ids):
    return session.scalars(
        select(StaffUser).where(StaffUser.id.in_(staff_ids)).order_by(StaffUser.id).with_for_update(key_share=True)
    ).all()


def lock_admin_credential(session, staff_id: UUID):
    return session.scalar(
        select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == staff_id)
        .execution_options(**_FRESH).with_for_update()
    )


def lock_grants(session, staff_id: UUID):
    return session.scalars(
        select(RoleGrant).where(RoleGrant.staff_id == staff_id).order_by(RoleGrant.id)
        .execution_options(**_FRESH).with_for_update()
    ).all()


def lock_branch(session, branch_id: UUID):
    return session.scalar(select(Branch).where(Branch.id == branch_id).with_for_update())


def lock_auth_session(session, session_id: UUID, staff_id: UUID):
    return session.scalar(select(StaffSession).where(
        StaffSession.id == session_id, StaffSession.staff_id == staff_id,
    ).execution_options(**_FRESH).with_for_update())


def lock_live_trusted_device(session, device_id: UUID):
    return session.scalar(select(AdminTrustedDevice).where(
        AdminTrustedDevice.id == device_id, AdminTrustedDevice.revoked_at.is_(None),
    ).execution_options(**_FRESH).with_for_update())


# --- staff accounts: deactivation ---------------------------------------------------------------

def lock_org_owner_row(session, staff_id: UUID):
    return session.scalar(select(OrganizationOwner).where(
        OrganizationOwner.id == 1, OrganizationOwner.staff_id == staff_id,
    ).execution_options(**_FRESH).with_for_update())


def lock_legacy_owner(session, staff_id: UUID):
    return session.scalar(select(AdminPasswordCredential).where(
        AdminPasswordCredential.staff_id == staff_id, AdminPasswordCredential.is_owner.is_(True),
    ).with_for_update())


def lock_active_sessions(session, staff_id: UUID):
    return session.scalars(select(StaffSession).where(
        StaffSession.staff_id == staff_id, StaffSession.revoked_at.is_(None),
    ).order_by(StaffSession.id).with_for_update()).all()


def lock_active_paired_devices(session, staff_id: UUID):
    return session.scalars(select(StaffPairedDevice).where(
        StaffPairedDevice.staff_id == staff_id, StaffPairedDevice.revoked_at.is_(None),
    ).order_by(StaffPairedDevice.id).with_for_update()).all()


def lock_open_pairing_codes(session, staff_id: UUID):
    return session.scalars(select(StaffDevicePairingCode).where(
        StaffDevicePairingCode.staff_id == staff_id,
        StaffDevicePairingCode.used_at.is_(None), StaffDevicePairingCode.revoked_at.is_(None),
    ).order_by(StaffDevicePairingCode.id).with_for_update()).all()


# --- staff accounts: reception stations ---------------------------------------------------------

def reception_stations(session, branch_id: UUID):
    return session.scalars(select(ReceptionStation).where(ReceptionStation.branch_id == branch_id)
                           .order_by(ReceptionStation.created_at.desc(), ReceptionStation.id)).all()


def lock_station(session, station_id: UUID, branch_id: UUID):
    return session.scalar(select(ReceptionStation).where(
        ReceptionStation.id == station_id, ReceptionStation.branch_id == branch_id,
    ).execution_options(**_FRESH).with_for_update())


def lock_station_sessions(session, station_id: UUID):
    return session.scalars(select(StaffSession).where(
        StaffSession.reception_station_id == station_id, StaffSession.revoked_at.is_(None),
    ).order_by(StaffSession.id).with_for_update()).all()


# --- staff accounts: lists and links ------------------------------------------------------------

def accounts_with_credentials(session):
    return session.execute(
        select(StaffUser, StaffCredential)
        .join(StaffCredential, StaffCredential.staff_id == StaffUser.id)
        .order_by(StaffUser.login_identifier, StaffUser.id)
    ).all()


def branch_profile_links(session, branch_id: UUID):
    return session.execute(select(StaffRosterProfile.staff_user_id, StaffRosterProfile.id).where(
        StaffRosterProfile.branch_id == branch_id, StaffRosterProfile.staff_user_id.is_not(None),
    ).order_by(StaffRosterProfile.id)).all()


def active_branches(session):
    return session.scalars(select(Branch).where(Branch.is_active.is_(True)).order_by(Branch.code, Branch.id)).all()


def active_roster_profiles(session, branch_id: UUID):
    return session.scalars(select(StaffRosterProfile).where(
        StaffRosterProfile.branch_id == branch_id, StaffRosterProfile.is_active.is_(True),
    ).order_by(StaffRosterProfile.full_name, StaffRosterProfile.id)).all()


def profile_branch_id(session, profile_id: UUID):
    return session.scalar(select(StaffRosterProfile.branch_id).where(StaffRosterProfile.id == profile_id))


def lock_pin_credential(session, staff_id: UUID):
    return session.scalar(select(StaffCredential).where(
        StaffCredential.staff_id == staff_id, StaffCredential.method == "pin",
    ).execution_options(**_FRESH).with_for_update())


def lock_profile(session, profile_id: UUID):
    return session.scalar(select(StaffRosterProfile).where(StaffRosterProfile.id == profile_id)
                          .execution_options(**_FRESH).with_for_update())


def linked_profile_in_branch(session, branch_id: UUID, staff_id: UUID):
    return session.scalar(select(StaffRosterProfile.id).where(
        StaffRosterProfile.branch_id == branch_id, StaffRosterProfile.staff_user_id == staff_id,
    ).limit(1))


# --- role management ----------------------------------------------------------------------------

def lock_staff_fresh(session, staff_ids):
    return session.scalars(select(StaffUser).where(StaffUser.id.in_(staff_ids)).order_by(StaffUser.id)
                           .execution_options(**_FRESH).with_for_update()).all()


def lock_ownership(session):
    return session.scalar(select(OrganizationOwner).where(OrganizationOwner.id == 1)
                          .execution_options(**_FRESH).with_for_update())


def lock_staff_one(session, staff_id: UUID):
    return session.scalar(select(StaffUser).where(StaffUser.id == staff_id)
                          .execution_options(**_FRESH).with_for_update())


def active_users_with_admin_credential(session):
    return session.execute(select(StaffUser, AdminPasswordCredential)
                           .outerjoin(AdminPasswordCredential, AdminPasswordCredential.staff_id == StaffUser.id)
                           .where(StaffUser.is_active.is_(True)).order_by(StaffUser.login_identifier, StaffUser.id)).all()


def active_admin_grants(session):
    return session.scalars(select(RoleGrant).where(
        RoleGrant.role == "admin", RoleGrant.scope_kind == "organization", RoleGrant.branch_id.is_(None),
        RoleGrant.is_active.is_(True),
    )).all()


def active_reception_grants(session):
    return session.scalars(select(RoleGrant).where(
        RoleGrant.role == "receptionist", RoleGrant.scope_kind == "branch", RoleGrant.is_active.is_(True)
    )).all()


def all_bundles(session):
    return session.scalars(select(RoleBundle).order_by(RoleBundle.normalized_name, RoleBundle.id)).all()


def bundle_permissions(session, bundle_id: UUID):
    return session.scalars(select(RoleBundlePermission.permission).where(
        RoleBundlePermission.bundle_id == bundle_id).order_by(RoleBundlePermission.permission)).all()


def lock_bundle(session, bundle_id: UUID):
    return session.scalar(select(RoleBundle).where(RoleBundle.id == bundle_id)
                          .execution_options(**_FRESH).with_for_update())


def delete_bundle_permissions(session, bundle_id: UUID) -> None:
    session.query(RoleBundlePermission).filter_by(bundle_id=bundle_id).delete(synchronize_session=False)


def active_branch(session, branch_id: UUID):
    return session.scalar(select(Branch).where(Branch.id == branch_id, Branch.is_active.is_(True)))


def lock_active_branch(session, branch_id: UUID):
    return session.scalar(select(Branch).where(Branch.id == branch_id, Branch.is_active.is_(True))
                          .execution_options(**_FRESH).with_for_update())


def lock_assignment(session, staff_id: UUID, bundle_id: UUID, scope_kind: str, branch_id: UUID | None):
    return session.scalar(select(RoleBundleAssignment).where(
        RoleBundleAssignment.staff_id == staff_id, RoleBundleAssignment.bundle_id == bundle_id,
        RoleBundleAssignment.scope_kind == scope_kind, RoleBundleAssignment.branch_id == branch_id,
    ).execution_options(**_FRESH).with_for_update())


def all_assignments(session):
    return session.scalars(select(RoleBundleAssignment).order_by(
        RoleBundleAssignment.staff_id, RoleBundleAssignment.scope_kind, RoleBundleAssignment.branch_id,
        RoleBundleAssignment.bundle_id,
    )).all()


def lock_assignment_by_id(session, assignment_id: UUID):
    return session.scalar(select(RoleBundleAssignment).where(RoleBundleAssignment.id == assignment_id)
                          .execution_options(**_FRESH).with_for_update())


def admin_credential(session, staff_id: UUID):
    return session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == staff_id))


def lock_admin_grant(session, staff_id: UUID):
    return session.scalar(select(RoleGrant).where(RoleGrant.staff_id == staff_id, RoleGrant.role == "admin",
        RoleGrant.scope_kind == "organization", RoleGrant.branch_id.is_(None)).execution_options(**_FRESH).with_for_update())


def lock_reception_grant(session, staff_id: UUID, branch_id: UUID):
    return session.scalar(select(RoleGrant).where(
        RoleGrant.staff_id == staff_id, RoleGrant.role == "receptionist",
        RoleGrant.scope_kind == "branch", RoleGrant.branch_id == branch_id,
    ).execution_options(**_FRESH).with_for_update())


def deactivate_admin_access(session, staff_id: UUID, now) -> None:
    """Revoke bundles, admin sessions, trusted devices and pending login approvals in the original order."""
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
