from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
import hashlib
import secrets
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from app.auth.authorization import AuthorizationDenied
from app.auth.passwords import burn_password_verification, verify_admin_password
from app.db.models import AdminAuthEvent, AdminPasswordCredential, RoleGrant, StaffSession, StaffUser


@dataclass(frozen=True, slots=True)
class AdminSessionToken:
    staff_id: UUID
    session_id: UUID
    token: str = field(repr=False)
    expires_at: datetime


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def authenticate_admin(session_factory: sessionmaker[Session], login_identifier: str, password: str,
                       ttl_seconds: int, request_id: UUID, *, lockout_attempts: int = 5,
                       lockout_seconds: int = 300, clock=utc_now) -> AdminSessionToken | None:
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode("ascii")).hexdigest()
    result = None
    with session_factory.begin() as session:
        staff = session.scalar(select(StaffUser).where(StaffUser.login_identifier == login_identifier)
                               .execution_options(populate_existing=True).with_for_update())
        credential = session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == staff.id)
                                    .execution_options(populate_existing=True).with_for_update()) if staff else None
        grants = session.scalars(select(RoleGrant).where(RoleGrant.staff_id == staff.id)
                                 .execution_options(populate_existing=True).with_for_update()).all() if staff else []
        hash_valid = verify_admin_password(password, credential.password_hash) if credential else False
        if credential is None:
            burn_password_verification(password)
        now = clock().astimezone(timezone.utc)
        locked = credential is not None and credential.locked_until is not None and now < _utc(credential.locked_until)
        permitted = staff is not None and staff.is_active and any(
            grant.is_active and grant.role == "admin" and grant.scope_kind == "organization" and grant.branch_id is None
            for grant in grants
        )
        if credential is not None and credential.locked_until is not None and now >= _utc(credential.locked_until):
            credential.failed_attempts = 0
            credential.locked_until = None
        if credential is not None and not locked and (not permitted or not hash_valid):
            credential.failed_attempts = min(credential.failed_attempts + 1, lockout_attempts)
            if credential.failed_attempts >= lockout_attempts:
                credential.failed_attempts = lockout_attempts
                credential.locked_until = now + timedelta(seconds=lockout_seconds)
        elif credential is not None and locked:
            pass
        elif credential is not None and permitted and hash_valid:
            credential.failed_attempts = 0
            credential.locked_until = None
            expires_at = now + timedelta(seconds=ttl_seconds)
            row = StaffSession(staff_id=staff.id, branch_id=None, scope_kind="organization",
                               auth_method="admin_password", token_digest=digest, issued_at=now, expires_at=expires_at)
            session.add(row)
            session.flush()
            session.add(AdminAuthEvent(actor_id=staff.id, subject_staff_id=staff.id,
                                       action="admin_password_login_succeeded", request_id=request_id, occurred_at=now))
            result = AdminSessionToken(staff.id, row.id, token, expires_at)
    return result


def validate_admin_session(session_factory: sessionmaker[Session], token: str, *, clock=utc_now):
    if not isinstance(token, str) or len(token) != 43 or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-" for c in token):
        raise AuthorizationDenied("Authorization denied")
    digest = hashlib.sha256(token.encode("ascii")).hexdigest()
    with session_factory.begin() as session:
        initial = session.scalar(select(StaffSession).where(StaffSession.token_digest == digest))
        if initial is None:
            raise AuthorizationDenied("Authorization denied")
        staff = session.scalar(select(StaffUser).where(StaffUser.id == initial.staff_id)
                               .execution_options(populate_existing=True).with_for_update())
        grants = session.scalars(select(RoleGrant).where(RoleGrant.staff_id == initial.staff_id)
                                 .execution_options(populate_existing=True).with_for_update()).all()
        row = session.scalar(select(StaffSession).where(StaffSession.id == initial.id)
                             .execution_options(populate_existing=True).with_for_update())
        if row is None or row.scope_kind != "organization" or row.auth_method != "admin_password" or row.revoked_at is not None:
            raise AuthorizationDenied("Authorization denied")
        now = clock().astimezone(timezone.utc)
        if staff is None or not staff.is_active or now >= _utc(row.expires_at) or not any(
            grant.is_active and grant.role == "admin" and grant.scope_kind == "organization" and grant.branch_id is None
            for grant in grants
        ):
            raise AuthorizationDenied("Authorization denied")
        return row.staff_id, row.id


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
