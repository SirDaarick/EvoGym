"""Admin-only lookup and explicit links between employee accounts and branch profiles."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth.admin import ADMIN_IDLE_SECONDS, validate_admin_session
from app.auth.authorization import AuthorizationDenied
from app.auth.authorization import Permission
from app.auth.owner import has_organization_permission
from app.db.models import (
    AdminPasswordCredential,
    AdminTrustedDevice,
    Branch,
    OrganizationOwner,
    RoleGrant,
    ReceptionStation,
    StaffDevicePairingCode,
    StaffPairedDevice,
    StaffCredential,
    StaffRosterProfile,
    StaffSession,
    StaffUser,
)
from app.observability.security import SecurityEventType, make_security_event, queue_security_event

router = APIRouter(prefix="/api/v1/admin/staff-accounts", tags=["admin staff accounts"])
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class AdminPrincipal:
    staff_id: UUID
    session_id: UUID


class StaffAccountLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    staff_user_id: UUID


class StaffAccountItem(BaseModel):
    id: UUID
    login_identifier: str
    is_active: bool
    link_state: str
    linked_profile_id: UUID | None


class StaffAccountPage(BaseModel):
    accounts: list[StaffAccountItem]


class AdminBranchItem(BaseModel):
    id: UUID
    code: str
    name: str


class AdminBranchPage(BaseModel):
    branches: list[AdminBranchItem]


class AdminRosterProfileItem(BaseModel):
    id: UUID
    full_name: str
    position: str
    is_active: bool
    staff_user_id: UUID | None


class AdminRosterProfilePage(BaseModel):
    profiles: list[AdminRosterProfileItem]


class StaffAccountLinkResult(BaseModel):
    profile_id: UUID
    staff_user_id: UUID
    link_state: str


class ReceptionStationCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_id: UUID


class ReceptionStationItem(BaseModel):
    id: UUID
    branch_id: UUID
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None


class ReceptionStationPage(BaseModel):
    stations: list[ReceptionStationItem]


class ReceptionStationIssued(ReceptionStationItem):
    station_credential: str


def _principal(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> AdminPrincipal:
    settings = request.app.state.settings
    factory = request.app.state.session_factory
    if (not settings.admin_auth_configured or not settings.admin_token_signing_configured or factory is None
            or credentials is None or credentials.scheme.lower() != "bearer"):
        raise HTTPException(401, "Authentication failed.")
    try:
        staff_id, session_id = validate_admin_session(
            factory, credentials.credentials, settings.admin_token_signing_secret.get_secret_value()
        )
    except (AuthorizationDenied, ValueError):
        raise HTTPException(401, "Authentication failed.") from None
    return AdminPrincipal(staff_id, session_id)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _require_live_admin(
    session, principal: AdminPrincipal, *, branch_id: UUID | None = None, target_id: UUID | None = None,
    computer_only: bool = False,
) -> tuple[StaffUser, StaffUser | None, Branch | None]:
    staff_ids = sorted({principal.staff_id, *([target_id] if target_id is not None else [])}, key=str)
    staff_rows = session.scalars(
        select(StaffUser).where(StaffUser.id.in_(staff_ids)).order_by(StaffUser.id).with_for_update()
    ).all()
    staff_by_id = {row.id: row for row in staff_rows}
    actor = staff_by_id.get(principal.staff_id)
    target = staff_by_id.get(target_id) if target_id is not None else None
    credential = session.scalar(
        select(AdminPasswordCredential).where(AdminPasswordCredential.staff_id == principal.staff_id)
        .execution_options(populate_existing=True).with_for_update()
    )
    grants = session.scalars(
        select(RoleGrant).where(RoleGrant.staff_id == principal.staff_id).order_by(RoleGrant.id)
        .execution_options(populate_existing=True).with_for_update()
    ).all()
    branch = session.scalar(
        select(Branch).where(Branch.id == branch_id).with_for_update()
    ) if branch_id is not None else None
    auth_session = session.scalar(
        select(StaffSession).where(
            StaffSession.id == principal.session_id,
            StaffSession.staff_id == principal.staff_id,
        ).execution_options(populate_existing=True).with_for_update()
    )
    device = None
    if auth_session is not None and auth_session.admin_trusted_device_id is not None:
        device = session.scalar(select(AdminTrustedDevice).where(
            AdminTrustedDevice.id == auth_session.admin_trusted_device_id,
            AdminTrustedDevice.revoked_at.is_(None),
        ).execution_options(populate_existing=True).with_for_update())

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
        raise HTTPException(401, "Authentication failed.")
    if not has_organization_permission(session, principal.staff_id, Permission.STAFF_EMPLOYEE_MANAGE):
        raise HTTPException(403, "Employee-management permission is required.")
    auth_session.last_seen_at = now
    device.last_used_at = now
    if target_id is not None and (target is None or not target.is_active):
        raise HTTPException(404, "Staff account not found.")
    if branch_id is not None and (branch is None or not branch.is_active):
        raise HTTPException(404, "Branch not found.")
    return actor, target, branch


@router.post("/deactivate/{staff_id}", status_code=204)
def deactivate_staff_account(staff_id: UUID, request: Request, principal: AdminPrincipal = Depends(_principal)):
    """Disable one global employee login and revoke only that account's trust."""
    factory = request.app.state.session_factory
    now = datetime.now(timezone.utc)
    with factory.begin() as session:
        _actor, target, _branch = _require_live_admin(session, principal, target_id=staff_id)
        owner = session.scalar(select(OrganizationOwner).where(
            OrganizationOwner.id == 1, OrganizationOwner.staff_id == staff_id,
        ).execution_options(populate_existing=True).with_for_update())
        legacy_owner = session.scalar(select(AdminPasswordCredential).where(
            AdminPasswordCredential.staff_id == staff_id,
            AdminPasswordCredential.is_owner.is_(True),
        ).with_for_update())
        if owner is not None or legacy_owner is not None:
            raise HTTPException(409, "The organization owner cannot be deactivated.")
        target.is_active = False
        for row in session.scalars(select(StaffSession).where(
            StaffSession.staff_id == staff_id, StaffSession.revoked_at.is_(None),
        ).order_by(StaffSession.id).with_for_update()).all():
            row.revoked_at = now
        for row in session.scalars(select(StaffPairedDevice).where(
            StaffPairedDevice.staff_id == staff_id, StaffPairedDevice.revoked_at.is_(None),
        ).order_by(StaffPairedDevice.id).with_for_update()).all():
            row.revoked_at = now
        for row in session.scalars(select(StaffDevicePairingCode).where(
            StaffDevicePairingCode.staff_id == staff_id,
            StaffDevicePairingCode.used_at.is_(None), StaffDevicePairingCode.revoked_at.is_(None),
        ).order_by(StaffDevicePairingCode.id).with_for_update()).all():
            row.revoked_at = now
        queue_security_event(session, make_security_event(
            SecurityEventType.STAFF_DEACTIVATED,
            employee_id=staff_id,
            initiating_actor_id=principal.staff_id,
            occurred_at=now,
        ))
    return Response(status_code=204)


