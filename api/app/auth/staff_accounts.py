"""Admin staff-account use cases: live-admin gate, deactivation, reception stations, roster links and the
pending product-sale resolution. SQL in `app.auth.queries`; HTTP transport in `app.api.admin_staff_accounts`.

Failures are typed `HttpStatusError`s. Every use case takes the session `factory` and owns its transaction.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Protocol
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.auth import queries as q
from app.auth.admin import ADMIN_IDLE_SECONDS
from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.auth.owner import has_organization_permission
from app.auth.schemas import (
    AdminBranchItem, AdminBranchPage, AdminRosterProfileItem, AdminRosterProfilePage, ReceptionStationCreateRequest,
    ReceptionStationIssued, ReceptionStationItem, ReceptionStationPage, ResolveProductSaleIntentRequest,
    StaffAccountItem, StaffAccountLinkRequest, StaffAccountLinkResult, StaffAccountPage,
)
from app.db.models import ProductSaleIntent, ReceptionStation
from app.errors import HttpStatusError
from app.observability.security import SecurityEventType, make_security_event, queue_security_event
from app.sales import service as sales_service


class Principal(Protocol):
    staff_id: UUID
    session_id: UUID


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _require_live_admin(
    session, principal: Principal, *, branch_id: UUID | None = None, target_id: UUID | None = None,
    computer_only: bool = False, allow_inactive_target: bool = False,
):
    staff_ids = sorted({principal.staff_id, *([target_id] if target_id is not None else [])}, key=str)
    staff_by_id = {row.id: row for row in q.lock_staff_key_share(session, staff_ids)}
    actor = staff_by_id.get(principal.staff_id)
    target = staff_by_id.get(target_id) if target_id is not None else None
    credential = q.lock_admin_credential(session, principal.staff_id)
    grants = q.lock_grants(session, principal.staff_id)
    branch = q.lock_branch(session, branch_id) if branch_id is not None else None
    auth_session = q.lock_auth_session(session, principal.session_id, principal.staff_id)
    device = None
    if auth_session is not None and auth_session.admin_trusted_device_id is not None:
        device = q.lock_live_trusted_device(session, auth_session.admin_trusted_device_id)

    now = datetime.now(timezone.utc)
    has_admin = any(
        grant.is_active and grant.role == "admin" and grant.scope_kind == "organization" and grant.branch_id is None
        for grant in grants
    )
    if (actor is None or not actor.is_active or credential is None or not has_admin or auth_session is None
            or auth_session.scope_kind != "organization" or auth_session.auth_method != "admin_password"
            or (computer_only and auth_session.admin_category != "computer")
            or auth_session.revoked_at is not None or auth_session.absolute_expires_at is None
            or auth_session.last_seen_at is None or now >= _utc(auth_session.absolute_expires_at)
            or now - _utc(auth_session.last_seen_at) >= timedelta(seconds=ADMIN_IDLE_SECONDS)
            or device is None):
        raise HttpStatusError(401)
    if not has_organization_permission(session, principal.staff_id, Permission.STAFF_EMPLOYEE_MANAGE):
        raise HttpStatusError(403)
    auth_session.last_seen_at = now
    device.last_used_at = now
    if target_id is not None and (target is None or (not target.is_active and not allow_inactive_target)):
        raise HttpStatusError(404)
    if branch_id is not None and (branch is None or not branch.is_active):
        raise HttpStatusError(404)
    return actor, target, branch


def deactivate_staff_account(factory, principal: Principal, staff_id: UUID) -> None:
    """Disable one global employee login and revoke only that account's trust."""
    now = datetime.now(timezone.utc)
    with factory.begin() as session:
        _actor, target, _branch = _require_live_admin(session, principal, target_id=staff_id)
        owner = q.lock_org_owner_row(session, staff_id)
        legacy_owner = q.lock_legacy_owner(session, staff_id)
        if owner is not None or legacy_owner is not None:
            raise HttpStatusError(409)
        if session.get(ProductSaleIntent, staff_id) is not None:
            raise HttpStatusError(409)
        target.is_active = False
        for row in q.lock_active_sessions(session, staff_id):
            row.revoked_at = now
        for row in q.lock_active_paired_devices(session, staff_id):
            row.revoked_at = now
        for row in q.lock_open_pairing_codes(session, staff_id):
            row.revoked_at = now
        queue_security_event(session, make_security_event(
            SecurityEventType.STAFF_DEACTIVATED,
            employee_id=staff_id,
            initiating_actor_id=principal.staff_id,
            occurred_at=now,
        ))


def get_staff_product_sale_intent(factory, principal: Principal, staff_id: UUID):
    with factory.begin() as session:
        _require_live_admin(session, principal, target_id=staff_id, allow_inactive_target=True)
        intent = session.get(ProductSaleIntent, staff_id)
        if intent is None:
            return None
        return {"key": intent.idempotency_key, "register_id": str(intent.register_id), "payload": intent.payload}


def resolve_staff_product_sale_intent(factory, principal: Principal, staff_id: UUID,
                                      body: ResolveProductSaleIntentRequest):
    with factory.begin() as session:
        _require_live_admin(session, principal, target_id=staff_id, allow_inactive_target=True)
        intent = session.get(ProductSaleIntent, staff_id)
        if intent is None or intent.idempotency_key != body.key:
            raise HttpStatusError(409)
        return sales_service.resolve_intent_as_admin(session, principal.staff_id, staff_id, intent)


