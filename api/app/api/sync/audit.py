"""Sync audit flags endpoints for viewing and resolving contingency discrepancies (T5.9)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict

from app.api.deps import SessionDep, SettingsDep
from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.sync.flags import AuditFlagDTO, flag_to_dto, list_flags, resolve_flag

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])
_bearer = HTTPBearer(auto_error=False)


def _resolve_audit_staff(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UUID:
    factory = request.app.state.session_factory
    settings = getattr(request.app.state, "settings", None)
    if factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")
    token = credentials.credentials

    # 1. Admin session
    if settings and getattr(settings, "admin_auth_configured", False) and getattr(settings, "admin_token_signing_configured", False):
        try:
            staff_id, _ = validate_admin_session(
                factory, token, settings.admin_token_signing_secret.get_secret_value()
            )
            return staff_id
        except (AuthorizationDenied, ValueError):
            pass

    # 2. Staff with ADMIN_AUDIT_READ or FINANCE_READ or MEMBER_OPERATIONAL_READ
    for perm in (Permission.ADMIN_AUDIT_READ, Permission.FINANCE_READ, Permission.MEMBER_OPERATIONAL_READ):
        try:
            principal = validate_session(factory, token, perm)
            return principal.staff_id
        except AuthorizationDenied:
            continue

    raise HTTPException(401, "Authentication failed.")


@router.get("/audit-flags", response_model=list[AuditFlagDTO])
def get_audit_flags(
    staff_id: Annotated[UUID, Depends(_resolve_audit_staff)],
    session: SessionDep,
    branch_id: UUID | None = None,
    shift_id: UUID | None = None,
    open_only: bool = True,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[AuditFlagDTO]:
    flags = list_flags(session, branch_id=branch_id, shift_id=shift_id, open_only=open_only, limit=limit)
    return [flag_to_dto(f) for f in flags]


@router.post("/audit-flags/{flag_id}/resolve", response_model=AuditFlagDTO)
def resolve_audit_flag(
    flag_id: UUID,
    staff_id: Annotated[UUID, Depends(_resolve_audit_staff)],
    session: SessionDep,
) -> AuditFlagDTO:
    flag = resolve_flag(session, flag_id, resolved_by=staff_id)
    session.commit()
    return flag_to_dto(flag)
