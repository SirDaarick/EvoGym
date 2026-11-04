"""Staff credential use cases: initial-PIN issue/reset and first PIN change. HTTP transport in `app.api.staff_credentials`.

Failures are typed `HttpStatusError`s.
"""
from threading import Semaphore
from uuid import UUID

from app.auth.credentials import change_initial_pin, issue_initial_pin as _issue_initial_pin
from app.errors import HttpStatusError, http_errors
from app.staff import queries as q


def issue_initial_pin(factory, staff_id: UUID, actor_id: UUID, admin_session_id: UUID) -> str:
    with http_errors((PermissionError, 404), (LookupError, 404)):
        return _issue_initial_pin(factory, staff_id, actor_id=actor_id, admin_session_id=admin_session_id)


def first_change(factory, semaphore: Semaphore, login_identifier: str, branch_id: UUID, current_pin: str, new_pin: str) -> None:
    """Bounded concurrent PIN hashing: 503 when no capacity, 401 for unknown login or wrong current PIN."""
    if not semaphore.acquire(blocking=False):
        raise HttpStatusError(503)
    try:
        with factory() as session:
            staff_id = q.staff_id_by_login(session, login_identifier.strip().casefold())
        if staff_id is None:
            raise HttpStatusError(401)
        if not change_initial_pin(factory, staff_id, branch_id, current_pin, new_pin):
            raise HttpStatusError(401)
    finally:
        semaphore.release()
