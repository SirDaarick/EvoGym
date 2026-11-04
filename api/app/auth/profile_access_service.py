"""Profile-access use cases: capacity, authentication-failure mapping and employee-session logout checks.

HTTP transport lives in `app.api.profile_access`; SQL in `app.auth.profile_access`. Failures are `HttpStatusError`s.
"""
from threading import BoundedSemaphore
from uuid import UUID

from app.auth.admin import validate_admin_session
from app.auth.authorization import AuthorizationDenied
from app.auth.hashing import hash_capacity
from app.auth.profile_access import (
    admin_profile_choices,
    bind_profile_access,
    change_profile_initial_pin,
    issue_profile_session,
    logout_profile_access,
    paired_profile_choices,
    revoke_employee_profile_session,
)
from app.errors import HttpStatusError, http_errors

_DENIED = ((AuthorizationDenied, 401),)


def pair(factory, semaphore: BoundedSemaphore, pairing_code: str, request_id: UUID):
    with hash_capacity(semaphore), http_errors(*_DENIED):
        return bind_profile_access(factory, pairing_code, request_id=request_id)


def paired_profiles(factory, credential: str):
    with http_errors(*_DENIED):
        return paired_profile_choices(factory, credential)


def admin_profiles(factory, admin_id: UUID, session_id: UUID):
    with http_errors(*_DENIED):
        return admin_profile_choices(factory, admin_id, session_id)


def enter_profile(factory, semaphore: BoundedSemaphore, profile_id: UUID, branch_id: UUID, pin: str, request_id: UUID,
                  *, paired_credential: str | None = None, admin_id: UUID | None = None,
                  admin_session_id: UUID | None = None):
    kwargs = ({"paired_credential": paired_credential} if admin_id is None
              else {"admin_id": admin_id, "admin_session_id": admin_session_id})
    with hash_capacity(semaphore), http_errors(*_DENIED):
        return issue_profile_session(factory, profile_id, branch_id, pin, request_id=request_id, **kwargs)


def change_pin(factory, semaphore: BoundedSemaphore, profile_id: UUID, branch_id: UUID, current_pin: str,
               new_pin: str, *, paired_credential: str | None = None, admin_id: UUID | None = None,
               admin_session_id: UUID | None = None) -> None:
    kwargs = ({"paired_credential": paired_credential} if admin_id is None
              else {"admin_id": admin_id, "admin_session_id": admin_session_id})
    with hash_capacity(semaphore):
        changed = change_profile_initial_pin(factory, profile_id, branch_id, current_pin, new_pin, **kwargs)
    if not changed:
        raise HttpStatusError(401)


def logout_paired(factory, credential: str) -> None:
    logout_profile_access(factory, credential)


def logout_employee_session(factory, settings, token: str | None) -> None:
    """401 unless the token is a live employee profile session (an admin token is rejected here)."""
    if (factory is None or token is None or not settings.admin_auth_configured
            or not settings.admin_token_signing_configured):
        raise HttpStatusError(401)
    try:
        validate_admin_session(factory, token, settings.admin_token_signing_secret.get_secret_value())
    except (AuthorizationDenied, ValueError):
        pass
    else:
        raise HttpStatusError(401)
    with http_errors(*_DENIED):
        revoke_employee_profile_session(factory, token)
