"""Admin session and trusted-device management use cases. HTTP transport in `app.api.admin_sessions`."""
from datetime import timezone
from uuid import UUID

from app.auth import admin_queries as q
from app.auth.admin import utc_now
from app.db.models import AdminAuthEvent
from app.errors import HttpStatusError
from app.observability.logging import request_id


def list_sessions(factory, staff_id: UUID) -> dict:
    with factory() as session:
        rows = q.admin_sessions_for(session, staff_id)
        return {"sessions": [{"id": str(row.id), "staff_id": str(row.staff_id), "scope_kind": row.scope_kind,
            "auth_method": row.auth_method, "issued_at": row.issued_at.astimezone(timezone.utc).isoformat(),
            "expires_at": row.expires_at.astimezone(timezone.utc).isoformat(),
            "revoked": row.revoked_at is not None} for row in rows]}


def revoke_session(factory, staff_id: UUID, session_id: UUID) -> dict:
    with factory.begin() as session:
        row = q.locked_admin_session(session, session_id, staff_id)
        if row is None:
            raise HttpStatusError(404)
        if row.revoked_at is None:
            now = utc_now()
            row.revoked_at = now
            session.add(AdminAuthEvent(actor_id=staff_id, subject_staff_id=staff_id,
                action="admin_session_revoked", request_id=UUID(request_id()), occurred_at=now))
    return {"revoked": True}


def list_trusted_devices(factory, staff_id: UUID) -> dict:
    with factory() as session:
        rows = q.trusted_devices_for(session, staff_id)
        return {"devices": [{"id": str(row.id), "category": row.category,
            "created_at": row.created_at.astimezone(timezone.utc).isoformat(),
            "last_used_at": row.last_used_at.astimezone(timezone.utc).isoformat(),
            "revoked": row.revoked_at is not None} for row in rows]}


def revoke_trusted_device(factory, actor_id: UUID, device_id: UUID) -> dict:
    with factory.begin() as session:
        device_probe = q.device_probe(session, device_id)
        if device_probe is None:
            raise HttpStatusError(404)
        subject = q.locked_staff_user(session, device_probe.staff_id)
        sessions = q.locked_device_sessions(session, device_id)
        device = q.locked_device(session, device_id)
        if device is None or subject is None or device.staff_id != device_probe.staff_id:
            raise HttpStatusError(404)
        if device.staff_id != actor_id and q.owner_credential(session, actor_id) is None:
            raise HttpStatusError(404)
        now = utc_now()
        if device.revoked_at is None:
            device.revoked_at = now
            for admin_session in sessions:
                admin_session.revoked_at = now
            session.add(AdminAuthEvent(actor_id=actor_id, subject_staff_id=device.staff_id,
                action="admin_trusted_device_revoked", request_id=UUID(request_id()), occurred_at=now))
    return {"revoked": True}
