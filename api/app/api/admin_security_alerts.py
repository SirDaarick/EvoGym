"""Global, in-app Admin view of pending employee PIN lockouts."""

from uuid import UUID

from fastapi import APIRouter, Query

from app.api.deps import AdminDep, SessionFactoryDep
from app.auth import security_alerts as service
from app.auth.security_alerts import SecurityAlertAcknowledgement, SecurityAlertPage

router = APIRouter(prefix="/api/v1/admin/security-alerts", tags=["admin security alerts"])


@router.get("", response_model=SecurityAlertPage)
def list_security_alerts(
    principal: AdminDep, *, factory: SessionFactoryDep,
    limit: int = Query(default=50, ge=1, le=100), cursor: UUID | None = Query(default=None),
):
    return service.list_alerts(factory, principal, limit, cursor)


@router.post("/{event_id}/acknowledge", response_model=SecurityAlertAcknowledgement)
def acknowledge_security_alert(event_id: UUID, principal: AdminDep, *, factory: SessionFactoryDep):
    return service.acknowledge(factory, principal, event_id)