@router.get("/reception-stations", response_model=ReceptionStationPage)
def list_reception_stations(request: Request, branch_id: UUID = Query(), principal: AdminPrincipal = Depends(_principal)):
    factory = request.app.state.session_factory
    with factory.begin() as session:
        _require_live_admin(session, principal, branch_id=branch_id, computer_only=True)
        rows = session.scalars(select(ReceptionStation).where(ReceptionStation.branch_id == branch_id)
                               .order_by(ReceptionStation.created_at.desc(), ReceptionStation.id)).all()
        return ReceptionStationPage(stations=[ReceptionStationItem(
            id=row.id, branch_id=row.branch_id, created_at=row.created_at,
            expires_at=row.expires_at, revoked_at=row.revoked_at,
        ) for row in rows])


@router.post("/reception-stations", response_model=ReceptionStationIssued, status_code=201)
def issue_reception_station(payload: ReceptionStationCreateRequest, request: Request,
                            principal: AdminPrincipal = Depends(_principal)):
    factory = request.app.state.session_factory
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
        result = ReceptionStationIssued(
            id=station.id, branch_id=station.branch_id, created_at=station.created_at,
            expires_at=station.expires_at, revoked_at=None, station_credential=raw,
        )
    response = Response(content=result.model_dump_json(), status_code=201, media_type="application/json",
                        headers={"Cache-Control": "no-store"})
    return response


@router.post("/reception-stations/{station_id}/revoke", status_code=204)
def revoke_reception_station(station_id: UUID, request: Request, branch_id: UUID = Query(),
                             principal: AdminPrincipal = Depends(_principal)):
    factory = request.app.state.session_factory
    now = datetime.now(timezone.utc)
    with factory.begin() as session:
        _require_live_admin(session, principal, branch_id=branch_id, computer_only=True)
        station = session.scalar(select(ReceptionStation).where(
            ReceptionStation.id == station_id, ReceptionStation.branch_id == branch_id,
        ).execution_options(populate_existing=True).with_for_update())
        if station is None:
            raise HTTPException(404, "Reception station not found.")
        if station.revoked_at is None:
            station.revoked_at = now
            queue_security_event(session, make_security_event(
                SecurityEventType.RECEPTION_STATION_REVOKED,
                device_id=station.id,
                initiating_actor_id=principal.staff_id,
                occurred_at=now,
            ))
            for row in session.scalars(select(StaffSession).where(
                StaffSession.reception_station_id == station.id, StaffSession.revoked_at.is_(None),
            ).order_by(StaffSession.id).with_for_update()).all():
                row.revoked_at = now
    return Response(status_code=204)


