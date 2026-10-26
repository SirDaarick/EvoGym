from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
import base64
import hashlib
import hmac
import json
import secrets
from urllib.parse import urlencode, urlsplit, urlunsplit
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from app.auth.authorization import AuthorizationDenied
from app.auth.passwords import burn_password_verification, verify_admin_password
from app.db.models import (
    AdminAuthEvent, AdminLoginApproval, AdminPasswordCredential, AdminTrustedDevice,
    RoleGrant, StaffSession, StaffUser,
)

ADMIN_ACCESS_SECONDS = 15 * 60
ADMIN_IDLE_SECONDS = 30 * 24 * 60 * 60
ADMIN_ABSOLUTE_SECONDS = 90 * 24 * 60 * 60
ADMIN_APPROVAL_SECONDS = 30 * 60
_TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
# Lock mutable Admin state in this order: staff user, password credential,
# role grants, session rows, trusted device rows, then approval/recovery tokens.


@dataclass(frozen=True, slots=True)
class AdminSessionToken:
    staff_id: UUID
    session_id: UUID
    token: str = field(repr=False)
    refresh_token: str = field(repr=False)
    device_cookie: str = field(repr=False)
    category: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class AdminLoginPending:
    approval_id: UUID
    poll_token: str = field(repr=False)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _jwt(claims: dict, signing_secret: str) -> str:
    header = _b64(b'{"alg":"HS256","typ":"JWT"}')
    payload = _b64(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signing_input = f"{header}.{payload}"
    signature = hmac.new(signing_secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{_b64(signature)}"


def _claims(token: str, signing_secret: str, expected_type: str, *, now: datetime | None = None) -> dict | None:
    if not isinstance(token, str) or len(token) > 2048:
        return None
    try:
        header, payload, signature = token.split(".")
        signing_input = f"{header}.{payload}"
        expected = _b64(hmac.new(signing_secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        parsed_header = json.loads(_unb64(header))
        claims = json.loads(_unb64(payload))
        if parsed_header != {"alg": "HS256", "typ": "JWT"} or not isinstance(claims, dict):
            return None
        current = int((now or utc_now()).timestamp())
        if claims.get("typ") != expected_type or not isinstance(claims.get("exp"), int) or current >= claims["exp"]:
            return None
        return claims
    except (ValueError, TypeError, UnicodeError, json.JSONDecodeError):
        return None


def _token_digest(value: str) -> str:
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def _issue_tokens(row: StaffSession, device: AdminTrustedDevice, signing_secret: str, now: datetime) -> AdminSessionToken:
    absolute = now + timedelta(seconds=ADMIN_ABSOLUTE_SECONDS)
    row.issued_at = now
    row.expires_at = absolute
    row.absolute_expires_at = absolute
    row.last_seen_at = now
    row.admin_category = device.category
    row.admin_trusted_device_id = device.id
    row.refresh_generation = 0
    access = _jwt({"exp": int((now + timedelta(seconds=ADMIN_ACCESS_SECONDS)).timestamp()), "sid": str(row.id),
                   "sub": str(row.staff_id), "typ": "access"}, signing_secret)
    refresh = _jwt({"exp": int(absolute.timestamp()), "gen": row.refresh_generation, "sid": str(row.id),
                    "sub": str(row.staff_id), "typ": "refresh"}, signing_secret)
    row.refresh_token_digest = _token_digest(refresh)
    row.token_digest = _token_digest(access)
    return AdminSessionToken(row.staff_id, row.id, access, refresh, "", device.category,
                             now + timedelta(seconds=ADMIN_ACCESS_SECONDS))


def _lock_active_admin_sessions(session: Session, staff_id: UUID, category: str,
                                now: datetime) -> list[StaffSession]:
    return session.scalars(select(StaffSession).where(
        StaffSession.staff_id == staff_id,
        StaffSession.scope_kind == "organization",
        StaffSession.auth_method == "admin_password",
        StaffSession.admin_category == category,
        StaffSession.revoked_at.is_(None),
        StaffSession.expires_at > now,
        StaffSession.absolute_expires_at > now,
        StaffSession.last_seen_at > now - timedelta(seconds=ADMIN_IDLE_SECONDS),
    ).with_for_update()).all()


def _new_session(session: Session, staff_id: UUID, device: AdminTrustedDevice,
                 active_rows: list[StaffSession], signing_secret: str,
                 now: datetime, request_id: UUID) -> tuple[AdminSessionToken, bool]:
    replaced = bool(active_rows)
    for row in active_rows:
        row.revoked_at = now
    row = StaffSession(staff_id=staff_id, branch_id=None, scope_kind="organization", auth_method="admin_password",
                       token_digest="0" * 64, issued_at=now, expires_at=now + timedelta(seconds=ADMIN_ABSOLUTE_SECONDS),
                       admin_category=device.category, admin_trusted_device_id=device.id, last_seen_at=now,
                       absolute_expires_at=now + timedelta(seconds=ADMIN_ABSOLUTE_SECONDS), refresh_generation=0)
    session.add(row)
    session.flush()
    token = _issue_tokens(row, device, signing_secret, now)
    session.add(AdminAuthEvent(actor_id=staff_id, subject_staff_id=staff_id,
        action="admin_session_replaced" if replaced else "admin_password_login_succeeded",
        request_id=request_id, occurred_at=now))
    return token, replaced


def authenticate_admin(session_factory: sessionmaker[Session], login_identifier: str, password: str,
                       ttl_seconds: int, request_id: UUID, *, lockout_attempts: int = 5,
                       lockout_seconds: int = 300, clock=utc_now, category: str = "computer",
                       device_cookie: str | None = None, signing_secret: str | None = None,
                       delivery=None, approval_base_url: str | None = None) -> AdminSessionToken | AdminLoginPending | None:
    if category not in {"computer", "phone"} or signing_secret is None or len(signing_secret) < 32:
        raise ValueError("Admin session policy is unavailable")
    token = secrets.token_urlsafe(32)
    digest = _token_digest(token)
    result = None
    pending_delivery = None
    now = _utc(clock())
    cookie_digest = _token_digest(device_cookie) if isinstance(device_cookie, str) and len(device_cookie) == 43 and all(c in _TOKEN_CHARS for c in device_cookie) else None
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
            active_rows = _lock_active_admin_sessions(session, staff.id, category, now)
            device = session.scalar(select(AdminTrustedDevice).where(
                AdminTrustedDevice.staff_id == staff.id,
                AdminTrustedDevice.category == category,
                AdminTrustedDevice.cookie_digest == (cookie_digest or ""),
                AdminTrustedDevice.revoked_at.is_(None),
            ).with_for_update()) if cookie_digest else None
            if device is not None and now - _utc(device.last_used_at) < timedelta(seconds=ADMIN_IDLE_SECONDS) and now - _utc(device.created_at) < timedelta(seconds=ADMIN_ABSOLUTE_SECONDS):
                device.last_used_at = now
                notice = getattr(delivery, "enqueue_admin_security_notice", None)
                if active_rows and not callable(notice):
                    return None
                session.execute(update(AdminLoginApproval).where(
                    AdminLoginApproval.staff_id == staff.id,
                    AdminLoginApproval.category == category,
                    AdminLoginApproval.consumed_at.is_(None),
                    AdminLoginApproval.revoked_at.is_(None),
                ).values(revoked_at=now))
                result, replaced = _new_session(session, staff.id, device, active_rows,
                    signing_secret, now, request_id)
                if replaced:
                    notice(credential.recovery_email, category)
            else:
                if credential.recovery_email_verified_at is None or delivery is None or not callable(getattr(delivery, "enqueue_admin_device_approval", None)) or not approval_base_url:
                    return None
                session.execute(update(AdminLoginApproval).where(
                    AdminLoginApproval.staff_id == staff.id,
                    AdminLoginApproval.category == category,
                    AdminLoginApproval.consumed_at.is_(None),
                    AdminLoginApproval.revoked_at.is_(None),
                ).values(revoked_at=now))
                approval_raw, poll_raw = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
                attempt = AdminLoginApproval(staff_id=staff.id, category=category,
                    approval_token_digest=_token_digest(approval_raw), poll_token_digest=_token_digest(poll_raw),
                    created_at=now, expires_at=now + timedelta(seconds=ADMIN_APPROVAL_SECONDS))
                session.add(attempt)
                session.flush()
                session.add(AdminAuthEvent(actor_id=staff.id, subject_staff_id=staff.id,
                    action="admin_device_approval_requested", request_id=request_id, occurred_at=now))
                result = AdminLoginPending(attempt.id, poll_raw)
                parts = urlsplit(approval_base_url)
                link = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode({"approval_token": approval_raw}), ""))
                pending_delivery = (credential.recovery_email, link, attempt.id)
    if pending_delivery is not None:
        try:
            delivery.enqueue_admin_device_approval(pending_delivery[0], pending_delivery[1])
        except Exception:
            with session_factory.begin() as session:
                attempt = session.scalar(select(AdminLoginApproval).where(AdminLoginApproval.id == pending_delivery[2]).with_for_update())
                if attempt is not None and attempt.revoked_at is None:
                    attempt.revoked_at = _utc(clock())
            return None
    if result is None:
        return None
    if isinstance(result, AdminSessionToken):
        return AdminSessionToken(result.staff_id, result.session_id, result.token, result.refresh_token,
                                 device_cookie or "", result.category, result.expires_at)
    return result


def approve_admin_login(session_factory: sessionmaker[Session], approval_token: str, request_id: UUID, *, clock=utc_now) -> bool:
    if not isinstance(approval_token, str) or len(approval_token) != 43 or any(c not in _TOKEN_CHARS for c in approval_token):
        return False
    digest = _token_digest(approval_token)
    now = _utc(clock())
    with session_factory.begin() as session:
        probe = session.scalar(select(AdminLoginApproval).where(AdminLoginApproval.approval_token_digest == digest))
        if probe is None:
            return False
        session.scalar(select(StaffUser).where(StaffUser.id == probe.staff_id)
                       .execution_options(populate_existing=True).with_for_update())
        attempt = session.scalar(select(AdminLoginApproval).where(AdminLoginApproval.approval_token_digest == digest)
                                 .execution_options(populate_existing=True).with_for_update())
        if (attempt is None or attempt.staff_id != probe.staff_id or attempt.approved_at is not None
                or attempt.consumed_at is not None or attempt.revoked_at is not None
                or now >= _utc(attempt.expires_at)):
            return False
        attempt.approved_at = now
        session.add(AdminAuthEvent(actor_id=attempt.staff_id, subject_staff_id=attempt.staff_id,
            action="admin_device_approved", request_id=request_id, occurred_at=now))
    return True


def poll_admin_login_approval(session_factory: sessionmaker[Session], approval_id: UUID, poll_token: str,
                              signing_secret: str, request_id: UUID, *, delivery=None,
                              clock=utc_now) -> AdminSessionToken | AdminLoginPending | None:
    if not isinstance(poll_token, str) or len(poll_token) != 43 or any(c not in _TOKEN_CHARS for c in poll_token):
        return None
    now = _utc(clock())
    with session_factory.begin() as session:
        probe = session.scalar(select(AdminLoginApproval).where(AdminLoginApproval.id == approval_id))
        if probe is None:
            return None
        # Admin lifecycle operations acquire locks in this order: user, credential,
        # grants, category sessions, trusted device, then approval/recovery rows.
        staff = session.scalar(select(StaffUser).where(StaffUser.id == probe.staff_id)
                               .execution_options(populate_existing=True).with_for_update())
        credential = session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == probe.staff_id)
                                    .execution_options(populate_existing=True).with_for_update())
        grants = session.scalars(select(RoleGrant).where(RoleGrant.staff_id == probe.staff_id)
                                 .execution_options(populate_existing=True).with_for_update()).all()
        active_rows = _lock_active_admin_sessions(session, probe.staff_id, probe.category, now)
        attempt = session.scalar(select(AdminLoginApproval).where(AdminLoginApproval.id == approval_id)
                                 .execution_options(populate_existing=True).with_for_update())
        if attempt is None or attempt.staff_id != probe.staff_id or attempt.category != probe.category or not hmac.compare_digest(attempt.poll_token_digest, _token_digest(poll_token)) or attempt.consumed_at is not None or attempt.revoked_at is not None or now >= _utc(attempt.expires_at):
            return None
        if attempt.approved_at is None:
            return AdminLoginPending(attempt.id, "")
        if staff is None or not staff.is_active or credential is None or not any(
            grant.is_active and grant.role == "admin" and grant.scope_kind == "organization" and grant.branch_id is None for grant in grants
        ):
            attempt.revoked_at = now
            return None
        notice = getattr(delivery, "enqueue_admin_security_notice", None)
        if active_rows and not callable(notice):
            return None
        raw_cookie = secrets.token_urlsafe(32)
        device = AdminTrustedDevice(staff_id=staff.id, category=attempt.category,
            cookie_digest=_token_digest(raw_cookie), created_at=now, last_used_at=now)
        session.add(device)
        session.flush()
        attempt.consumed_at = now
        result, replaced = _new_session(session, staff.id, device, active_rows,
            signing_secret, now, request_id)
        if replaced:
            notice(credential.recovery_email, attempt.category)
    return AdminSessionToken(result.staff_id, result.session_id, result.token, result.refresh_token,
                             raw_cookie, result.category, result.expires_at)


