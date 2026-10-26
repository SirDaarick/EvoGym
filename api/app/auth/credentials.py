from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import StrEnum
import secrets
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.auth.hashing import hash_pin, verify_pin
from app.auth.authorization import Permission, _permits
from app.auth.owner import has_organization_permission
from app.db.models import AdminPasswordCredential, AdminTrustedDevice, Branch, RoleGrant, SecurityEvent, StaffCredential, StaffSession, StaffUser
from app.observability.security import SecurityEventType, SecurityOutcome, make_security_event, queue_security_event

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
        if credential.pin_change_required and (
            credential.initial_pin_expires_at is None
            or current_time >= _utc(credential.initial_pin_expires_at)
        ):
            matches = False
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
            queue_security_event(session, make_security_event(
                SecurityEventType.STAFF_PIN_LOCKED, employee_id=staff.id,
                outcome=SecurityOutcome.DENIED, occurred_at=current_time,
            ))
            return AuthenticationResult(AuthenticationStatus.DENIED)
        return AuthenticationResult(AuthenticationStatus.DENIED)


def issue_initial_pin(
    session_factory: sessionmaker[Session], staff_id: UUID, *, actor_id: UUID,
    admin_session_id: UUID, clock=lambda: datetime.now(timezone.utc),
) -> str:
    """Replace a staff PIN with a one-time disclosed, seven-day initial PIN."""
    raw_pin = f"{secrets.randbelow(1_000_000):06d}"
    digest = hash_pin(raw_pin)
    now = _utc(clock())
    with session_factory.begin() as session:
        # Reciprocal Admin resets acquire both user rows in the same UUID order.
        locked_users = {}
        for locked_id in sorted({actor_id, staff_id}, key=lambda value: value.int):
            locked_users[locked_id] = session.scalar(
                select(StaffUser).where(StaffUser.id == locked_id)
                .execution_options(populate_existing=True).with_for_update()
            )
        actor = locked_users[actor_id]
        staff = locked_users[staff_id]
        admin_credential = session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == actor_id)
                                          .execution_options(populate_existing=True).with_for_update())
        grants = session.scalars(select(RoleGrant).where(RoleGrant.staff_id == actor_id)
                                 .execution_options(populate_existing=True).with_for_update()).all()
        admin_session = session.scalar(select(StaffSession).where(
            StaffSession.id == admin_session_id, StaffSession.staff_id == actor_id,
            StaffSession.scope_kind == "organization", StaffSession.auth_method == "admin_password",
            StaffSession.revoked_at.is_(None),
        ).execution_options(populate_existing=True).with_for_update())
        trusted_device = session.scalar(select(AdminTrustedDevice).where(
            AdminTrustedDevice.id == admin_session.admin_trusted_device_id,
            AdminTrustedDevice.revoked_at.is_(None),
        ).execution_options(populate_existing=True).with_for_update()) if admin_session and admin_session.admin_trusted_device_id else None
        credential = session.scalar(select(StaffCredential).where(StaffCredential.staff_id == staff_id, StaffCredential.method == "pin")
                                    .execution_options(populate_existing=True).with_for_update())
        admin_allowed = actor is not None and actor.is_active and admin_credential is not None and admin_session is not None and trusted_device is not None and admin_session.expires_at is not None and now < _utc(admin_session.expires_at) and admin_session.absolute_expires_at is not None and admin_session.last_seen_at is not None and now < _utc(admin_session.absolute_expires_at) and now - _utc(admin_session.last_seen_at) < timedelta(days=30) and has_organization_permission(session, actor_id, Permission.STAFF_EMPLOYEE_MANAGE) and any(
            grant.is_active and grant.role == "admin" and grant.scope_kind == "organization" and grant.branch_id is None for grant in grants
        )
        if not admin_allowed:
            raise PermissionError("Authorization denied")
        if staff is None or not staff.is_active or credential is None:
            raise LookupError("Staff credentials unavailable")
        credential.secret_hash = digest
        credential.pin_change_required = True
        credential.initial_pin_expires_at = now + timedelta(days=7)
        credential.failed_attempts = 0
        credential.locked_until = None
        active_sessions = session.scalars(select(StaffSession).where(
            StaffSession.staff_id == staff_id, StaffSession.scope_kind == "branch",
            StaffSession.auth_method == "pin", StaffSession.revoked_at.is_(None),
        ).order_by(StaffSession.id).with_for_update()).all()
        for row in active_sessions:
            row.revoked_at = now
        queue_security_event(session, make_security_event(
            SecurityEventType.STAFF_PIN_RESET,
            employee_id=staff_id,
            initiating_actor_id=actor_id,
            occurred_at=now,
        ))
    return raw_pin


