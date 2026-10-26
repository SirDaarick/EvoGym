"""Server-authoritative profile discovery, device proof, and PIN entry."""

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets
import re
from uuid import UUID

from sqlalchemy import select, update, or_
from sqlalchemy.orm import Session, sessionmaker

from app.auth.admin import ADMIN_IDLE_SECONDS
from app.auth.authorization import AuthorizationDenied, Permission, _permits
from app.auth.credentials import AuthenticationStatus, authenticate_pin, change_initial_pin_in_session
from app.auth.hashing import verify_pin
from app.auth.owner import has_organization_permission, is_owner
from app.auth.sessions import EMPLOYEE_ABSOLUTE, PHONE_IDLE
from app.db.models import (
    AdminPasswordCredential,
    AdminTrustedDevice,
    Branch,
    ReceptionStation,
    RoleGrant,
    StaffCredential,
    StaffDevicePairingCode,
    StaffPairedDevice,
    StaffRosterProfile,
    StaffSession,
    StaffUser,
)
from app.observability.security import SecurityEventType, make_security_event, queue_security_event


_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
PROFILE_ACCESS_IDLE = PHONE_IDLE


@dataclass(frozen=True, slots=True)
class ProfileBranch:
    profile_id: UUID
    branch_id: UUID
    branch_name: str


@dataclass(frozen=True, slots=True)
class ProfileIdentity:
    staff_id: UUID
    kind: str
    display_name: str
    login_identifier: str
    branches: tuple[ProfileBranch, ...]
    is_owner: bool = False
    can_manage_employees: bool = False


@dataclass(frozen=True, slots=True)
class UnlinkedProfileIdentity:
    """Admin-only discovery projection for a roster row without a StaffUser."""
    profile_id: UUID
    display_name: str
    branch: ProfileBranch
    kind: str = "unlinked"


@dataclass(frozen=True, slots=True)
class ProfileBinding:
    device_id: UUID
    staff_id: UUID
    # Returned only to the route so it can set the HttpOnly cookie; never serialize.
    credential: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class ProfileEntrySession:
    staff_id: UUID
    branch_id: UUID
    profile_id: UUID
    access_token: str = field(repr=False)
    expires_at: datetime
    purpose: str


@dataclass(frozen=True, slots=True)
class ProfilePinSetupRequired:
    identity_id: UUID
    profile_id: UUID
    branch_id: UUID


def change_profile_initial_pin(
    session_factory: sessionmaker[Session], profile_id: UUID, branch_id: UUID,
    current_pin: str, new_pin: str, *, paired_credential: str | None = None,
    admin_id: UUID | None = None, admin_session_id: UUID | None = None,
    clock=lambda: datetime.now(timezone.utc),
) -> bool:
    if (paired_credential is None) == (admin_id is None or admin_session_id is None):
        return False
    now = _utc(clock())
    paired_digest = _token_digest(paired_credential) if paired_credential is not None else None
    with session_factory.begin() as session:
        target_id = session.execute(select(StaffRosterProfile.staff_user_id).where(
            StaffRosterProfile.id == profile_id, StaffRosterProfile.branch_id == branch_id,
        )).scalar_one_or_none()
        if target_id is None:
            return False
        principal_ids = {target_id}
        if admin_id is not None:
            if admin_id == target_id:
                return False
            principal_ids.add(admin_id)
        principals = _lock_staff_users(session, principal_ids)
        grants_by_staff = {staff_id: _active_grants(session, staff_id) for staff_id in principal_ids}
        staff = principals.get(target_id)
        branch = session.scalar(select(Branch).where(Branch.id == branch_id)
                                .execution_options(populate_existing=True).with_for_update())
        profile = session.scalar(select(StaffRosterProfile).where(
            StaffRosterProfile.id == profile_id, StaffRosterProfile.branch_id == branch_id,
        ).execution_options(populate_existing=True).with_for_update())
        if (staff is None or not staff.is_active or branch is None or not branch.is_active
                or profile is None or not profile.is_active or profile.staff_user_id != target_id
                or not _permits(staff, branch, grants_by_staff[target_id], Permission.MEMBER_OPERATIONAL_READ, branch_id)):
            return False
        if paired_credential is not None:
            if paired_digest is None or _proof_device(session, paired_digest, now, staff=staff).staff_id != target_id:
                return False
        else:
            _lock_live_admin(session, admin_id, admin_session_id, now)
        return change_initial_pin_in_session(session, target_id, branch_id, current_pin, new_pin, clock=clock)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _token_digest(token: str) -> str | None:
    if not isinstance(token, str) or not _TOKEN_PATTERN.fullmatch(token):
        return None
    try:
        return hashlib.sha256(token.encode("ascii")).hexdigest()
    except UnicodeEncodeError:
        return None


