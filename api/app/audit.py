from datetime import datetime, timezone
from enum import StrEnum
from uuid import UUID

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
