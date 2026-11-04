"""Admin security-alert use cases (pending employee PIN lockouts). HTTP transport in `app.api.admin_security_alerts`."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.auth import admin_queries as q
from app.auth.admin import ADMIN_IDLE_SECONDS
from app.auth.authorization import Permission
from app.auth.owner import has_organization_permission
from app.errors import HttpStatusError


class SecurityAlertItem(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    staff_id: UUID
    login_identifier: str
    occurred_at: datetime
    locked_until: datetime


class SecurityAlertPage(BaseModel):
    alerts: list[SecurityAlertItem]
    next_cursor: UUID | None


class SecurityAlertAcknowledgement(BaseModel):
    id: UUID
    acknowledged_at: datetime
    acknowledged_by: UUID


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _require_live_employee_manager(session, principal):
    actor = q.locked_staff_user(session, principal.staff_id)
    credential = q.locked_password_credential(session, principal.staff_id)
    grants = q.locked_grants(session, principal.staff_id)
    auth_session = q.locked_actor_session(session, principal.session_id, principal.staff_id)
    device = None
    if auth_session is not None and auth_session.admin_trusted_device_id is not None:
        device = q.locked_live_device(session, auth_session.admin_trusted_device_id)

    now = datetime.now(timezone.utc)
    has_admin_identity = any(
        row.is_active and row.role == "admin" and row.scope_kind == "organization" and row.branch_id is None
        for row in grants
    )
    if (actor is None or not actor.is_active or credential is None or not has_admin_identity or auth_session is None
            or auth_session.scope_kind != "organization" or auth_session.auth_method != "admin_password"
            or auth_session.revoked_at is not None or auth_session.absolute_expires_at is None
            or auth_session.last_seen_at is None or now >= _utc(auth_session.absolute_expires_at)
            or now - _utc(auth_session.last_seen_at) >= timedelta(seconds=ADMIN_IDLE_SECONDS) or device is None):
        raise HttpStatusError(401)
    if not has_organization_permission(session, principal.staff_id, Permission.STAFF_EMPLOYEE_MANAGE):
        raise HttpStatusError(403)
    auth_session.last_seen_at = now
    device.last_used_at = now
    return actor


def list_alerts(factory, principal, limit: int, cursor: UUID | None) -> SecurityAlertPage:
    with factory.begin() as session:
        _require_live_employee_manager(session, principal)
        anchor = None
        if cursor is not None:
            anchor = q.security_event(session, cursor)
            if anchor is None:
                raise HttpStatusError(400)
        rows = q.pending_alerts(session, anchor, limit)
        has_more = len(rows) > limit
        rows = rows[:limit]
        alerts = [SecurityAlertItem(
            id=event.id, staff_id=event.staff_id, login_identifier=staff.login_identifier,
            occurred_at=_utc(event.occurred_at), locked_until=_utc(event.locked_until),
        ) for event, staff in rows]
        return SecurityAlertPage(alerts=alerts, next_cursor=alerts[-1].id if has_more and alerts else None)


def acknowledge(factory, principal, event_id: UUID) -> SecurityAlertAcknowledgement:
    with factory.begin() as session:
        _require_live_employee_manager(session, principal)
        event = q.locked_security_event(session, event_id)
        if event is None:
            raise HttpStatusError(404)
        if event.acknowledged_at is None:
            event.acknowledged_at = datetime.now(timezone.utc)
            event.acknowledged_by = principal.staff_id
        return SecurityAlertAcknowledgement(
            id=event.id, acknowledged_at=_utc(event.acknowledged_at), acknowledged_by=event.acknowledged_by,
        )