def _active_grants(session: Session, staff_id: UUID) -> list[RoleGrant]:
    return session.scalars(
        select(RoleGrant).where(RoleGrant.staff_id == staff_id).order_by(RoleGrant.id)
        .execution_options(populate_existing=True).with_for_update()
    ).all()


def _visible_profiles(session: Session, staff: StaffUser, grants: list[RoleGrant]) -> tuple[ProfileBranch, ...]:
    rows = session.execute(
        select(StaffRosterProfile, Branch)
        .join(Branch, Branch.id == StaffRosterProfile.branch_id)
        .where(StaffRosterProfile.staff_user_id == staff.id, StaffRosterProfile.is_active.is_(True))
        .order_by(Branch.name, StaffRosterProfile.id)
    ).all()
    return tuple(
        ProfileBranch(profile_id=profile.id, branch_id=branch.id, branch_name=branch.name)
        for profile, branch in rows
        if branch.is_active and _permits(staff, branch, grants, Permission.MEMBER_OPERATIONAL_READ, branch.id)
    )


def _lock_staff_users(session: Session, staff_ids: set[UUID]) -> dict[UUID, StaffUser]:
    """Lock every involved principal in canonical UUID order before dependent rows."""
    staff = {}
    for staff_id in sorted(staff_ids, key=lambda value: value.hex):
        row = session.scalar(select(StaffUser).where(StaffUser.id == staff_id)
                             .execution_options(populate_existing=True).with_for_update())
        if row is not None:
            staff[staff_id] = row
    return staff


def _lock_admin_actor(session: Session, admin_id: UUID, *, actor: StaffUser | None = None,
                      grants: list[RoleGrant] | None = None) -> tuple[StaffUser, list[RoleGrant]]:
    actor = actor or _lock_staff_users(session, {admin_id}).get(admin_id)
    credential = session.scalar(select(AdminPasswordCredential).where(
        AdminPasswordCredential.staff_id == admin_id,
    ).execution_options(populate_existing=True).with_for_update())
    grants = grants if grants is not None else _active_grants(session, admin_id)
    current_admin = any(g.is_active and g.role == "admin" and g.scope_kind == "organization" and g.branch_id is None
                        for g in grants)
    if actor is None or not actor.is_active or credential is None or not current_admin:
        raise AuthorizationDenied("Authorization denied")
    return actor, grants


def _lock_live_admin_device(session: Session, admin_id: UUID, admin_session_id: UUID, now: datetime,
                            *, require_computer: bool = False) -> tuple[StaffSession, AdminTrustedDevice]:
    admin_session = session.scalar(select(StaffSession).where(
        StaffSession.id == admin_session_id, StaffSession.staff_id == admin_id,
    ).execution_options(populate_existing=True).with_for_update())
    device = session.scalar(select(AdminTrustedDevice).where(
        AdminTrustedDevice.id == (admin_session.admin_trusted_device_id if admin_session else None),
        AdminTrustedDevice.staff_id == admin_id,
    ).execution_options(populate_existing=True).with_for_update())
    if (admin_session is None
            or admin_session.scope_kind != "organization" or admin_session.auth_method != "admin_password"
            or admin_session.revoked_at is not None or admin_session.absolute_expires_at is None
            or admin_session.last_seen_at is None or now >= _utc(admin_session.absolute_expires_at)
            or now - _utc(admin_session.last_seen_at) >= timedelta(seconds=ADMIN_IDLE_SECONDS)
            or device is None or device.revoked_at is not None
            or (require_computer and device.category != "computer")
            or admin_session.admin_category != device.category):
        raise AuthorizationDenied("Authorization denied")
    admin_session.last_seen_at = now
    device.last_used_at = now
    return admin_session, device


def _lock_live_admin(session: Session, admin_id: UUID, admin_session_id: UUID, now: datetime,
                     *, require_computer: bool = False) -> tuple[StaffUser, StaffSession, AdminTrustedDevice, list[RoleGrant]]:
    actor, grants = _lock_admin_actor(session, admin_id)
    admin_session, device = _lock_live_admin_device(
        session, admin_id, admin_session_id, now, require_computer=require_computer,
    )
    return actor, admin_session, device, grants


