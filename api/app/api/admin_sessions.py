from datetime import timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied
from app.db.models import AdminAuthEvent, StaffSession
from app.observability.logging import request_id

router = APIRouter(prefix="/api/v1/admin/sessions", tags=["admin sessions"])
_bearer = HTTPBearer(auto_error=False)


def _principal(request: Request, credentials: HTTPAuthorizationCredentials | None):
    settings = request.app.state.settings
    factory = request.app.state.session_factory
    if not settings.admin_auth_configured or factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")
    try:
        return validate_admin_session(factory, credentials.credentials)
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.") from None


@router.get("")
def list_sessions(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)):
    staff_id, _current_id = _principal(request, credentials)
    factory = request.app.state.session_factory
    with factory() as session:
        rows = session.scalars(select(StaffSession).where(StaffSession.staff_id == staff_id,
            StaffSession.scope_kind == "organization", StaffSession.auth_method == "admin_password").order_by(StaffSession.issued_at.desc())).all()
        return {"sessions": [{"id": str(row.id), "staff_id": str(row.staff_id), "scope_kind": row.scope_kind,
            "auth_method": row.auth_method, "issued_at": row.issued_at.astimezone(timezone.utc).isoformat(),
            "expires_at": row.expires_at.astimezone(timezone.utc).isoformat(),
            "revoked": row.revoked_at is not None} for row in rows]}


@router.post("/{session_id}/revoke")
def revoke_session(session_id: UUID, request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)):
    staff_id, current_session_id = _principal(request, credentials)
    factory = request.app.state.session_factory
    with factory.begin() as session:
        row = session.scalar(select(StaffSession).where(StaffSession.id == session_id, StaffSession.staff_id == staff_id,
            StaffSession.scope_kind == "organization", StaffSession.auth_method == "admin_password").with_for_update())
        if row is None:
            raise HTTPException(404, "The requested resource was not found.")
        if row.revoked_at is None:
            from app.auth.admin import utc_now
            now = utc_now()
            row.revoked_at = now
            session.add(AdminAuthEvent(actor_id=staff_id, subject_staff_id=staff_id,
                action="admin_session_revoked", request_id=UUID(request_id()), occurred_at=now))
    return {"revoked": True}
