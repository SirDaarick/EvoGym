from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
import re
import secrets
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.auth.authorization import AuthorizationDenied, Permission, _lock_authority, _permits
from app.auth.credentials import AuthenticationStatus, authenticate_pin
from app.auth.hashing import verify_pin
from app.db.models import AdminTrustedDevice, Branch, ReceptionStation, RoleGrant, StaffCredential, StaffRosterProfile, StaffSession, StaffUser
from app.observability.security import SecurityEventType, make_security_event, queue_security_event

_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
PHONE_IDLE = timedelta(days=30)
EMPLOYEE_ABSOLUTE = timedelta(days=90)


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
    purpose: str = "phone",
    reception_station_id: UUID | None = None,
    reception_profile_id: UUID | None = None,
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
    if purpose not in {"phone", "reception"} or (purpose == "phone" and reception_station_id is not None) or (
        purpose == "reception" and not isinstance(reception_station_id, UUID)
    ) or (purpose == "phone" and reception_profile_id is not None) or (
        purpose == "reception" and not isinstance(reception_profile_id, UUID)
    ):
        raise AuthorizationDenied("Authorization denied")
    requested_expiry = _aware_utc(expires_at)
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
        station = None
        if purpose == "reception":
            station = session.scalar(select(ReceptionStation).where(
                ReceptionStation.id == reception_station_id,
                ReceptionStation.branch_id == branch_id,
                ReceptionStation.revoked_at.is_(None),
            ).execution_options(populate_existing=True).with_for_update())
            profile = session.scalar(select(StaffRosterProfile).where(
                StaffRosterProfile.id == reception_profile_id,
                StaffRosterProfile.branch_id == branch_id,
                StaffRosterProfile.staff_user_id == authentication.staff_id,
                StaffRosterProfile.is_active.is_(True),
            ).execution_options(populate_existing=True).with_for_update())
        else:
            profile = None
        matches = verify_pin(pin, credential.secret_hash) if credential is not None else False
        current = _aware_utc(clock())
        if (
            staff is None or not staff.is_active or credential is None or not matches
            or credential.pin_change_required
            or (credential.locked_until is not None and current < _stored_utc(credential.locked_until))
            or not _permits(staff, branch, grants, Permission.MEMBER_OPERATIONAL_READ, branch_id)
            or (purpose == "reception" and (station is None or profile is None or current >= _stored_utc(station.expires_at)))
        ):
            raise AuthorizationDenied("Authorization denied")
        expiry = min(requested_expiry, current + EMPLOYEE_ABSOLUTE)
        if expiry <= current:
            raise ValueError("Session expiry must be in the future")
        session.add(StaffSession(
            staff_id=staff.id,
            branch_id=branch.id,
            token_digest=digest,
            issued_at=current,
            expires_at=expiry,
            absolute_expires_at=expiry,
            last_seen_at=current,
            employee_purpose=purpose,
            reception_station_id=reception_station_id,
        ))
        queue_security_event(session, make_security_event(
            SecurityEventType.STAFF_SESSION_ISSUED,
            employee_id=authentication.staff_id,
            device_id=reception_station_id,
            initiating_actor_id=authentication.staff_id,
            occurred_at=current,
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
        initial = session.scalar(select(StaffSession).where(StaffSession.token_digest == digest))
        if initial is None:
            raise AuthorizationDenied("Authorization denied")
        staff, branch, grants = _lock_authority(session, initial.staff_id, initial.branch_id)
        purpose = initial.employee_purpose or ("phone" if initial.scope_kind == "branch" else None)
        station = None
        source_admin_device = None
        if initial.scope_kind == "branch" and purpose == "reception" and initial.reception_station_id is not None:
            # Station revocation locks the station before its sessions. Match that
            # order here to prevent a station/session lock inversion on PostgreSQL.
            station = session.scalar(select(ReceptionStation).where(
                ReceptionStation.id == initial.reception_station_id,
                ReceptionStation.branch_id == initial.branch_id,
            ).execution_options(populate_existing=True).with_for_update())
        row = session.scalar(select(StaffSession).where(StaffSession.id == initial.id)
                             .execution_options(populate_existing=True).with_for_update())
        if row is None:
            raise AuthorizationDenied("Authorization denied")
        if row.employee_purpose != initial.employee_purpose or row.reception_station_id != initial.reception_station_id:
            raise AuthorizationDenied("Authorization denied")
        if station is not None and station.source_admin_device_id is not None:
            # Follow the shared station -> employee-session -> source-device lock order.
            source_admin_device = session.scalar(select(AdminTrustedDevice).where(
                AdminTrustedDevice.id == station.source_admin_device_id,
                AdminTrustedDevice.category == "computer",
                AdminTrustedDevice.revoked_at.is_(None),
            ).execution_options(populate_existing=True).with_for_update())
        current = _aware_utc(clock())
        absolute_expiry = row.absolute_expires_at or row.expires_at
        if row.revoked_at is not None or current >= _stored_utc(row.expires_at) or current >= _stored_utc(absolute_expiry):
            raise AuthorizationDenied("Authorization denied")
        if row.scope_kind == "branch" and purpose == "phone":
            last_seen = _stored_utc(row.last_seen_at or row.issued_at)
            if current - last_seen >= PHONE_IDLE:
                row.revoked_at = current
                raise AuthorizationDenied("Authorization denied")
        elif row.scope_kind == "branch" and purpose == "reception":
            if (station is None or station.revoked_at is not None or current >= _stored_utc(station.expires_at)
                    or (station.source_admin_device_id is not None and source_admin_device is None)):
                row.revoked_at = current
                raise AuthorizationDenied("Authorization denied")
        if not _permits(staff, branch, grants, permission, row.branch_id):
            raise AuthorizationDenied("Authorization denied")
        if row.scope_kind == "branch":
            row.last_seen_at = current
        return SessionPrincipal(row.staff_id, row.branch_id)


def reception_profiles(session_factory: sessionmaker[Session], station_credential: str, *, clock=lambda: datetime.now(timezone.utc)):
    """Return only active, linked profiles in the branch bound to a valid station secret."""
    digest = hashlib.sha256(station_credential.encode("utf-8")).hexdigest() if isinstance(station_credential, str) else ""
    now = _aware_utc(clock())
    with session_factory() as session:
        station = session.scalar(select(ReceptionStation).where(
            ReceptionStation.credential_digest == digest,
            ReceptionStation.revoked_at.is_(None),
        ))
        if station is None or now >= _stored_utc(station.expires_at):
            raise AuthorizationDenied("Authorization denied")
        return session.execute(
            select(StaffRosterProfile.id, StaffRosterProfile.full_name, StaffRosterProfile.position)
            .join(StaffUser, StaffUser.id == StaffRosterProfile.staff_user_id)
            .where(StaffRosterProfile.branch_id == station.branch_id, StaffRosterProfile.is_active.is_(True),
                   StaffUser.is_active.is_(True))
            .order_by(StaffRosterProfile.full_name, StaffRosterProfile.id)
        ).all()


def issue_reception_session(session_factory: sessionmaker[Session], station_credential: str, profile_id: UUID,
                            pin: str, *, clock=lambda: datetime.now(timezone.utc)) -> IssuedSession:
    digest = hashlib.sha256(station_credential.encode("utf-8")).hexdigest() if isinstance(station_credential, str) else ""
    now = _aware_utc(clock())
    with session_factory() as session:
        station = session.scalar(select(ReceptionStation).where(
            ReceptionStation.credential_digest == digest, ReceptionStation.revoked_at.is_(None),
        ))
        if station is None or now >= _stored_utc(station.expires_at):
            raise AuthorizationDenied("Authorization denied")
        profile = session.scalar(select(StaffRosterProfile).where(
            StaffRosterProfile.id == profile_id, StaffRosterProfile.branch_id == station.branch_id,
            StaffRosterProfile.is_active.is_(True), StaffRosterProfile.staff_user_id.is_not(None),
        ))
        staff = session.get(StaffUser, profile.staff_user_id) if profile is not None else None
        if staff is None or not staff.is_active:
            raise AuthorizationDenied("Authorization denied")
        login_identifier = staff.login_identifier
        branch_id = station.branch_id
        station_id = station.id
    return issue_session(session_factory, login_identifier, pin, branch_id, now + EMPLOYEE_ABSOLUTE,
                         purpose="reception", reception_station_id=station_id,
                         reception_profile_id=profile_id, clock=clock)


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
        queue_security_event(session, make_security_event(
            SecurityEventType.STAFF_SESSION_REVOKED,
            employee_id=row.staff_id,
            device_id=row.reception_station_id,
            initiating_actor_id=row.staff_id,
            occurred_at=current,
        ))
        return True