def admin_profile_choices(session_factory: sessionmaker[Session], admin_id: UUID, admin_session_id: UUID,
                          *, clock=lambda: datetime.now(timezone.utc)) -> tuple[ProfileIdentity | UnlinkedProfileIdentity, ...]:
    now = _utc(clock())
    with session_factory.begin() as session:
        actor, _auth_session, _device, _grants = _lock_live_admin(session, admin_id, admin_session_id, now)
        own = ProfileIdentity(
            staff_id=actor.id, kind="admin", display_name=actor.login_identifier,
            login_identifier=actor.login_identifier, branches=(), is_owner=is_owner(session, actor.id),
            can_manage_employees=has_organization_permission(session, actor.id, Permission.STAFF_EMPLOYEE_MANAGE),
        )
        staff_rows = session.scalars(select(StaffUser).where(StaffUser.is_active.is_(True))
                                     .order_by(StaffUser.login_identifier)).all()
        identities = [own]
        for staff in staff_rows:
            if staff.id == actor.id:
                continue
            grants = _active_grants(session, staff.id)
            branches = _visible_profiles(session, staff, grants)
            if branches:
                first = session.get(StaffRosterProfile, branches[0].profile_id)
                identities.append(ProfileIdentity(
                    staff_id=staff.id, kind="employee",
                    display_name=first.full_name if first is not None else staff.login_identifier,
                    login_identifier=staff.login_identifier, branches=branches,
                ))
        unlinked_rows = session.execute(
            select(StaffRosterProfile, Branch)
            .join(Branch, Branch.id == StaffRosterProfile.branch_id)
            .where(StaffRosterProfile.staff_user_id.is_(None), StaffRosterProfile.is_active.is_(True),
                   Branch.is_active.is_(True))
            .order_by(Branch.name, StaffRosterProfile.full_name, StaffRosterProfile.id)
        ).all()
        identities.extend(
            UnlinkedProfileIdentity(
                profile_id=profile.id,
                display_name=profile.full_name,
                branch=ProfileBranch(profile_id=profile.id, branch_id=branch.id, branch_name=branch.name),
            )
            for profile, branch in unlinked_rows
        )
        return tuple(identities)


def _proof_device(session: Session, credential_digest: str, now: datetime, *, touch: bool = True,
                  staff: StaffUser | None = None) -> StaffPairedDevice:
    probe = session.scalar(select(StaffPairedDevice.staff_id).where(
        StaffPairedDevice.profile_access_digest == credential_digest,
    ))
    if probe is None:
        raise AuthorizationDenied("Authorization denied")
    staff = staff or session.scalar(select(StaffUser).where(StaffUser.id == probe)
                                    .execution_options(populate_existing=True).with_for_update())
    if staff is None or staff.id != probe:
        raise AuthorizationDenied("Authorization denied")
    _active_grants(session, probe)
    device = session.scalar(select(StaffPairedDevice).where(
        StaffPairedDevice.profile_access_digest == credential_digest,
        StaffPairedDevice.staff_id == probe,
    ).execution_options(populate_existing=True).with_for_update())
    valid = (staff is not None and staff.is_active and device is not None and device.revoked_at is None
             and device.profile_access_digest is not None and device.profile_access_created_at is not None
             and device.profile_access_last_used_at is not None and device.profile_access_expires_at is not None
             and now < _utc(device.profile_access_expires_at)
             and now - _utc(device.profile_access_last_used_at) < PROFILE_ACCESS_IDLE)
    if not valid:
        raise AuthorizationDenied("Authorization denied")
    if touch:
        device.profile_access_last_used_at = now
        device.last_seen_at = now
    return device


def paired_profile_choices(session_factory: sessionmaker[Session], credential: str,
                           *, clock=lambda: datetime.now(timezone.utc)) -> tuple[ProfileIdentity, ...]:
    digest = _token_digest(credential)
    if digest is None:
        raise AuthorizationDenied("Authorization denied")
    now = _utc(clock())
    with session_factory.begin() as session:
        device = _proof_device(session, digest, now)
        staff = session.get(StaffUser, device.staff_id)
        grants = _active_grants(session, device.staff_id)
        branches = _visible_profiles(session, staff, grants)
        if not branches:
            raise AuthorizationDenied("Authorization denied")
        first = session.get(StaffRosterProfile, branches[0].profile_id)
        return (ProfileIdentity(
            staff_id=staff.id, kind="employee",
            display_name=first.full_name if first is not None else staff.login_identifier,
            login_identifier=staff.login_identifier, branches=branches,
        ),)


