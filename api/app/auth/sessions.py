from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import re
import secrets
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.auth.authorization import AuthorizationDenied, Permission, _lock_authority, _permits
from app.auth.credentials import AuthenticationStatus, authenticate_pin
from app.auth.hashing import verify_pin
from app.db.models import Branch, RoleGrant, StaffCredential, StaffSession, StaffUser

_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")


@dataclass(frozen=True, slots=True)
class IssuedSession:
    staff_id: UUID
    branch_id: UUID
    token: str = field(repr=False)
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class SessionPrincipal:
    staff_id: UUID
    branch_id: UUID


def _aware_utc(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Session timestamps must be timezone-aware")
    return value.astimezone(timezone.utc)


def _stored_utc(value: datetime) -> datetime:
    # SQLite drops timezone metadata; persisted values are written as aware UTC.
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _digest(token: str) -> str | None:
    if not isinstance(token, str) or not _TOKEN_PATTERN.fullmatch(token):
        return None
    try:
        encoded = token.encode("ascii")
    except UnicodeEncodeError:
        return None
    return hashlib.sha256(encoded).hexdigest()




def issue_session(
    session_factory: sessionmaker[Session],
    login_identifier: str,
    pin: str,
    branch_id: UUID,
    expires_at: datetime,
    *,
    clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> IssuedSession:
    """Authenticate with a PIN and issue an opaque branch-bound session.

    This is an internal application service, not a transport/API boundary.
    Callers must derive ``expires_at`` from server-owned policy; expiry is
    required because no deployment TTL is approved. PIN verification and session
    persistence are separate owned transactions; the locked issuance transaction
    rechecks active staff, the current PIN hash, and lock state. The bearer
    token is returned once, only after its digest commits.
    """
    if not isinstance(branch_id, UUID):
        raise AuthorizationDenied("Authorization denied")
    expiry = _aware_utc(expires_at)
    authentication = authenticate_pin(session_factory, login_identifier, pin, clock=clock)
    if authentication.status is not AuthenticationStatus.AUTHENTICATED or authentication.staff_id is None:
        raise AuthorizationDenied("Authorization denied")

    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode("ascii")).hexdigest()
    with session_factory.begin() as session:
        staff = session.scalar(
            select(StaffUser).where(StaffUser.id == authentication.staff_id)
            .execution_options(populate_existing=True).with_for_update()
        )
        credential = session.scalar(
            select(StaffCredential).where(
                StaffCredential.staff_id == authentication.staff_id,
                StaffCredential.method == "pin",
            ).execution_options(populate_existing=True).with_for_update()
        )
        branch = session.scalar(
            select(Branch).where(Branch.id == branch_id)
            .execution_options(populate_existing=True).with_for_update()
        )
        grants = session.scalars(
            select(RoleGrant).where(RoleGrant.staff_id == authentication.staff_id)
            .execution_options(populate_existing=True).with_for_update()
        ).all()
        matches = verify_pin(pin, credential.secret_hash) if credential is not None else False
        current = _aware_utc(clock())
        if (
            staff is None or not staff.is_active or credential is None or not matches
            or (credential.locked_until is not None and current < _stored_utc(credential.locked_until))
            or not _permits(staff, branch, grants, Permission.MEMBER_OPERATIONAL_READ, branch_id)
        ):
            raise AuthorizationDenied("Authorization denied")
        if expiry <= current:
            raise ValueError("Session expiry must be in the future")
        session.add(StaffSession(
            staff_id=staff.id,
            branch_id=branch.id,
            token_digest=digest,
            issued_at=current,
            expires_at=expiry,
        ))
    return IssuedSession(authentication.staff_id, branch_id, token, expiry)


def validate_session(
    session_factory: sessionmaker[Session],
    token: str,
    permission: Permission | str,
    *,
    clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> SessionPrincipal:
    digest = _digest(token)
    if digest is None:
        raise AuthorizationDenied("Authorization denied")
    with session_factory.begin() as session:
        row = session.scalar(select(StaffSession).where(StaffSession.token_digest == digest).with_for_update())
        if row is None:
            raise AuthorizationDenied("Authorization denied")
        staff, branch, grants = _lock_authority(session, row.staff_id, row.branch_id)
        current = _aware_utc(clock())
        if row.revoked_at is not None or current >= _stored_utc(row.expires_at):
            raise AuthorizationDenied("Authorization denied")
        if not _permits(staff, branch, grants, permission, row.branch_id):
            raise AuthorizationDenied("Authorization denied")
        return SessionPrincipal(row.staff_id, row.branch_id)


def revoke_session(
    session_factory: sessionmaker[Session],
    token: str,
    *,
    clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> bool:
    digest = _digest(token)
    if digest is None:
        return False
    with session_factory.begin() as session:
        row = session.scalar(select(StaffSession).where(StaffSession.token_digest == digest).with_for_update())
        if row is None:
            return False
        current = _aware_utc(clock())
        if row.revoked_at is not None:
            return False
        row.revoked_at = current
        return True
