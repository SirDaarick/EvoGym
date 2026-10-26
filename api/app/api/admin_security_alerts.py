"""Global, in-app Admin view of pending employee PIN lockouts."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select

from app.auth.admin import ADMIN_IDLE_SECONDS, validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.owner import has_organization_permission
from app.db.models import (
    AdminPasswordCredential,
    AdminTrustedDevice,
    RoleGrant,
    SecurityEvent,
    StaffSession,
    StaffUser,
)


router = APIRouter(prefix="/api/v1/admin/security-alerts", tags=["admin security alerts"])
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class AdminPrincipal:
    staff_id: UUID
    session_id: UUID


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


def _principal(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> AdminPrincipal:
    settings = request.app.state.settings
    factory = request.app.state.session_factory
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


def _require_live_employee_manager(session, principal: AdminPrincipal) -> StaffUser:
    actor = session.scalar(
        select(StaffUser).where(StaffUser.id == principal.staff_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    credential = session.scalar(
        select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == principal.staff_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    grants = session.scalars(
        select(RoleGrant).where(RoleGrant.staff_id == principal.staff_id).order_by(RoleGrant.id)
        .execution_options(populate_existing=True).with_for_update()
    ).all()
    auth_session = session.scalar(
        select(StaffSession).where(
            StaffSession.id == principal.session_id, StaffSession.staff_id == principal.staff_id,
        ).execution_options(populate_existing=True).with_for_update()
    )
    device = None
    if auth_session is not None and auth_session.admin_trusted_device_id is not None:
        device = session.scalar(select(AdminTrustedDevice).where(
            AdminTrustedDevice.id == auth_session.admin_trusted_device_id,
            AdminTrustedDevice.revoked_at.is_(None),
        ).execution_options(populate_existing=True).with_for_update())

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
        raise HTTPException(401, "Authentication failed.")
    if not has_organization_permission(session, principal.staff_id, Permission.STAFF_EMPLOYEE_MANAGE):
        raise HTTPException(403, "Employee-management permission is required.")
    auth_session.last_seen_at = now
    device.last_used_at = now
    return actor


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


@router.get("", response_model=SecurityAlertPage)
def list_security_alerts(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    cursor: UUID | None = Query(default=None),
    principal: AdminPrincipal = Depends(_principal),
):
    with request.app.state.session_factory.begin() as session:
        _require_live_employee_manager(session, principal)
        query = select(SecurityEvent, StaffUser).join(StaffUser, StaffUser.id == SecurityEvent.staff_id).where(
            SecurityEvent.acknowledged_at.is_(None)
        )
        if cursor is not None:
            anchor = session.scalar(select(SecurityEvent).where(SecurityEvent.id == cursor))
            if anchor is None:
                raise HTTPException(400, "Invalid alert cursor.")
            query = query.where(or_(
                SecurityEvent.occurred_at < anchor.occurred_at,
                (SecurityEvent.occurred_at == anchor.occurred_at) & (SecurityEvent.id < anchor.id),
            ))
        rows = session.execute(query.order_by(SecurityEvent.occurred_at.desc(), SecurityEvent.id.desc())
                               .limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        alerts = [SecurityAlertItem(
            id=event.id, staff_id=event.staff_id, login_identifier=staff.login_identifier,
            occurred_at=_utc(event.occurred_at), locked_until=_utc(event.locked_until),
        ) for event, staff in rows]
        return SecurityAlertPage(alerts=alerts, next_cursor=alerts[-1].id if has_more and alerts else None)


@router.post("/{event_id}/acknowledge", response_model=SecurityAlertAcknowledgement)
def acknowledge_security_alert(event_id: UUID, request: Request, principal: AdminPrincipal = Depends(_principal)):
    with request.app.state.session_factory.begin() as session:
        _require_live_employee_manager(session, principal)
        event = session.scalar(select(SecurityEvent).where(SecurityEvent.id == event_id)
                               .execution_options(populate_existing=True).with_for_update())
        if event is None:
            raise HTTPException(404, "The requested resource was not found.")
        if event.acknowledged_at is None:
            event.acknowledged_at = datetime.now(timezone.utc)
            event.acknowledged_by = principal.staff_id
        return SecurityAlertAcknowledgement(
            id=event.id, acknowledged_at=_utc(event.acknowledged_at), acknowledged_by=event.acknowledged_by,
        )
