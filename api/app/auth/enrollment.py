"""Staff enrollment code issuance, listing, and revocation logic."""
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
import hashlib
import secrets
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from app.auth.admin import _utc, utc_now
from app.auth.authorization import AuthorizationDenied
from app.auth.owner import require_owner_or_legacy_admin
from app.db.models import AdminAuthEvent, Branch, RoleGrant, StaffEnrollmentCode, StaffUser


@dataclass(frozen=True, slots=True)
class IssuedEnrollmentCode:
    """Raw enrollment code returned once at issuance time."""

    id: UUID
    raw_code: str
    login_identifier: str
    role: str
    branch_id: UUID | None
    created_at: datetime
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class EnrollmentCodeRecord:
    """Safe metadata representation of an enrollment code without secret material."""

    id: UUID
    login_identifier: str
    role: str
    branch_id: UUID | None
    created_by: UUID
    created_at: datetime
    expires_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None
    status: str  # 'pending', 'used', 'revoked', 'expired'


def _require_admin(session: Session, admin_id: UUID) -> None:
    require_owner_or_legacy_admin(session, admin_id)


def issue_enrollment_code(
    session_factory: sessionmaker[Session],
    admin_id: UUID,
    login_identifier: str,
    role: str,
    branch_id: UUID | None = None,
    ttl_seconds: int = 86400,
    *,
    clock=utc_now,
    request_id: UUID | None = None,
) -> IssuedEnrollmentCode:
    """Issue a single-use random cryptographic enrollment token for onboarding staff."""
    normalized_login = login_identifier.strip().casefold()
    if not normalized_login:
        raise ValueError("Login identifier cannot be empty.")
    if role not in ("admin", "receptionist"):
        raise ValueError(f"Invalid role: {role}")
    if role == "receptionist" and branch_id is None:
        raise ValueError("branch_id is required for receptionist enrollment codes.")
    if role == "admin" and branch_id is not None:
        branch_id = None
    if ttl_seconds <= 0:
        raise ValueError("ttl_seconds must be positive.")

    raw_code = secrets.token_urlsafe(32)
    code_hash = hashlib.sha256(raw_code.encode("ascii")).hexdigest()
    now = clock().astimezone(timezone.utc)
    expires_at = now + timedelta(seconds=ttl_seconds)

    with session_factory.begin() as session:
        _require_admin(session, admin_id)

        if branch_id is not None:
            branch = session.scalar(select(Branch).where(Branch.id == branch_id))
            if branch is None:
                raise ValueError("The specified branch does not exist.")

        existing_user = session.scalar(
            select(StaffUser).where(StaffUser.login_identifier == normalized_login)
        )
        if existing_user is not None:
            raise ValueError("A staff user with this identifier is already registered.")

        # Revoke any prior pending unexpired enrollment codes for this login identifier
        session.execute(
            update(StaffEnrollmentCode)
            .where(
                StaffEnrollmentCode.login_identifier == normalized_login,
                StaffEnrollmentCode.used_at.is_(None),
                StaffEnrollmentCode.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )

        enrollment = StaffEnrollmentCode(
            code_hash=code_hash,
            login_identifier=normalized_login,
            role=role,
            branch_id=branch_id,
            created_by=admin_id,
            created_at=now,
            expires_at=expires_at,
        )
        session.add(enrollment)
        session.flush()

        session.add(
            AdminAuthEvent(
                actor_id=admin_id,
                subject_staff_id=admin_id,
                action="enrollment_code_issued",
                request_id=request_id or uuid4(),
                occurred_at=now,
            )
        )

        return IssuedEnrollmentCode(
            id=enrollment.id,
            raw_code=raw_code,
            login_identifier=enrollment.login_identifier,
            role=enrollment.role,
            branch_id=enrollment.branch_id,
            created_at=now,
            expires_at=expires_at,
        )


def list_enrollment_codes(
    session_factory: sessionmaker[Session],
    admin_id: UUID,
    *,
    clock=utc_now,
) -> list[EnrollmentCodeRecord]:
    """List all enrollment codes with status; raw codes and digests are never returned."""
    now = clock().astimezone(timezone.utc)
    with session_factory.begin() as session:
        _require_admin(session, admin_id)

        codes = session.scalars(
            select(StaffEnrollmentCode).order_by(StaffEnrollmentCode.created_at.desc())
        ).all()

        records = []
        for c in codes:
            if c.revoked_at is not None:
                status = "revoked"
            elif c.used_at is not None:
                status = "used"
            elif now >= _utc(c.expires_at):
                status = "expired"
            else:
                status = "pending"

            records.append(
                EnrollmentCodeRecord(
                    id=c.id,
                    login_identifier=c.login_identifier,
                    role=c.role,
                    branch_id=c.branch_id,
                    created_by=c.created_by,
                    created_at=_utc(c.created_at),
                    expires_at=_utc(c.expires_at),
                    used_at=_utc(c.used_at) if c.used_at else None,
                    revoked_at=_utc(c.revoked_at) if c.revoked_at else None,
                    status=status,
                )
            )
        return records


def revoke_enrollment_code(
    session_factory: sessionmaker[Session],
    admin_id: UUID,
    code_id: UUID,
    *,
    clock=utc_now,
    request_id: UUID | None = None,
) -> bool:
    """Revoke an enrollment code idempotently; logs audit event on first revocation."""
    now = clock().astimezone(timezone.utc)
    with session_factory.begin() as session:
        _require_admin(session, admin_id)

        code_row = session.scalar(
            select(StaffEnrollmentCode)
            .where(StaffEnrollmentCode.id == code_id)
            .with_for_update()
        )
        if code_row is None:
            return False

        if code_row.revoked_at is None:
            code_row.revoked_at = now
            session.add(
                AdminAuthEvent(
                    actor_id=admin_id,
                    subject_staff_id=admin_id,
                    action="enrollment_code_revoked",
                    request_id=request_id or uuid4(),
                    occurred_at=now,
                )
            )
        return True
