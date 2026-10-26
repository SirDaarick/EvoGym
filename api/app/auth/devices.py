"""Staff device pairing code issuance, verification, binding, and device management."""
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
import hashlib
import hmac
import secrets
from uuid import UUID, uuid4

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.auth.admin import _utc, utc_now
from app.auth.authorization import AuthorizationDenied
from app.auth.authorization import Permission
from app.auth.owner import require_organization_permission
from app.db.models import AdminAuthEvent, RoleGrant, StaffDevicePairingCode, StaffPairedDevice, StaffSession, StaffUser
from app.observability.security import SecurityEventType, make_security_event, queue_security_event


class DevicePairingDenied(Exception):
    """Raised when device pairing fails due to invalid code, lockout, or expired state."""

    pass


@dataclass(frozen=True, slots=True)
class IssuedPairingCode:
    """Pairing code returned to Admin upon generation."""

    id: UUID
    staff_id: UUID
    raw_code: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class PairedDeviceRecord:
    """Safe metadata representation of a paired staff mobile device."""

    id: UUID
    staff_id: UUID
    staff_login: str
    device_name: str
    paired_at: datetime
    last_seen_at: datetime
    revoked: bool
    revoked_at: datetime | None


def _require_admin(session: Session, admin_id: UUID) -> None:
    admin = session.scalar(
        select(StaffUser)
        .where(StaffUser.id == admin_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if admin is None or not admin.is_active:
        raise AuthorizationDenied("Authorization denied")
    grants = session.scalars(
        select(RoleGrant)
        .where(RoleGrant.staff_id == admin_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).all()
    if not any(g.is_active and g.role == "admin" and g.scope_kind == "organization" and g.branch_id is None for g in grants):
        raise AuthorizationDenied("Authorization denied")
    require_organization_permission(session, admin_id, Permission.STAFF_EMPLOYEE_MANAGE)


def issue_device_pairing_code(
    session_factory: sessionmaker[Session],
    admin_id: UUID,
    staff_id: UUID,
    ttl_seconds: int = 900,
    *,
    clock=utc_now,
    request_id: UUID | None = None,
) -> IssuedPairingCode:
    """Generate and store a 6-digit numeric pairing code for mobile hardware binding."""
    if ttl_seconds <= 0:
        raise ValueError("ttl_seconds must be positive.")

    now = clock().astimezone(timezone.utc)
    expires_at = now + timedelta(seconds=ttl_seconds)

    with session_factory.begin() as session:
        _require_admin(session, admin_id)

        target_staff = session.scalar(
            select(StaffUser).where(StaffUser.id == staff_id).with_for_update()
        )
        if target_staff is None or not target_staff.is_active:
            raise ValueError("Target staff user does not exist or is inactive.")

        # Revoke any prior unexpired pairing codes for this staff member
        session.execute(
            update(StaffDevicePairingCode)
            .where(
                StaffDevicePairingCode.staff_id == staff_id,
                StaffDevicePairingCode.used_at.is_(None),
                StaffDevicePairingCode.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        # Expired six-digit values no longer reserve a scarce code-space slot.
        session.execute(update(StaffDevicePairingCode).where(
            StaffDevicePairingCode.used_at.is_(None),
            StaffDevicePairingCode.revoked_at.is_(None),
            StaffDevicePairingCode.expires_at <= now,
        ).values(revoked_at=now))

        pairing_record = None
        raw_code = ""
        for _attempt in range(12):
            raw_code = f"{secrets.randbelow(1_000_000):06d}"
            code_hash = hashlib.sha256(raw_code.encode("ascii")).hexdigest()
            try:
                # The partial unique index resolves concurrent allocations across
                # staff accounts; savepoints keep a collision retry in this unit.
                with session.begin_nested():
                    pairing_record = StaffDevicePairingCode(
                        staff_id=staff_id,
                        code_hash=code_hash,
                        created_by=admin_id,
                        created_at=now,
                        expires_at=expires_at,
                        failed_attempts=0,
                    )
                    session.add(pairing_record)
                    session.flush()
                break
            except IntegrityError:
                collision = session.scalar(select(StaffDevicePairingCode.id).where(
                    StaffDevicePairingCode.code_hash == code_hash,
                    StaffDevicePairingCode.used_at.is_(None),
                    StaffDevicePairingCode.revoked_at.is_(None),
                ))
                if collision is None:
                    raise
                pairing_record = None
        if pairing_record is None:
            raise ValueError("A unique pairing code could not be issued.")

        session.add(
            AdminAuthEvent(
                actor_id=admin_id,
                subject_staff_id=staff_id,
                action="device_pairing_code_issued",
                request_id=request_id or uuid4(),
                occurred_at=now,
            )
        )

        return IssuedPairingCode(
            id=pairing_record.id,
            staff_id=staff_id,
            raw_code=raw_code,
            expires_at=expires_at,
        )


def pair_device(
    session_factory: sessionmaker[Session],
    login_identifier: str,
    pairing_code_str: str,
    device_identifier_str: str,
    device_name: str,
    *,
    clock=utc_now,
    request_id: UUID | None = None,
) -> UUID:
    """Bind a staff phone via 6-digit pairing code, enforcing the 1-device limit."""
    normalized_login = login_identifier.strip().casefold()
    clean_code = pairing_code_str.strip()
    clean_device_id = device_identifier_str.strip()
    clean_device_name = device_name.strip()

    if not normalized_login or not clean_code or not clean_device_id or not clean_device_name:
        raise DevicePairingDenied("Missing required pairing fields.")

    if len(clean_code) != 6 or not clean_code.isdigit():
        raise DevicePairingDenied("Invalid pairing code format.")

    now = clock().astimezone(timezone.utc)
    candidate_hash = hashlib.sha256(clean_code.encode("ascii")).hexdigest()
    device_id_hash = hashlib.sha256(clean_device_id.encode("utf-8")).hexdigest()

    denial_reason = None
    paired_device_id = None

    with session_factory.begin() as session:
        staff = session.scalar(
            select(StaffUser)
            .where(StaffUser.login_identifier == normalized_login)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if staff is None or not staff.is_active:
            denial_reason = "Invalid or expired pairing code."
        else:
            code_row = session.scalar(
                select(StaffDevicePairingCode)
                .where(
                    StaffDevicePairingCode.staff_id == staff.id,
                    StaffDevicePairingCode.used_at.is_(None),
                    StaffDevicePairingCode.revoked_at.is_(None),
                )
                .order_by(StaffDevicePairingCode.created_at.desc())
                .execution_options(populate_existing=True)
                .with_for_update()
            )
            if code_row is None:
                denial_reason = "Invalid or expired pairing code."
            elif now >= _utc(code_row.expires_at):
                code_row.revoked_at = now
                denial_reason = "Invalid or expired pairing code."
            elif code_row.failed_attempts >= 3:
                code_row.revoked_at = now
                denial_reason = "Pairing code locked due to too many failed attempts."
            elif not hmac.compare_digest(candidate_hash, code_row.code_hash):
                code_row.failed_attempts += 1
                if code_row.failed_attempts >= 3:
                    code_row.revoked_at = now
                denial_reason = "Invalid or expired pairing code."
            else:
                # Pairing code validated successfully
                code_row.used_at = now

                # Enforce 1 active paired device per staff by revoking any currently active device
                session.execute(
                    update(StaffPairedDevice)
                    .where(
                        StaffPairedDevice.staff_id == staff.id,
                        StaffPairedDevice.revoked_at.is_(None),
                    )
                    .values(revoked_at=now)
                )
                # Pairing and phone-session issuance both serialize on the staff row.
                # Legacy branch PIN sessions with no purpose are phone sessions too.
                session.execute(
                    update(StaffSession)
                    .where(
                        StaffSession.staff_id == staff.id,
                        StaffSession.scope_kind == "branch",
                        StaffSession.auth_method == "pin",
                        StaffSession.revoked_at.is_(None),
                        or_(StaffSession.employee_purpose == "phone", StaffSession.employee_purpose.is_(None)),
                    )
                    .values(revoked_at=now)
                )

                paired_device = StaffPairedDevice(
                    staff_id=staff.id,
                    device_identifier_hash=device_id_hash,
                    device_name=clean_device_name,
                    paired_at=now,
                    last_seen_at=now,
                )
                session.add(paired_device)
                session.flush()

                session.add(
                    AdminAuthEvent(
                        actor_id=staff.id,
                        subject_staff_id=staff.id,
                        action="device_paired",
                        request_id=request_id or uuid4(),
                        occurred_at=now,
                    )
                )
                paired_device_id = paired_device.id
                queue_security_event(session, make_security_event(
                    SecurityEventType.DEVICE_PAIRED,
                    employee_id=staff.id,
                    device_id=paired_device.id,
                    initiating_actor_id=staff.id,
                    request_id=request_id,
                    occurred_at=now,
                ))

    if denial_reason is not None:
        raise DevicePairingDenied(denial_reason)

    return paired_device_id


def list_paired_devices(
    session_factory: sessionmaker[Session],
    admin_id: UUID,
) -> list[PairedDeviceRecord]:
    """List all paired devices for administrative inspection."""
    with session_factory.begin() as session:
        _require_admin(session, admin_id)

        rows = session.execute(
            select(StaffPairedDevice, StaffUser.login_identifier)
            .join(StaffUser, StaffPairedDevice.staff_id == StaffUser.id)
            .order_by(StaffPairedDevice.paired_at.desc())
        ).all()

        records = []
        for dev, login in rows:
            records.append(
                PairedDeviceRecord(
                    id=dev.id,
                    staff_id=dev.staff_id,
                    staff_login=login,
                    device_name=dev.device_name,
                    paired_at=_utc(dev.paired_at),
                    last_seen_at=_utc(dev.last_seen_at),
                    revoked=dev.revoked_at is not None,
                    revoked_at=_utc(dev.revoked_at) if dev.revoked_at else None,
                )
            )
        return records


def revoke_paired_device(
    session_factory: sessionmaker[Session],
    admin_id: UUID,
    device_id: UUID,
    *,
    clock=utc_now,
    request_id: UUID | None = None,
) -> bool:
    """Revoke a staff paired device idempotently."""
    now = clock().astimezone(timezone.utc)
    with session_factory.begin() as session:
        _require_admin(session, admin_id)

        reference = session.execute(
            select(StaffPairedDevice.id, StaffPairedDevice.staff_id)
            .where(StaffPairedDevice.id == device_id)
        ).one_or_none()
        if reference is None:
            return False

        # Match issuance/deactivation lock order: lock the employee before their
        # device, sessions, and outstanding pairing codes.
        session.scalar(
            select(StaffUser)
            .where(StaffUser.id == reference.staff_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        dev = session.scalar(
            select(StaffPairedDevice)
            .where(StaffPairedDevice.id == reference.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if dev is None:
            return False

        if dev.revoked_at is None:
            dev.revoked_at = now
            session.execute(
                update(StaffSession)
                .where(
                    StaffSession.staff_id == dev.staff_id,
                    StaffSession.scope_kind == "branch",
                    StaffSession.auth_method == "pin",
                    StaffSession.revoked_at.is_(None),
                    or_(StaffSession.employee_purpose == "phone", StaffSession.employee_purpose.is_(None)),
                )
                .values(revoked_at=now)
            )
            session.execute(
                update(StaffDevicePairingCode)
                .where(
                    StaffDevicePairingCode.staff_id == dev.staff_id,
                    StaffDevicePairingCode.used_at.is_(None),
                    StaffDevicePairingCode.revoked_at.is_(None),
                )
                .values(revoked_at=now)
            )
            session.add(
                AdminAuthEvent(
                    actor_id=admin_id,
                    subject_staff_id=dev.staff_id,
                    action="device_revoked",
                    request_id=request_id or uuid4(),
                    occurred_at=now,
                )
            )
            queue_security_event(session, make_security_event(
                SecurityEventType.DEVICE_REVOKED,
                employee_id=dev.staff_id,
                device_id=dev.id,
                initiating_actor_id=admin_id,
                request_id=request_id,
                occurred_at=now,
            ))
        return True