def refresh_admin_session(session_factory: sessionmaker[Session], raw: str, signing_secret: str,
                          request_id: UUID, *, clock=utc_now) -> AdminSessionToken | None:
    claims = _claims(raw, signing_secret, "refresh", now=clock())
    if claims is None:
        return None
    try:
        session_id, staff_id, generation = UUID(claims["sid"]), UUID(claims["sub"]), claims["gen"]
        if not isinstance(generation, int) or generation < 0:
            return None
    except (ValueError, TypeError, KeyError):
        return None
    now = _utc(clock())
    digest = _token_digest(raw)
    with session_factory.begin() as session:
        # Keep the lifecycle lock order documented above before locking the session.
        staff = session.scalar(select(StaffUser).where(StaffUser.id == staff_id)
                               .execution_options(populate_existing=True).with_for_update())
        credential = session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == staff_id)
                                    .execution_options(populate_existing=True).with_for_update())
        grants = session.scalars(select(RoleGrant).where(RoleGrant.staff_id == staff_id)
                                 .execution_options(populate_existing=True).with_for_update()).all()
        row = session.scalar(select(StaffSession).where(StaffSession.id == session_id, StaffSession.staff_id == staff_id)
                             .execution_options(populate_existing=True).with_for_update())
        if row is None or row.scope_kind != "organization" or row.auth_method != "admin_password" or row.revoked_at is not None:
            return None
        if generation < row.refresh_generation:
            row.revoked_at = now
            session.add(AdminAuthEvent(actor_id=staff_id, subject_staff_id=staff_id,
                action="admin_refresh_reuse_detected", request_id=request_id, occurred_at=now))
            return None
        if generation != row.refresh_generation or row.refresh_token_digest is None or not hmac.compare_digest(row.refresh_token_digest, digest):
            return None
        if row.last_seen_at is None or row.absolute_expires_at is None or now - _utc(row.last_seen_at) >= timedelta(seconds=ADMIN_IDLE_SECONDS) or now >= _utc(row.absolute_expires_at):
            row.revoked_at = now
            return None
        device = session.scalar(select(AdminTrustedDevice).where(AdminTrustedDevice.id == row.admin_trusted_device_id,
            AdminTrustedDevice.revoked_at.is_(None)).with_for_update())
        if device is None:
            row.revoked_at = now
            return None
        device.last_used_at = now
        if staff is None or credential is None or not staff.is_active or not any(
            grant.is_active and grant.role == "admin" and grant.scope_kind == "organization" and grant.branch_id is None for grant in grants
        ):
            row.revoked_at = now
            return None
        row.refresh_generation += 1
        row.last_seen_at = now
        refresh_raw = _jwt({"exp": int(_utc(row.absolute_expires_at).timestamp()), "gen": row.refresh_generation,
                            "sid": str(row.id), "sub": str(row.staff_id), "typ": "refresh"}, signing_secret)
        row.refresh_token_digest = _token_digest(refresh_raw)
        access = _jwt({"exp": int((now + timedelta(seconds=ADMIN_ACCESS_SECONDS)).timestamp()), "sid": str(row.id),
                       "sub": str(row.staff_id), "typ": "access"}, signing_secret)
        row.token_digest = _token_digest(access)
        return AdminSessionToken(staff_id, session_id, access, refresh_raw, "", row.admin_category,
                                 now + timedelta(seconds=ADMIN_ACCESS_SECONDS))


