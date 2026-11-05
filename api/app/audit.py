from datetime import datetime, timezone
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.auth.sessions import SessionPrincipal
from app.db.models.audit import AuditEvent


class AuditAction(StrEnum):
    MEMBER_READ = "member_read"
    MEMBER_WRITE = "member_write"
    FINANCE_READ = "finance_read"
    SHIFT_POST = "shift_post"
    STAFF_AUTHORIZATION_CHANGED = "staff_authorization_changed"
    SYNC_INGEST = "sync_ingest"


_PERMISSIONS = {
    AuditAction.MEMBER_READ: Permission.MEMBER_OPERATIONAL_READ,
    AuditAction.FINANCE_READ: Permission.FINANCE_READ,
}


def append_audit_event(
    session: Session,
    principal: SessionPrincipal,
    action: AuditAction,
    branch_id: UUID,
    request_id: UUID,
) -> AuditEvent:
    """Append a minimal audit event to the caller's existing transaction."""
    if not isinstance(principal, SessionPrincipal) or not isinstance(action, AuditAction):
        raise AuthorizationDenied("Audit authority denied")
    if not isinstance(branch_id, UUID) or not isinstance(request_id, UUID) or branch_id != principal.branch_id:
        raise AuthorizationDenied("Audit authority denied")
    permission = _PERMISSIONS.get(action)
    if permission is None:
        raise AuthorizationDenied("Audit authority denied")
    authorize(session, principal.staff_id, permission, branch_id)
    event = AuditEvent(
        actor_id=principal.staff_id,
        branch_id=branch_id,
        action=action.value,
        request_id=request_id,
        occurred_at=datetime.now(timezone.utc),
    )
    session.add(event)
    return event


def append_sync_audit_event(
    session: Session,
    *,
    device_id: UUID,
    actor_staff_id: UUID,
    branch_id: UUID,
    event_id: str,
    event_type: str,
    status: str,
    request_id: UUID | None = None,
) -> AuditEvent:
    """Append a sync_ingest audit event for an already device-authenticated caller (no principal/permission check).

    AuditEvent stores only actor/branch/action/request_id; device_id, event_id, event_type and status are accepted
    for the caller's contract but deliberately not persisted (no payloads or tokens are ever written).
    """
    if not isinstance(branch_id, UUID) or not isinstance(actor_staff_id, UUID):
        raise AuthorizationDenied("Audit authority denied")
    event = AuditEvent(
        actor_id=actor_staff_id,
        branch_id=branch_id,
        action=AuditAction.SYNC_INGEST.value,
        request_id=request_id or uuid4(),
        occurred_at=datetime.now(timezone.utc),
    )
    session.add(event)
    return event