def bind_profile_access(session_factory: sessionmaker[Session], pairing_code: str,
                        *, clock=lambda: datetime.now(timezone.utc), request_id: UUID | None = None) -> ProfileBinding:
    clean = pairing_code.strip() if isinstance(pairing_code, str) else ""
    if len(clean) != 6 or not clean.isascii() or not clean.isdigit():
        raise AuthorizationDenied("Authorization denied")
    candidate = hashlib.sha256(clean.encode("ascii")).hexdigest()
    probe = None
    with session_factory() as session:
        probe = session.execute(select(StaffDevicePairingCode.id, StaffDevicePairingCode.staff_id).where(
            StaffDevicePairingCode.code_hash == candidate,
            StaffDevicePairingCode.used_at.is_(None), StaffDevicePairingCode.revoked_at.is_(None),
        )).one_or_none()
    if probe is None:
        raise AuthorizationDenied("Authorization denied")
    code_id, staff_id = probe
    now = _utc(clock())
    credential = secrets.token_urlsafe(32)
    proof_digest = hashlib.sha256(credential.encode("ascii")).hexdigest()
    paired_id = None
    expired_code = False
    with session_factory.begin() as session:
        staff = session.scalar(select(StaffUser).where(StaffUser.id == staff_id)
                               .execution_options(populate_existing=True).with_for_update())
        pin_credential = session.scalar(select(StaffCredential).where(
            StaffCredential.staff_id == staff_id, StaffCredential.method == "pin",
        ).execution_options(populate_existing=True).with_for_update())
        grants = _active_grants(session, staff_id)
        code_row = session.scalar(select(StaffDevicePairingCode).where(
            StaffDevicePairingCode.id == code_id, StaffDevicePairingCode.staff_id == staff_id,
        ).execution_options(populate_existing=True).with_for_update())
        if (staff is None or not staff.is_active or pin_credential is None or code_row is None
                or code_row.used_at is not None or code_row.revoked_at is not None
                or not hmac.compare_digest(code_row.code_hash, candidate)):
            raise AuthorizationDenied("Authorization denied")
        if now >= _utc(code_row.expires_at):
            code_row.revoked_at = now
            expired_code = True
        elif code_row.failed_attempts >= 3:
            code_row.revoked_at = now
            expired_code = True
        else:
            if not _visible_profiles(session, staff, grants):
                raise AuthorizationDenied("Authorization denied")

            code_row.used_at = now
            session.execute(update(StaffPairedDevice).where(
                StaffPairedDevice.staff_id == staff_id,
                StaffPairedDevice.revoked_at.is_(None),
            ).values(revoked_at=now, profile_access_digest=None))
            session.execute(update(StaffSession).where(
                StaffSession.staff_id == staff_id,
                StaffSession.scope_kind == "branch", StaffSession.auth_method == "pin",
                StaffSession.revoked_at.is_(None),
                or_(StaffSession.employee_purpose == "phone", StaffSession.employee_purpose.is_(None)),
            ).values(revoked_at=now))
            paired = StaffPairedDevice(
                staff_id=staff_id,
                device_identifier_hash=proof_digest,
                device_name="Browser profile access",
                paired_at=now,
                last_seen_at=now,
                profile_access_digest=proof_digest,
                profile_access_created_at=now,
                profile_access_last_used_at=now,
                profile_access_expires_at=now + EMPLOYEE_ABSOLUTE,
            )
            session.add(paired)
            session.flush()
            paired_id = paired.id
            queue_security_event(session, make_security_event(
                SecurityEventType.DEVICE_PAIRED, employee_id=staff_id, device_id=paired_id,
                initiating_actor_id=staff_id, request_id=request_id, occurred_at=now,
            ))
    if expired_code or paired_id is None:
        raise AuthorizationDenied("Authorization denied")
    return ProfileBinding(paired_id, staff_id, credential)


