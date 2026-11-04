"""Reception-station authentication use cases. HTTP transport lives in `app.api.reception_auth`."""
from threading import BoundedSemaphore
from uuid import UUID

from app.auth.authorization import AuthorizationDenied
from app.auth.hashing import hash_capacity
from app.auth.sessions import issue_reception_session, reception_profiles
from app.errors import http_errors

_DENIED = ((AuthorizationDenied, 401),)


def profiles(factory, credential: str):
    with http_errors(*_DENIED):
        return reception_profiles(factory, credential)


def login(factory, semaphore: BoundedSemaphore, credential: str, profile_id: UUID, pin: str):
    with hash_capacity(semaphore), http_errors(*_DENIED):
        return issue_reception_session(factory, credential, profile_id, pin)