def list_reception_stations(factory, principal: Principal, branch_id: UUID) -> ReceptionStationPage:
    with factory.begin() as session:
        _require_live_admin(session, principal, branch_id=branch_id, computer_only=True)
        return ReceptionStationPage(stations=[ReceptionStationItem(
            id=row.id, branch_id=row.branch_id, created_at=row.created_at,
            expires_at=row.expires_at, revoked_at=row.revoked_at,
        ) for row in q.reception_stations(session, branch_id)])


def issue_reception_station(factory, principal: Principal, payload: ReceptionStationCreateRequest) -> ReceptionStationIssued:
    raw = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    with factory.begin() as session:
        _actor, _target, branch = _require_live_admin(session, principal, branch_id=payload.branch_id, computer_only=True)
        station = ReceptionStation(
            branch_id=branch.id, created_by=principal.staff_id,
            credential_digest=hashlib.sha256(raw.encode("ascii")).hexdigest(),
            created_at=now, expires_at=now + timedelta(days=90),
        )
        session.add(station)
        session.flush()
        queue_security_event(session, make_security_event(
            SecurityEventType.RECEPTION_STATION_ISSUED,
            device_id=station.id,
            initiating_actor_id=principal.staff_id,
            occurred_at=now,
        ))
        return ReceptionStationIssued(
            id=station.id, branch_id=station.branch_id, created_at=station.created_at,
            expires_at=station.expires_at, revoked_at=None, station_credential=raw,
        )


def revoke_reception_station(factory, principal: Principal, station_id: UUID, branch_id: UUID) -> None:
    now = datetime.now(timezone.utc)
    with factory.begin() as session:
        _require_live_admin(session, principal, branch_id=branch_id, computer_only=True)
        station = q.lock_station(session, station_id, branch_id)
        if station is None:
            raise HttpStatusError(404)
        if station.revoked_at is None:
            station.revoked_at = now
            queue_security_event(session, make_security_event(
                SecurityEventType.RECEPTION_STATION_REVOKED,
                device_id=station.id,
                initiating_actor_id=principal.staff_id,
                occurred_at=now,
            ))
            for row in q.lock_station_sessions(session, station.id):
                row.revoked_at = now


def list_staff_accounts(factory, principal: Principal, branch_id: UUID) -> StaffAccountPage:
    with factory.begin() as session:
        _require_live_admin(session, principal, branch_id=branch_id)
        accounts = q.accounts_with_credentials(session)
        linked_profile_by_staff = {staff_id: profile_id for staff_id, profile_id in q.branch_profile_links(session, branch_id)}
        return StaffAccountPage(accounts=[
            StaffAccountItem(
                id=staff.id,
                login_identifier=staff.login_identifier,
                is_active=staff.is_active,
                link_state="linked" if staff.id in linked_profile_by_staff else "unlinked",
                linked_profile_id=linked_profile_by_staff.get(staff.id),
            )
            for staff, _credential in accounts
        ])


def list_admin_branches(factory, principal: Principal) -> AdminBranchPage:
    with factory.begin() as session:
        _require_live_admin(session, principal)
        return AdminBranchPage(branches=[
            AdminBranchItem(id=row.id, code=row.code, name=row.name, timezone=row.timezone)
            for row in q.active_branches(session)])


def list_admin_roster_profiles(factory, principal: Principal, branch_id: UUID) -> AdminRosterProfilePage:
    with factory.begin() as session:
        _require_live_admin(session, principal, branch_id=branch_id)
        try:
            authorize(session, principal.staff_id, Permission.FINANCE_READ, branch_id)
            can_read_salary = True
        except AuthorizationDenied:
            can_read_salary = False
        return AdminRosterProfilePage(profiles=[
            AdminRosterProfileItem(
                id=row.id,
                full_name=row.full_name,
                position=row.position,
                is_active=row.is_active,
                staff_user_id=row.staff_user_id,
                **({"monthly_salary_minor": row.monthly_salary_minor} if can_read_salary else {}),
            )
            for row in q.active_roster_profiles(session, branch_id)
        ])


def link_staff_account(factory, principal: Principal, profile_id: UUID, payload: StaffAccountLinkRequest) -> StaffAccountLinkResult:
    try:
        with factory.begin() as session:
            profile_branch_id = q.profile_branch_id(session, profile_id)
            _actor, target, branch = _require_live_admin(
                session, principal, branch_id=profile_branch_id, target_id=payload.staff_user_id
            )
            if profile_branch_id is None:
                raise HttpStatusError(404)
            credential = q.lock_pin_credential(session, target.id)
            profile = q.lock_profile(session, profile_id)
            if profile is None:
                raise HttpStatusError(404)
            if profile.branch_id != profile_branch_id or not profile.is_active or branch is None or credential is None:
                raise HttpStatusError(404)
            if profile.staff_user_id == target.id:
                return StaffAccountLinkResult(profile_id=profile.id, staff_user_id=target.id, link_state="linked")
            if profile.staff_user_id is not None:
                raise HttpStatusError(409)
            if q.linked_profile_in_branch(session, profile.branch_id, target.id) is not None:
                raise HttpStatusError(409)
            profile.staff_user_id = target.id
            session.flush()
            return StaffAccountLinkResult(profile_id=profile.id, staff_user_id=target.id, link_state="linked")
    except IntegrityError:
        raise HttpStatusError(409) from None