def logout_profile_access(session_factory: sessionmaker[Session], credential: str,
                          *, clock=lambda: datetime.now(timezone.utc)) -> None:
    digest = _token_digest(credential)
    if digest is None:
        return
    now = _utc(clock())
    with session_factory.begin() as session:
        probe = session.scalar(select(StaffPairedDevice.staff_id).where(
            StaffPairedDevice.profile_access_digest == digest,
        ))
        if probe is None:
            return
        session.scalar(select(StaffUser).where(StaffUser.id == probe)
                       .execution_options(populate_existing=True).with_for_update())
        device = session.scalar(select(StaffPairedDevice).where(
            StaffPairedDevice.staff_id == probe,
            StaffPairedDevice.profile_access_digest == digest,
        ).execution_options(populate_existing=True).with_for_update())
        if device is None:
            return
        device.profile_access_digest = None
        device.profile_access_last_used_at = now
        device.revoked_at = now
        session.execute(update(StaffSession).where(
            StaffSession.staff_id == probe,
            StaffSession.scope_kind == "branch", StaffSession.auth_method == "pin",
            StaffSession.revoked_at.is_(None),
            or_(StaffSession.employee_purpose == "phone", StaffSession.employee_purpose.is_(None)),
        ).values(revoked_at=now))


def revoke_employee_profile_session(session_factory: sessionmaker[Session], token: str,
                                    *, clock=lambda: datetime.now(timezone.utc)) -> bool:
    """Revoke only the employee session represented by a presented opaque token."""
    digest = _token_digest(token)
    if digest is None:
        raise AuthorizationDenied("Authorization denied")
    now = _utc(clock())
    with session_factory.begin() as session:
        row = session.scalar(select(StaffSession).where(
            StaffSession.token_digest == digest,
        ).execution_options(populate_existing=True).with_for_update())
        if (row is None or row.scope_kind != "branch" or row.auth_method != "pin"
                or row.employee_purpose not in {"phone", "reception"}):
            raise AuthorizationDenied("Authorization denied")
        if row.revoked_at is not None:
            return False
        row.revoked_at = now
        queue_security_event(session, make_security_event(
            SecurityEventType.STAFF_SESSION_REVOKED,
            employee_id=row.staff_id,
            device_id=row.reception_station_id,
            initiating_actor_id=row.staff_id,
            occurred_at=now,
        ))
        return True




