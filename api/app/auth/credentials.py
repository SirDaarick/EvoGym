from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.auth.hashing import verify_pin
from app.db.models import SecurityEvent, StaffCredential, StaffUser

LOCKOUT_THRESHOLD = 5
LOCKOUT_DURATION = timedelta(minutes=5)
# A fixed, non-secret valid bcrypt hash makes unknown identifiers take the same
# expensive verification path as known identifiers without persisting a dummy row.
_DUMMY_HASH = "$2b$12$R9h/cIPz0gi.URNN3kh2OO.9n9Ub.lCCfPYJUxePX.CbvLHQGp.y"


class AuthenticationStatus(StrEnum):
    AUTHENTICATED = "authenticated"
    DENIED = "denied"


@dataclass(frozen=True, slots=True)
class AuthenticationResult:
    status: AuthenticationStatus
    staff_id: UUID | None = None


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def authenticate_pin(
    session_factory: sessionmaker[Session],
    login_identifier: str,
    pin: str,
    *,
    clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> AuthenticationResult:
    """Authenticate in one owned transaction; caller receives no uncommitted result.

    PostgreSQL row locking serializes concurrent attempts on a credential. The
    transaction commits both the fifth failure and its pending Admin alert, or
    rolls both back if either write fails. This is deliberately not an HTTP route.
    """
    normalized_identifier = login_identifier.strip().casefold()
    with session_factory.begin() as session:
        staff = session.scalar(
            select(StaffUser)
            .where(StaffUser.login_identifier == normalized_identifier)
            .with_for_update()
        )
        if staff is None:
            verify_pin(pin, _DUMMY_HASH)
            return AuthenticationResult(AuthenticationStatus.DENIED)

        credential = session.scalar(
            select(StaffCredential)
            .where(StaffCredential.staff_id == staff.id, StaffCredential.method == "pin")
            .with_for_update()
        )
        if credential is None:
            verify_pin(pin, _DUMMY_HASH)
            return AuthenticationResult(AuthenticationStatus.DENIED)

        matches = verify_pin(pin, credential.secret_hash)
        current_time = _utc(clock())
        if credential.locked_until is not None:
            locked_until = _utc(credential.locked_until)
            if current_time < locked_until:
                return AuthenticationResult(AuthenticationStatus.DENIED)
            credential.failed_attempts = 0
            credential.locked_until = None

        if not staff.is_active:
            return AuthenticationResult(AuthenticationStatus.DENIED)
        if matches:
            credential.failed_attempts = 0
            credential.locked_until = None
            return AuthenticationResult(AuthenticationStatus.AUTHENTICATED, staff.id)

        credential.failed_attempts += 1
        if credential.failed_attempts >= LOCKOUT_THRESHOLD:
            locked_until = current_time + LOCKOUT_DURATION
            credential.locked_until = locked_until
            session.add(
                SecurityEvent(
                    staff_id=staff.id,
                    occurred_at=current_time,
                    locked_until=locked_until,
                    reason="staff_pin_lockout",
                    delivery_status="pending",
                )
            )
            return AuthenticationResult(AuthenticationStatus.DENIED)
        return AuthenticationResult(AuthenticationStatus.DENIED)
