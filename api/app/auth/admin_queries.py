"""SQL for admin session/device management and security alerts. Callers own transactions."""
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.models import AdminPasswordCredential, AdminTrustedDevice, RoleGrant, SecurityEvent, StaffSession, StaffUser

_FRESH = {"populate_existing": True}


def admin_sessions_for(session: Session, staff_id: UUID):
    return session.scalars(select(StaffSession).where(StaffSession.staff_id == staff_id,
        StaffSession.scope_kind == "organization", StaffSession.auth_method == "admin_password").order_by(StaffSession.issued_at.desc())).all()


def locked_admin_session(session: Session, session_id: UUID, staff_id: UUID):
    return session.scalar(select(StaffSession).where(StaffSession.id == session_id, StaffSession.staff_id == staff_id,
        StaffSession.scope_kind == "organization", StaffSession.auth_method == "admin_password").with_for_update())


def trusted_devices_for(session: Session, staff_id: UUID):
    return session.scalars(select(AdminTrustedDevice).where(AdminTrustedDevice.staff_id == staff_id)
                           .order_by(AdminTrustedDevice.created_at.desc())).all()


def device_probe(session: Session, device_id: UUID):
    return session.scalar(select(AdminTrustedDevice).where(AdminTrustedDevice.id == device_id))


def locked_staff_user(session: Session, staff_id: UUID):
    return session.scalar(select(StaffUser).where(StaffUser.id == staff_id)
                          .execution_options(**_FRESH).with_for_update())


def locked_device_sessions(session: Session, device_id: UUID):
    return session.scalars(select(StaffSession).where(
        StaffSession.admin_trusted_device_id == device_id, StaffSession.revoked_at.is_(None),
    ).order_by(StaffSession.id).with_for_update()).all()


def locked_device(session: Session, device_id: UUID):
    return session.scalar(select(AdminTrustedDevice).where(AdminTrustedDevice.id == device_id)
                          .execution_options(**_FRESH).with_for_update())


def owner_credential(session: Session, staff_id: UUID):
    return session.scalar(select(AdminPasswordCredential).where(
        AdminPasswordCredential.staff_id == staff_id, AdminPasswordCredential.is_owner.is_(True)))


def locked_password_credential(session: Session, staff_id: UUID):
    return session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == staff_id)
                          .execution_options(**_FRESH).with_for_update())


def locked_grants(session: Session, staff_id: UUID):
    return session.scalars(select(RoleGrant).where(RoleGrant.staff_id == staff_id).order_by(RoleGrant.id)
                           .execution_options(**_FRESH).with_for_update()).all()


def locked_actor_session(session: Session, session_id: UUID, staff_id: UUID):
    return session.scalar(select(StaffSession).where(
        StaffSession.id == session_id, StaffSession.staff_id == staff_id,
    ).execution_options(**_FRESH).with_for_update())


def locked_live_device(session: Session, device_id: UUID):
    return session.scalar(select(AdminTrustedDevice).where(
        AdminTrustedDevice.id == device_id, AdminTrustedDevice.revoked_at.is_(None),
    ).execution_options(**_FRESH).with_for_update())


def security_event(session: Session, event_id: UUID):
    return session.scalar(select(SecurityEvent).where(SecurityEvent.id == event_id))


def locked_security_event(session: Session, event_id: UUID):
    return session.scalar(select(SecurityEvent).where(SecurityEvent.id == event_id)
                          .execution_options(**_FRESH).with_for_update())


def pending_alerts(session: Session, anchor, limit: int):
    """Unacknowledged events newest first, strictly after `anchor` (or from the top), limit+1 rows."""
    query = select(SecurityEvent, StaffUser).join(StaffUser, StaffUser.id == SecurityEvent.staff_id).where(
        SecurityEvent.acknowledged_at.is_(None)
    )
    if anchor is not None:
        query = query.where(or_(
            SecurityEvent.occurred_at < anchor.occurred_at,
            (SecurityEvent.occurred_at == anchor.occurred_at) & (SecurityEvent.id < anchor.id),
        ))
    return session.execute(query.order_by(SecurityEvent.occurred_at.desc(), SecurityEvent.id.desc())
                           .limit(limit + 1)).all()