def issue_profile_session(session_factory: sessionmaker[Session], profile_id: UUID, branch_id: UUID, pin: str,
                          *, paired_credential: str | None = None, admin_id: UUID | None = None,
                          admin_session_id: UUID | None = None, clock=lambda: datetime.now(timezone.utc),
                          request_id: UUID | None = None) -> ProfileEntrySession | ProfilePinSetupRequired:
    if (paired_credential is None) == (admin_id is None or admin_session_id is None):
        raise AuthorizationDenied("Authorization denied")
    with session_factory() as session:
        probe = session.execute(select(StaffRosterProfile.staff_user_id, StaffUser.login_identifier)
                               .join(StaffUser, StaffUser.id == StaffRosterProfile.staff_user_id)
                               .where(StaffRosterProfile.id == profile_id,
                                      StaffRosterProfile.branch_id == branch_id)).one_or_none()
    if probe is None or probe[0] is None:
        raise AuthorizationDenied("Authorization denied")
    target_id, login_identifier = probe
    authentication = authenticate_pin(session_factory, login_identifier, pin, clock=clock)
    if authentication.status is not AuthenticationStatus.AUTHENTICATED or authentication.staff_id != target_id:
        raise AuthorizationDenied("Authorization denied")

    now = _utc(clock())
    paired_digest = _token_digest(paired_credential) if paired_credential is not None else None
    with session_factory.begin() as session:
        if admin_id is not None and admin_id == target_id:
            raise AuthorizationDenied("Authorization denied")

        principal_ids = {target_id}
        if admin_id is not None:
            principal_ids.add(admin_id)
        principals = _lock_staff_users(session, principal_ids)
        grants_by_staff = {
            staff_id: _active_grants(session, staff_id)
            for staff_id in sorted(principal_ids, key=lambda value: value.hex)
        }
        staff = principals.get(target_id)
        if admin_id is not None:
            actor, _admin_grants = _lock_admin_actor(
                session, admin_id, actor=principals.get(admin_id), grants=grants_by_staff[admin_id],
            )
            source_session_probe = session.get(StaffSession, admin_session_id)
            source_device_probe = session.get(AdminTrustedDevice, source_session_probe.admin_trusted_device_id) if source_session_probe else None
            source_device = source_device_probe
        else:
            actor = None
            source_device = None
        if paired_credential is not None:
            if paired_digest is None:
                raise AuthorizationDenied("Authorization denied")
            paired_device = _proof_device(session, paired_digest, now, staff=staff)
            if paired_device.staff_id != target_id:
                raise AuthorizationDenied("Authorization denied")
        else:
            paired_device = None

        credential = session.scalar(select(StaffCredential).where(
            StaffCredential.staff_id == target_id, StaffCredential.method == "pin",
        ).execution_options(populate_existing=True).with_for_update())
        grants = grants_by_staff[target_id]
        branch = session.scalar(select(Branch).where(Branch.id == branch_id)
                                .execution_options(populate_existing=True).with_for_update())
        profile = session.scalar(select(StaffRosterProfile).where(
            StaffRosterProfile.id == profile_id, StaffRosterProfile.branch_id == branch_id,
        ).execution_options(populate_existing=True).with_for_update())
        if (staff is None or not staff.is_active or credential is None
                or (credential.locked_until is not None and now < _utc(credential.locked_until))
                or not verify_pin(pin, credential.secret_hash) or branch is None or not branch.is_active
                or profile is None or not profile.is_active or profile.staff_user_id != target_id
                or not _permits(staff, branch, grants, Permission.MEMBER_OPERATIONAL_READ, branch_id)):
            raise AuthorizationDenied("Authorization denied")

        if credential.pin_change_required:
            if (credential.initial_pin_expires_at is None
                    or now >= _utc(credential.initial_pin_expires_at)):
                raise AuthorizationDenied("Authorization denied")
            if paired_device is None:
                _lock_live_admin(session, admin_id, admin_session_id, now)
            return ProfilePinSetupRequired(target_id, profile_id, branch_id)

        raw_token = secrets.token_urlsafe(32)
        session_digest = hashlib.sha256(raw_token.encode("ascii")).hexdigest()

        if paired_device is not None:
            purpose = "phone"
            station = None
        elif source_device is not None and source_device.category == "computer":
            purpose = "reception"
            station = session.scalar(select(ReceptionStation).where(
                ReceptionStation.source_admin_device_id == source_device.id,
                ReceptionStation.branch_id == branch_id,
                ReceptionStation.revoked_at.is_(None),
            ).order_by(ReceptionStation.created_at.desc())
             .execution_options(populate_existing=True).with_for_update())
            if station is not None and now >= _utc(station.expires_at):
                station.revoked_at = now
                station = None
            if station is None:
                station_secret = secrets.token_urlsafe(32)
                station = ReceptionStation(
                    branch_id=branch_id, created_by=admin_id,
                    source_admin_device_id=source_device.id,
                    credential_digest=hashlib.sha256(station_secret.encode("ascii")).hexdigest(),
                    created_at=now, expires_at=now + EMPLOYEE_ABSOLUTE,
                )
                session.add(station)
                session.flush()
        elif source_device is not None and source_device.category == "phone":
            purpose = "phone"
            station = None
        else:
            raise AuthorizationDenied("Authorization denied")

        if admin_id is not None and admin_session_id is not None:
            _actor, _admin_session, source_device, _admin_grants = _lock_live_admin(
                session, admin_id, admin_session_id, now,
                require_computer=(purpose == "reception"),
            )
            if (source_device.category == "computer") != (purpose == "reception"):
                raise AuthorizationDenied("Authorization denied")

        expiry = min(now + EMPLOYEE_ABSOLUTE, _utc(station.expires_at)) if station is not None else now + EMPLOYEE_ABSOLUTE
        session.add(StaffSession(
            staff_id=target_id, branch_id=branch_id, token_digest=session_digest,
            issued_at=now, expires_at=expiry, absolute_expires_at=expiry,
            last_seen_at=now, employee_purpose=purpose,
            reception_station_id=station.id if station is not None else None,
        ))
        if paired_device is not None:
            paired_device.profile_access_last_used_at = now
        queue_security_event(session, make_security_event(
            SecurityEventType.STAFF_SESSION_ISSUED, employee_id=target_id,
            device_id=station.id if station is not None else (paired_device.id if paired_device is not None else source_device.id),
            initiating_actor_id=admin_id or target_id, request_id=request_id, occurred_at=now,
        ))
    return ProfileEntrySession(target_id, branch_id, profile_id, raw_token, expiry, purpose)