def validate_admin_session(session_factory: sessionmaker[Session], token: str, signing_secret: str, *, clock=utc_now):
    claims = _claims(token, signing_secret, "access", now=clock())
    if claims is None:
        raise AuthorizationDenied("Authorization denied")
    try:
        session_id, staff_id = UUID(claims["sid"]), UUID(claims["sub"])
    except (ValueError, TypeError, KeyError):
        raise AuthorizationDenied("Authorization denied") from None
    with session_factory.begin() as session:
        # Keep the lifecycle lock order documented above before locking the session.
        staff = session.scalar(select(StaffUser).where(StaffUser.id == staff_id)
                               .execution_options(populate_existing=True).with_for_update())
        credential = session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == staff_id)
                                    .execution_options(populate_existing=True).with_for_update())
        grants = session.scalars(select(RoleGrant).where(RoleGrant.staff_id == staff_id)
                                 .execution_options(populate_existing=True).with_for_update()).all()
        row = session.scalar(select(StaffSession).where(StaffSession.id == session_id, StaffSession.staff_id == staff_id)
                             .execution_options(populate_existing=True).with_for_update())
        now = _utc(clock())
        if row is None or row.scope_kind != "organization" or row.auth_method != "admin_password" or row.revoked_at is not None:
            raise AuthorizationDenied("Authorization denied")
        device = session.scalar(select(AdminTrustedDevice).where(
            AdminTrustedDevice.id == row.admin_trusted_device_id, AdminTrustedDevice.revoked_at.is_(None)
        ).execution_options(populate_existing=True).with_for_update())
        if staff is None or credential is None or not staff.is_active or row.absolute_expires_at is None or row.last_seen_at is None or now >= _utc(row.absolute_expires_at) or now - _utc(row.last_seen_at) >= timedelta(seconds=ADMIN_IDLE_SECONDS) or not any(
            grant.is_active and grant.role == "admin" and grant.scope_kind == "organization" and grant.branch_id is None
            for grant in grants
        ):
            raise AuthorizationDenied("Authorization denied")
        row.last_seen_at = now
        if device is None:
            raise AuthorizationDenied("Authorization denied")
        device.last_used_at = now
        return row.staff_id, row.id

