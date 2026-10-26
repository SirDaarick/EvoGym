from datetime import timedelta, timezone
import hashlib
import secrets
from urllib.parse import urlencode, urlsplit, urlunsplit

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from app.auth.admin import _utc, utc_now
from app.auth.passwords import hash_admin_password
from app.db.models import AdminAuthEvent, AdminLoginApproval, AdminPasswordCredential, AdminRecoveryToken, AdminTrustedDevice, RoleGrant, StaffSession, StaffUser


class RecoveryUnavailable(Exception):
    pass


def start_recovery(session_factory: sessionmaker[Session], login: str, ttl: int, base_url: str, delivery, *, clock=utc_now) -> None:
    raw = secrets.token_urlsafe(32)
    digest = hashlib.sha256(raw.encode("ascii")).hexdigest()
    email = None
    row_id = None
    now = clock().astimezone(timezone.utc)
    with session_factory.begin() as session:
        staff = session.scalar(select(StaffUser).where(StaffUser.login_identifier == login)
                               .execution_options(populate_existing=True).with_for_update())
        credential = session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == staff.id)
                                    .execution_options(populate_existing=True).with_for_update()) if staff else None
        grants = session.scalars(select(RoleGrant).where(RoleGrant.staff_id == staff.id)
                                 .execution_options(populate_existing=True).with_for_update()).all() if staff else []
        eligible = staff is not None and staff.is_active and credential is not None and credential.recovery_email_verified_at is not None and any(
            grant.is_active and grant.role == "admin" and grant.scope_kind == "organization" and grant.branch_id is None for grant in grants
        )
        if eligible:
            session.execute(update(AdminRecoveryToken).where(AdminRecoveryToken.staff_id == staff.id,
                AdminRecoveryToken.used_at.is_(None), AdminRecoveryToken.revoked_at.is_(None)).values(revoked_at=now))
            email = credential.recovery_email
            token_row = AdminRecoveryToken(staff_id=staff.id, token_digest=digest,
                email_digest=hashlib.sha256(email.casefold().encode("utf-8")).hexdigest(),
                created_at=now, expires_at=now + timedelta(seconds=ttl), delivery_status="pending")
            session.add(token_row)
            session.flush()
            row_id = token_row.id
    if email is None:
        return
    parts = urlsplit(base_url)
    link = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode({"token": raw}), ""))
    try:
        delivery.enqueue_recovery_link(email, link)
    except Exception:
        with session_factory.begin() as session:
            session.execute(update(AdminRecoveryToken).where(AdminRecoveryToken.id == row_id).values(delivery_status="failed", revoked_at=clock()))
        return
    with session_factory.begin() as session:
        token_row = session.scalar(select(AdminRecoveryToken).where(AdminRecoveryToken.id == row_id).with_for_update())
        if token_row is not None and token_row.revoked_at is None:
            token_row.delivery_status = "sent"
            token_row.delivered_at = clock().astimezone(timezone.utc)


def complete_recovery(session_factory: sessionmaker[Session], raw: str, new_password: str, request_id, *, clock=utc_now) -> bool:
    if not isinstance(raw, str) or len(raw) != 43 or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-" for c in raw):
        return False
    new_hash = hash_admin_password(new_password)
    digest = hashlib.sha256(raw.encode("ascii")).hexdigest()
    changed = False
    with session_factory.begin() as session:
        initial = session.scalar(select(AdminRecoveryToken).where(AdminRecoveryToken.token_digest == digest))
        if initial is None:
            return False
        staff = session.scalar(select(StaffUser).where(StaffUser.id == initial.staff_id)
                               .execution_options(populate_existing=True).with_for_update())
        credential = session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == initial.staff_id)
                                    .execution_options(populate_existing=True).with_for_update())
        grants = session.scalars(select(RoleGrant).where(RoleGrant.staff_id == initial.staff_id)
                                 .execution_options(populate_existing=True).with_for_update()).all()
        # Match the Admin lifecycle lock order: user, credential, grants,
        # sessions, trusted devices, approvals, then recovery tokens.
        admin_sessions = session.scalars(select(StaffSession).where(
            StaffSession.staff_id == initial.staff_id,
            StaffSession.scope_kind == "organization",
            StaffSession.auth_method == "admin_password",
            StaffSession.revoked_at.is_(None),
        ).order_by(StaffSession.id).with_for_update()).all()
        trusted_devices = session.scalars(select(AdminTrustedDevice).where(
            AdminTrustedDevice.staff_id == initial.staff_id,
            AdminTrustedDevice.revoked_at.is_(None),
        ).order_by(AdminTrustedDevice.id).with_for_update()).all()
        approvals = session.scalars(select(AdminLoginApproval).where(
            AdminLoginApproval.staff_id == initial.staff_id,
            AdminLoginApproval.consumed_at.is_(None),
            AdminLoginApproval.revoked_at.is_(None),
        ).order_by(AdminLoginApproval.id).with_for_update()).all()
        recovery_tokens = session.scalars(select(AdminRecoveryToken).where(
            AdminRecoveryToken.staff_id == initial.staff_id,
            AdminRecoveryToken.used_at.is_(None),
            AdminRecoveryToken.revoked_at.is_(None),
        ).order_by(AdminRecoveryToken.id).with_for_update()).all()
        token = next((row for row in recovery_tokens if row.id == initial.id), None)
        if token is None:
            return False
        now = clock().astimezone(timezone.utc)
        eligible = (staff is not None and staff.is_active and credential is not None and credential.recovery_email_verified_at is not None
            and token.delivery_status == "sent" and token.used_at is None and token.revoked_at is None
            and now < _utc(token.expires_at)
            and token.email_digest == hashlib.sha256(credential.recovery_email.casefold().encode("utf-8")).hexdigest()
            and any(grant.is_active and grant.role == "admin" and grant.scope_kind == "organization" and grant.branch_id is None for grant in grants))
        if not eligible:
            return False
        credential.password_hash = new_hash
        credential.failed_attempts = 0
        credential.locked_until = None
        token.used_at = now
        for recovery_token in recovery_tokens:
            if recovery_token.id != token.id:
                recovery_token.revoked_at = now
        for admin_session in admin_sessions:
            admin_session.revoked_at = now
        for device in trusted_devices:
            device.revoked_at = now
        for approval in approvals:
            approval.revoked_at = now
        session.add(AdminAuthEvent(actor_id=staff.id, subject_staff_id=staff.id, action="admin_password_recovered",
                                   request_id=request_id, occurred_at=now))
        changed = True
    return changed
