"""Online, branch-scoped member check-in events."""
from datetime import datetime, timezone
from hashlib import sha256
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.members import MemberActorPrincipal, get_member_actor_principal
from app.auth.authorization import AuthorizationDenied, Permission, authorize
from app.db.models import Branch, Member, MemberCheckIn, MembershipPeriod
from app.db.models.member_check_ins import MemberCheckInVisit
from app.memberships.eligibility import evaluate_membership_access

router = APIRouter(prefix="/api/v1/member-check-ins", tags=["member-check-ins"])


class MemberCheckInResponse(BaseModel):
    id: UUID
    visit_id: UUID
    member_id: UUID
    period_id: UUID
    branch_id: UUID
    recorded_by: UUID
    occurred_at: datetime
    access_reason: str
    access_warnings: list[str]
    replayed: bool


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _response(event: MemberCheckIn, *, replayed: bool) -> MemberCheckInResponse:
    occurred_at = event.occurred_at
    if occurred_at.tzinfo is None:
        occurred_at = occurred_at.replace(tzinfo=timezone.utc)
    return MemberCheckInResponse(
        id=event.id,
        visit_id=event.visit_id,
        member_id=event.member_id,
        period_id=event.period_id,
        branch_id=event.branch_id,
        recorded_by=event.recorded_by,
        occurred_at=occurred_at.astimezone(timezone.utc),
        access_reason=event.access_reason,
        access_warnings=event.access_warnings,
        replayed=replayed,
    )


def _find_by_key(session, principal: MemberActorPrincipal, branch_id: UUID, key: str):
    return session.scalar(select(MemberCheckIn).where(
        MemberCheckIn.branch_id == branch_id,
        MemberCheckIn.recorded_by == principal.staff_id,
        MemberCheckIn.idempotency_key == key,
    ).with_for_update())


@router.post("/branches/{branch_id}/periods/{period_id}", response_model=MemberCheckInResponse, status_code=201)
def record_member_check_in(
    branch_id: UUID,
    period_id: UUID,
    request: Request,
    response: Response,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=1, max_length=128,
                                 pattern=r"^[A-Za-z0-9._:-]+$"),
    principal: MemberActorPrincipal = Depends(get_member_actor_principal),
):
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(503, "Database unavailable.")
    fingerprint = sha256(f"{branch_id}\n{period_id}\n{principal.staff_id}".encode()).hexdigest()
    with factory.begin() as session:
        if not principal.is_admin and principal.branch_id != branch_id:
            raise HTTPException(404, "Branch not found.")
        try:
            authorize(session, principal.staff_id, Permission.MEMBER_OPERATIONAL_READ, branch_id)
        except AuthorizationDenied:
            raise HTTPException(403, "Member check-in requires an active scoped Admin or receptionist grant.") from None
        branch = session.get(Branch, branch_id)
        if branch is None or not branch.is_active:
            raise HTTPException(404, "Branch not found.")

        existing = _find_by_key(session, principal, branch_id, idempotency_key)
        if existing is not None:
            if existing.request_fingerprint != fingerprint:
                raise HTTPException(409, "Idempotency key was already used for a different check-in.")
            response.status_code = 200
            return _response(existing, replayed=True)

        period = session.get(MembershipPeriod, period_id)
        if period is None:
            raise HTTPException(404, "Membership period not found.")
        occurred_at = utc_now()
        if occurred_at.tzinfo is None or occurred_at.utcoffset() is None:
            raise HTTPException(500, "Server clock must return a timezone-aware timestamp.")
        occurred_at = occurred_at.astimezone(timezone.utc)
        on_date = occurred_at.astimezone(ZoneInfo(branch.timezone)).date()
        access = evaluate_membership_access(session, period.id, on_date, branch_id)
        if not access.allowed:
            raise HTTPException(409, {
                "code": "membership_access_denied",
                "status": access.status.value,
                "reason": access.reason,
            })

        # Lock the member row so PostgreSQL serializes competing first visits.
        session.scalar(select(Member.id).where(Member.id == period.member_id).with_for_update())
        visit = session.scalar(
            select(MemberCheckInVisit)
            .where(MemberCheckInVisit.member_id == period.member_id)
            .order_by(MemberCheckInVisit.started_at.desc())
            .limit(1)
        )
        if visit is None or (occurred_at - _aware_utc(visit.started_at)).total_seconds() >= 300:
            visit = MemberCheckInVisit(member_id=period.member_id, started_at=occurred_at)
            session.add(visit)
            session.flush()

        event = MemberCheckIn(
            visit_id=visit.id,
            member_id=period.member_id,
            period_id=period.id,
            branch_id=branch_id,
            recorded_by=principal.staff_id,
            idempotency_key=idempotency_key,
            request_fingerprint=fingerprint,
            access_reason=access.reason,
            access_warnings=list(access.warnings),
            occurred_at=occurred_at,
        )
        try:
            with session.begin_nested():
                session.add(event)
                session.flush()
        except IntegrityError:
            existing = _find_by_key(session, principal, branch_id, idempotency_key)
            if existing is None:
                raise
            if existing.request_fingerprint != fingerprint:
                raise HTTPException(409, "Idempotency key was already used for a different check-in.") from None
            response.status_code = 200
            return _response(existing, replayed=True)
        return _response(event, replayed=False)


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