def logout_admin_session(session_factory: sessionmaker[Session], raw: str, signing_secret: str,
                         category: str, request_id: UUID, *, clock=utc_now) -> bool:
    """Revoke only the Admin session cryptographically represented by a refresh cookie."""
    now = _utc(clock())
    claims = _claims(raw, signing_secret, "refresh", now=now)
    if claims is None:
        return False
    try:
        staff_id = UUID(claims["sub"])
        session_id = UUID(claims["sid"])
        generation = claims["gen"]
        if not isinstance(generation, int) or isinstance(generation, bool) or generation < 0:
            return False
    except (ValueError, TypeError, KeyError):
        return False

    digest = _token_digest(raw)
    with session_factory.begin() as session:
        # Match refresh's staff -> credential -> grants -> session lock order.
        staff = session.scalar(select(StaffUser).where(StaffUser.id == staff_id)
                               .execution_options(populate_existing=True).with_for_update())
        credential = session.scalar(select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == staff_id)
                                    .execution_options(populate_existing=True).with_for_update())
        grants = session.scalars(select(RoleGrant).where(RoleGrant.staff_id == staff_id)
                                 .execution_options(populate_existing=True).with_for_update()).all()
        row = session.scalar(select(StaffSession).where(StaffSession.id == session_id, StaffSession.staff_id == staff_id)
                             .execution_options(populate_existing=True).with_for_update())
        if row is None or row.revoked_at is not None:
            return False
        if row.scope_kind != "organization" or row.auth_method != "admin_password" or row.admin_category != category:
            return False
        if staff is None:
            return False
        if generation > row.refresh_generation:
            return False
        if generation == row.refresh_generation:
            if row.refresh_token_digest is None or not hmac.compare_digest(row.refresh_token_digest, digest):
                return False
        # A signed prior generation identifies this SID and is treated like refresh-token reuse.
        row.revoked_at = now
        session.add(AdminAuthEvent(actor_id=staff_id, subject_staff_id=staff_id,
            action="admin_session_revoked", request_id=request_id, occurred_at=now))
        return True
