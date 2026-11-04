"""Staff roster use cases: branch scope, manage/finance permissions, salary-vs-advances guard and uniqueness
mapping. SQL lives in `app.staff.queries`; HTTP transport in `app.api.staff_roster`.

Failures are typed `HttpStatusError`s. Every use case takes the session `factory` and owns its transaction.
"""
from typing import Protocol
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.db.models import Branch, StaffRosterProfile
from app.errors import HttpStatusError
from app.staff import queries as q
from app.staff.schemas import (
    StaffRosterCreate, StaffRosterItem, StaffRosterPage, StaffRosterPatchResult, StaffRosterUpdate,
)


class Principal(Protocol):
    staff_id: UUID
    branch_id: UUID | None
    is_admin: bool


def weekly_base(monthly: int) -> int:
    return (monthly + 2) // 4


def allowed_branches(session, principal: Principal, requested_id: UUID | None) -> list[Branch]:
    if not principal.is_admin:
        if requested_id is not None and requested_id != principal.branch_id:
            raise HttpStatusError(404)
        requested_id = principal.branch_id
    branches = q.active_branches(session, requested_id)
    authorized = []
    for branch in branches:
        try:
            authorize(session, principal.staff_id, Permission.STAFF_ROSTER_READ, branch.id)
        except AuthorizationDenied:
            continue
        authorized.append(branch)
    if requested_id is not None and not authorized:
        raise HttpStatusError(404)
    return authorized


def _require_manage(session, principal: Principal, branch_id: UUID) -> Branch:
    try:
        authorize(session, principal.staff_id, Permission.STAFF_ROSTER_MANAGE, branch_id)
    except AuthorizationDenied:
        raise HttpStatusError(403) from None
    branch = q.get_branch(session, branch_id)
    if branch is None or not branch.is_active:
        raise HttpStatusError(404)
    return branch


def _duplicate_name(exc: IntegrityError) -> bool:
    return "uq_staff_roster_branch_name" in str(exc.orig) or "staff_roster_profiles.branch_id" in str(exc.orig)


def list_staff_roster(factory, principal: Principal, branch_id: UUID | None, include_inactive: bool) -> StaffRosterPage:
    with factory() as session:
        branches = allowed_branches(session, principal, branch_id)
        rows, total = q.roster_page(session, [branch.id for branch in branches], include_inactive)
        return StaffRosterPage(items=rows, total=total)


def create_staff_profile(factory, principal: Principal, branch_id: UUID, payload: StaffRosterCreate) -> StaffRosterItem:
    try:
        with factory.begin() as session:
            _require_manage(session, principal, branch_id)
            profile = StaffRosterProfile(branch_id=branch_id, full_name=payload.full_name, position=payload.position)
            session.add(profile)
            session.flush()
            return StaffRosterItem.model_validate(profile)
    except (TypeError, ValueError) as exc:
        raise HttpStatusError(422) from exc
    except IntegrityError as exc:
        if not _duplicate_name(exc):
            raise
        raise HttpStatusError(409) from None


def update_staff_profile(factory, principal: Principal, profile_id: UUID, payload: StaffRosterUpdate) -> StaffRosterPatchResult:
    try:
        with factory.begin() as session:
            profile = q.get_profile(session, profile_id)
            if profile is None:
                raise HttpStatusError(404)
            _require_manage(session, principal, profile.branch_id)
            changes = payload.model_dump(exclude_unset=True)
            if "monthly_salary_minor" in changes:
                if not principal.is_admin:
                    raise HttpStatusError(403)
                try:
                    authorize(session, principal.staff_id, Permission.FINANCE_READ, profile.branch_id)
                except AuthorizationDenied:
                    raise HttpStatusError(403) from None
                profile = q.lock_profile_fresh(session, profile_id)
                new_salary = changes["monthly_salary_minor"]
                if new_salary is not None and q.over_advanced_week(session, profile_id, weekly_base(new_salary)) is not None:
                    raise HttpStatusError(409)
            if "branch_id" in changes:
                raise HttpStatusError(422)
            for key, value in changes.items():
                if value is None:
                    raise HttpStatusError(422)
                setattr(profile, key, value)
            if (profile.expected_entry_time is None) != (profile.grace_tolerance_minutes is None):
                raise HttpStatusError(422)
            session.flush()
            result = StaffRosterItem.model_validate(profile).model_dump()
            if "monthly_salary_minor" in changes:
                result["monthly_salary_minor"] = profile.monthly_salary_minor
            return StaffRosterPatchResult(**result)
    except (TypeError, ValueError) as exc:
        raise HttpStatusError(422) from exc
    except IntegrityError as exc:
        if not _duplicate_name(exc):
            raise
        raise HttpStatusError(409) from None
