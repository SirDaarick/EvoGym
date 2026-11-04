"""Shared FastAPI dependencies: DB session factory/session and principal resolution."""

from collections.abc import Generator
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session, sessionmaker

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied, Permission
from app.auth.sessions import validate_session
from app.db.session import get_session as _session_lifecycle
from app.settings import Settings

_bearer = HTTPBearer(auto_error=False)


def get_session_factory(request: Request) -> sessionmaker[Session]:
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    return factory


SessionFactoryDep = Annotated[sessionmaker[Session], Depends(get_session_factory)]


def get_raw_session_factory(request: Request):
    """Raw state: a missing factory becomes 503 inside the service, after its permission checks."""
    return request.app.state.session_factory


RawFactoryDep = Annotated[object, Depends(get_raw_session_factory)]


def get_session(factory: SessionFactoryDep) -> Generator[Session, None, None]:
    """One session per request; never commits (services own `commit()`), rolls back and closes on exit."""
    yield from _session_lifecycle(factory)


SessionDep = Annotated[Session, Depends(get_session)]


@dataclass(frozen=True, slots=True)
class AdminPrincipal:
    staff_id: UUID
    session_id: UUID


def get_admin_principal(
    request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)
) -> AdminPrincipal:
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


AdminDep = Annotated[AdminPrincipal, Depends(get_admin_principal)]


def get_app_settings(request: Request) -> Settings | None:
    return getattr(request.app.state, "settings", None)


SettingsDep = Annotated[Settings | None, Depends(get_app_settings)]


OptionalBearerDep = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]


@dataclass(frozen=True, slots=True)
class RosterPrincipal:
    staff_id: UUID
    is_admin: bool
    branch_id: UUID | None


def get_roster_principal(request: Request, credentials: OptionalBearerDep) -> RosterPrincipal:
    """Admin token (no branch) or a staff session holding STAFF_ROSTER_READ; shared by roster, schedules, attendance."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503, "Database unavailable.")
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")
    token = credentials.credentials
    settings = getattr(request.app.state, "settings", None)
    if (
        settings
        and getattr(settings, "admin_auth_configured", False)
        and getattr(settings, "admin_token_signing_configured", False)
    ):
        try:
            staff_id, _session_id = validate_admin_session(
                factory, token, settings.admin_token_signing_secret.get_secret_value()
            )
            return RosterPrincipal(staff_id, True, None)
        except (AuthorizationDenied, ValueError):
            pass
    try:
        principal = validate_session(factory, token, Permission.STAFF_ROSTER_READ)
        return RosterPrincipal(principal.staff_id, False, principal.branch_id)
    except (AuthorizationDenied, ValueError):
        raise HTTPException(401, "Authentication failed.") from None


@dataclass(frozen=True, slots=True)
class FinancePrincipal:
    staff_id: UUID
    organization_admin: bool
    branch_id: UUID | None


def _principal(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> FinancePrincipal:
    factory = request.app.state.session_factory
    if factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")
    token = credentials.credentials
    try:
        settings = request.app.state.settings
        if not settings.admin_auth_configured or not settings.admin_token_signing_configured:
            raise AuthorizationDenied("Authorization denied")
        staff_id, _session_id = validate_admin_session(
            factory, token, settings.admin_token_signing_secret.get_secret_value()
        )
        return FinancePrincipal(staff_id, organization_admin=True, branch_id=None)
    except (AuthorizationDenied, ValueError):
        pass
    try:
        staff = validate_session(factory, token, Permission.MEMBER_OPERATIONAL_READ)
        return FinancePrincipal(staff.staff_id, organization_admin=False, branch_id=staff.branch_id)
    except (AuthorizationDenied, ValueError):
        raise HTTPException(401, "Authentication failed.") from None


def resolve_credentials_admin(request: Request, credentials: HTTPAuthorizationCredentials | None):
    """Admin (staff_id, session_id) for the credentials endpoints; called in the handler, not as a dependency."""
    settings = request.app.state.settings
    factory = request.app.state.session_factory
    if not settings.admin_auth_configured or factory is None or credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication failed.")
    if not settings.admin_token_signing_configured:
        raise HTTPException(503, "Authentication is temporarily unavailable.")
    try:
        return validate_admin_session(factory, credentials.credentials, settings.admin_token_signing_secret.get_secret_value())
    except AuthorizationDenied:
        raise HTTPException(401, "Authentication failed.") from None
