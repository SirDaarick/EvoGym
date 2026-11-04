"""Shared FastAPI dependencies: DB session factory/session and principal resolution."""

from collections.abc import Generator
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session, sessionmaker

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied
from app.db.session import get_session as _session_lifecycle

_bearer = HTTPBearer(auto_error=False)


def get_session_factory(request: Request) -> sessionmaker[Session]:
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(500, "Database session factory not configured.")
    return factory


SessionFactoryDep = Annotated[sessionmaker[Session], Depends(get_session_factory)]


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