@router.get("", response_model=StaffAccountPage)
def list_staff_accounts(
    request: Request,
    branch_id: UUID = Query(),
    principal: AdminPrincipal = Depends(_principal),
):
    factory = request.app.state.session_factory
    with factory.begin() as session:
        _require_live_admin(session, principal, branch_id=branch_id)
        accounts = session.execute(
            select(StaffUser, StaffCredential)
            .join(StaffCredential, StaffCredential.staff_id == StaffUser.id)
            .order_by(StaffUser.login_identifier, StaffUser.id)
        ).all()
        links = session.execute(select(StaffRosterProfile.staff_user_id, StaffRosterProfile.id).where(
            StaffRosterProfile.branch_id == branch_id,
            StaffRosterProfile.staff_user_id.is_not(None),
        ).order_by(StaffRosterProfile.id)).all()
        linked_profile_by_staff = {staff_id: profile_id for staff_id, profile_id in links}
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


@router.get("/branches", response_model=AdminBranchPage)
def list_admin_branches(request: Request, principal: AdminPrincipal = Depends(_principal)):
    factory = request.app.state.session_factory
    with factory.begin() as session:
        _require_live_admin(session, principal)
        rows = session.scalars(select(Branch).where(Branch.is_active.is_(True)).order_by(Branch.code, Branch.id)).all()
        return AdminBranchPage(branches=[AdminBranchItem(id=row.id, code=row.code, name=row.name) for row in rows])


@router.get("/roster-profiles", response_model=AdminRosterProfilePage)
def list_admin_roster_profiles(
    request: Request,
    branch_id: UUID = Query(),
    principal: AdminPrincipal = Depends(_principal),
):
    factory = request.app.state.session_factory
    with factory.begin() as session:
        _require_live_admin(session, principal, branch_id=branch_id)
        rows = session.scalars(select(StaffRosterProfile).where(
            StaffRosterProfile.branch_id == branch_id,
            StaffRosterProfile.is_active.is_(True),
        ).order_by(StaffRosterProfile.full_name, StaffRosterProfile.id)).all()
        return AdminRosterProfilePage(profiles=[
            AdminRosterProfileItem(
                id=row.id,
                full_name=row.full_name,
                position=row.position,
                is_active=row.is_active,
                staff_user_id=row.staff_user_id,
            )
            for row in rows
        ])


@router.post("/roster-profiles/{profile_id}/link", response_model=StaffAccountLinkResult)
def link_staff_account(
    profile_id: UUID,
    payload: StaffAccountLinkRequest,
    request: Request,
    principal: AdminPrincipal = Depends(_principal),
):
    factory = request.app.state.session_factory
    try:
        with factory.begin() as session:
            profile_branch_id = session.scalar(
                select(StaffRosterProfile.branch_id).where(StaffRosterProfile.id == profile_id)
            )
            _actor, target, branch = _require_live_admin(
                session, principal, branch_id=profile_branch_id, target_id=payload.staff_user_id
            )
            if profile_branch_id is None:
                raise HTTPException(404, "Roster profile not found.")
            credential = session.scalar(select(StaffCredential).where(
                StaffCredential.staff_id == target.id,
                StaffCredential.method == "pin",
            ).execution_options(populate_existing=True).with_for_update())
            profile = session.scalar(
                select(StaffRosterProfile).where(StaffRosterProfile.id == profile_id)
                .execution_options(populate_existing=True).with_for_update()
            )
            if profile is None:
                raise HTTPException(404, "Roster profile not found.")
            if profile.branch_id != profile_branch_id or not profile.is_active or branch is None or credential is None:
                raise HTTPException(404, "Roster profile or staff account not found.")
            if profile.staff_user_id == target.id:
                return StaffAccountLinkResult(profile_id=profile.id, staff_user_id=target.id, link_state="linked")
            if profile.staff_user_id is not None:
                raise HTTPException(409, "Roster profile is already linked to another account.")
            existing = session.scalar(select(StaffRosterProfile.id).where(
                StaffRosterProfile.branch_id == profile.branch_id,
                StaffRosterProfile.staff_user_id == target.id,
            ).limit(1))
            if existing is not None:
                raise HTTPException(409, "Staff account is already linked in this branch.")
            profile.staff_user_id = target.id
            session.flush()
            return StaffAccountLinkResult(profile_id=profile.id, staff_user_id=target.id, link_state="linked")
    except IntegrityError:
        raise HTTPException(409, "Staff account is already linked in this branch.") from None