def change_initial_pin(
    session_factory: sessionmaker[Session], staff_id: UUID, branch_id: UUID,
    current_pin: str, new_pin: str, *, clock=lambda: datetime.now(timezone.utc),
) -> bool:
    """Atomically prove and replace an unexpired initial PIN within a live branch grant."""
    with session_factory.begin() as session:
        return change_initial_pin_in_session(session, staff_id, branch_id, current_pin, new_pin, clock=clock)


def change_initial_pin_in_session(
    session: Session, staff_id: UUID, branch_id: UUID, current_pin: str, new_pin: str,
    *, clock=lambda: datetime.now(timezone.utc),
) -> bool:
    """Apply the canonical initial-PIN policy inside the caller's authorization transaction."""
    if not isinstance(new_pin, str) or len(new_pin) != 6 or not new_pin.isascii() or not new_pin.isdigit():
        return False
    now = _utc(clock())
    staff = session.scalar(select(StaffUser).where(StaffUser.id == staff_id)
                               .execution_options(populate_existing=True).with_for_update())
    credential = session.scalar(select(StaffCredential).where(StaffCredential.staff_id == staff_id, StaffCredential.method == "pin")
                                    .execution_options(populate_existing=True).with_for_update())
    if staff is None or not staff.is_active or credential is None or not credential.pin_change_required:
        return False
    # Reject bad scope before bcrypt; the public route has shared IP and work limits.
    branch = session.scalar(select(Branch).where(Branch.id == branch_id)
                                .execution_options(populate_existing=True).with_for_update())
    grants = session.scalars(select(RoleGrant).where(RoleGrant.staff_id == staff_id)
                                 .execution_options(populate_existing=True).with_for_update()).all()
    if (
        branch is None or not branch.is_active
        or credential.initial_pin_expires_at is None
        or _utc(clock()) >= _utc(credential.initial_pin_expires_at)
        or not _permits(staff, branch, grants, Permission.MEMBER_OPERATIONAL_READ, branch_id)
    ):
        return False
    matches = verify_pin(current_pin, credential.secret_hash)
    current_time = _utc(clock())
    if credential.locked_until is not None:
        locked_until = _utc(credential.locked_until)
        if current_time < locked_until:
            return False
        credential.failed_attempts = 0
        credential.locked_until = None
    if current_time >= _utc(credential.initial_pin_expires_at) or verify_pin(new_pin, credential.secret_hash):
        return False
    if not matches:
        credential.failed_attempts += 1
        if credential.failed_attempts >= LOCKOUT_THRESHOLD:
            locked_until = current_time + LOCKOUT_DURATION
            credential.locked_until = locked_until
            session.add(SecurityEvent(staff_id=staff.id, occurred_at=current_time,
                                      locked_until=locked_until, reason="staff_pin_lockout",
                                      delivery_status="pending"))
            queue_security_event(session, make_security_event(
                SecurityEventType.STAFF_PIN_LOCKED, employee_id=staff_id,
                outcome=SecurityOutcome.DENIED, occurred_at=current_time,
            ))
        return False
    credential.secret_hash = hash_pin(new_pin)
    credential.pin_change_required = False
    credential.initial_pin_expires_at = None
    credential.failed_attempts = 0
    credential.locked_until = None
    queue_security_event(session, make_security_event(
        SecurityEventType.STAFF_PIN_CHANGED,
        employee_id=staff_id,
        initiating_actor_id=staff_id,
        occurred_at=current_time,
    ))
    return True
