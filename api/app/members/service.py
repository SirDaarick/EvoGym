"""Member use cases: branch resolution, orchestration, commits and error mapping.

SQL lives in `app.members.queries` / `read_queries`; HTTP transport lives in `app.api.members` and
`app.api.member_reads`. Failures are raised as typed `AppError`s (never HTTPException).
"""
from datetime import datetime, timezone
from typing import Protocol
from uuid import UUID

from app.errors import HttpStatusError, PublicDomainError
from app.memberships.eligibility import evaluate_membership_access
from app.members import queries as q, read_queries as rq
from app.members.queries import DuplicateMemberNumberError
from app.members.schemas import (
    MemberDetailDTO, MemberEligibilityDTO, MemberListItemDTO, MemberListResponseDTO, MemberNoteDTO,
)


class Principal(Protocol):
    staff_id: UUID
    is_admin: bool
    branch_id: UUID | None


def _not_found() -> HttpStatusError:
    return HttpStatusError(404)


def _require_admin(principal: Principal) -> None:
    if not principal.is_admin:
        raise HttpStatusError(403)


def _require_member(session, member_id: UUID):
    member = q.get_member_by_id(session, member_id)
    if member is None:
        raise _not_found()
    return member


def _to_note_dto(note) -> MemberNoteDTO:
    return MemberNoteDTO(
        id=str(note.id),
        member_id=str(note.member_id),
        author_id=str(note.author_id),
        body=note.body,
        created_at=note.created_at,
        voided_at=note.voided_at,
        voided_by=str(note.voided_by) if note.voided_by else None,
        is_voided=note.is_voided,
    )


def _to_eligibility_dto(record) -> MemberEligibilityDTO:
    return MemberEligibilityDTO(
        id=str(record.id),
        member_id=str(record.member_id),
        eligibility_type=record.eligibility_type,
        verified_by=str(record.verified_by),
        verified_at=record.verified_at,
        valid_until=record.valid_until,
        notes=record.notes,
        is_valid=record.is_valid,
        revoked_at=record.revoked_at,
        revoked_by=str(record.revoked_by) if record.revoked_by else None,
    )


def _to_member_detail_dto(member, is_admin: bool, pending_balance_minor: int = 0) -> MemberDetailDTO:
    notes = member.notes if is_admin else None
    derived = getattr(member, "membership_status", None)
    effective_status = derived if (derived in ("expired", "inactive") and member.status == "active") else member.status
    return MemberDetailDTO(
        id=str(member.id),
        member_number=member.member_number,
        full_name=member.full_name,
        preferred_name=member.preferred_name,
        phone=member.phone,
        email=member.email,
        birth_date=member.birth_date,
        emergency_contact_name=member.emergency_contact_name,
        emergency_contact_phone=member.emergency_contact_phone,
        notes=notes,
        status=effective_status,
        joined_on=member.joined_on,
        credit_balance_minor=member.credit_balance_minor,
        photo_url=member.photo_url,
        pending_balance_minor=pending_balance_minor,
        has_pending_balance=pending_balance_minor > 0,
        membership_ends_on=getattr(member, "membership_ends_on", None),
        membership_status=derived or member.status,
    )


def resolve_caller_branch(session, principal: Principal, query_branch_id: UUID | None,
                          header_branch_id: UUID | None) -> UUID:
    """Resolve authoritative branch context, validating non-admin branch assignment."""
    if not principal.is_admin:
        if principal.branch_id is None:
            raise HttpStatusError(403)
        target_branch = query_branch_id or header_branch_id
        if target_branch is not None and target_branch != principal.branch_id:
            raise HttpStatusError(403)
        return principal.branch_id

    # Admin may specify target branch via query or header, or fall back to default
    if query_branch_id is not None:
        return query_branch_id
    if header_branch_id is not None:
        return header_branch_id
    if principal.branch_id is not None:
        return principal.branch_id

    # Resolve first active branch from database or fallback UUID
    active_branch_id = rq.first_active_branch_id(session)
    if active_branch_id is not None:
        return active_branch_id
    return UUID("00000000-0000-0000-0000-000000000001")


def list_members(
    factory,
    *,
    principal,
    page,
    limit,
    search,
    status,
    sort_by,
    sort_dir,
    membership_status: str | None = None,
) -> MemberListResponseDTO:
    with factory() as session:
        from app.db.models.authorization import Branch

        branch_id = resolve_caller_branch(session, principal, None, None)
        branch = session.get(Branch, branch_id)
        result = q.list_members(
            session,
            page=page,
            limit=limit,
            search=search,
            status=status,
            membership_status=membership_status,
            sort_by=sort_by,
            sort_dir=sort_dir,
            branch_timezone=branch.timezone if branch else "America/Mexico_City",
        )
        return MemberListResponseDTO(
            items=[
                MemberListItemDTO(
                    id=str(item.id),
                    member_number=item.member_number,
                    full_name=item.full_name,
                    preferred_name=item.preferred_name,
                    phone=item.phone,
                    status=getattr(item, "membership_status", item.status),
                    joined_on=item.joined_on,
                    credit_balance_minor=item.credit_balance_minor,
                    emergency_contact_name=item.emergency_contact_name,
                    emergency_contact_phone=item.emergency_contact_phone,
                    photo_url=item.photo_url,
                    membership_ends_on=getattr(item, "membership_ends_on", None),
                    membership_status=getattr(item, "membership_status", item.status),
                )
                for item in result.items
            ],
            total=result.total,
            page=page,
            limit=limit,
            pages=result.pages,
        )


def create_member(factory, principal: Principal, payload) -> MemberDetailDTO:
    with factory() as session:
        try:
            member = q.create_member(session, payload, actor_id=principal.staff_id, is_admin=principal.is_admin)
            session.commit()
            return _to_member_detail_dto(member, principal.is_admin)
        except DuplicateMemberNumberError:
            session.rollback()
            raise HttpStatusError(409) from None


def get_member(factory, principal: Principal, member_id: UUID) -> MemberDetailDTO:
    with factory() as session:
        from zoneinfo import ZoneInfo
        from app.db.models.authorization import Branch
        from app.db.models.memberships import MembershipPeriod
        from sqlalchemy import func, select

        member = _require_member(session, member_id)
        pending_balance_minor = q.get_member_pending_balance_minor(session, member.id)
        branch_id = resolve_caller_branch(session, principal, None, None)
        branch = session.get(Branch, branch_id)
        branch_tz = branch.timezone if branch else "America/Mexico_City"
        today = datetime.now(ZoneInfo(branch_tz)).date()
        max_ends_on = session.scalar(
            select(func.max(MembershipPeriod.ends_on)).where(MembershipPeriod.member_id == member.id)
        )
        member.membership_ends_on = max_ends_on
        member.membership_status = q._derive_membership_status(member.status, max_ends_on, today)
        return _to_member_detail_dto(member, principal.is_admin, pending_balance_minor)


def update_member(factory, principal: Principal, member_id: UUID, payload) -> MemberDetailDTO:
    with factory() as session:
        member = q.update_member(session, member_id, payload)
        if member is None:
            raise _not_found()
        session.commit()
        pending_balance_minor = q.get_member_pending_balance_minor(session, member.id)
        return _to_member_detail_dto(member, principal.is_admin, pending_balance_minor)


def list_notes(factory, member_id: UUID, include_voided: bool) -> list[MemberNoteDTO]:
    with factory() as session:
        _require_member(session, member_id)
        return [_to_note_dto(n) for n in q.list_member_notes(session, member_id, include_voided=include_voided)]


def create_note(factory, principal: Principal, member_id: UUID, payload) -> MemberNoteDTO:
    with factory() as session:
        _require_member(session, member_id)
        note = q.add_member_note(session, member_id, principal.staff_id, payload.body)
        session.commit()
        return _to_note_dto(note)


def void_note(factory, principal: Principal, member_id: UUID, note_id: UUID) -> MemberNoteDTO:
    _require_admin(principal)
    with factory() as session:
        _require_member(session, member_id)
        note = q.get_member_note(session, note_id)
        if note is None or note.member_id != member_id:
            raise _not_found()
        voided_note = q.void_member_note(session, note_id, principal.staff_id)
        session.commit()
        return _to_note_dto(voided_note)


def list_eligibility(factory, member_id: UUID, only_active: bool) -> list[MemberEligibilityDTO]:
    with factory() as session:
        _require_member(session, member_id)
        return [_to_eligibility_dto(r) for r in q.list_member_eligibility(session, member_id, only_active=only_active)]


def create_eligibility(factory, principal: Principal, member_id: UUID, payload) -> MemberEligibilityDTO:
    _require_admin(principal)
    with factory() as session:
        _require_member(session, member_id)
        record = q.add_member_eligibility(
            session,
            member_id=member_id,
            eligibility_type=payload.eligibility_type,
            verified_by=principal.staff_id,
            valid_until=payload.valid_until,
            notes=payload.notes,
        )
        session.commit()
        return _to_eligibility_dto(record)


def revoke_eligibility(factory, principal: Principal, member_id: UUID, record_id: UUID) -> MemberEligibilityDTO:
    _require_admin(principal)
    with factory() as session:
        _require_member(session, member_id)
        record = q.get_member_eligibility_record(session, record_id)
        if record is None or record.member_id != member_id:
            raise _not_found()
        revoked_record = q.revoke_member_eligibility(session, record_id, principal.staff_id)
        session.commit()
        return _to_eligibility_dto(revoked_record)


def member_purchases(factory, principal: Principal, member_id: UUID, *, page, page_size, from_date, to_date,
                     branch_id, x_branch_id) -> dict:
    if from_date and to_date and from_date > to_date:
        raise HttpStatusError(422)
    with factory() as session:
        branch = resolve_caller_branch(session, principal, branch_id, x_branch_id)
        if rq.get_member(session, member_id) is None:
            raise _not_found()
        total, rows = rq.list_purchase_events(session, member_id, branch, from_date, to_date, page, page_size)
        items = [{"id": row.id, "created_at": row.created_at, "kind": row.kind, **rq.purchase_item(session, row)}
                 for row in rows]
        return {"items": items, "total": total, "page": page, "page_size": page_size}


def member_summary(factory, principal: Principal, member_id: UUID, branch_id, x_branch_id) -> dict:
    now = datetime.now(timezone.utc)
    today = now.date()
    with factory() as session:
        branch = resolve_caller_branch(session, principal, branch_id, x_branch_id)
        member = rq.get_member(session, member_id)
        if member is None:
            raise _not_found()
        d = rq.summary_data(session, member_id, branch, now)
        period, debts, rentals, rental_debt, note = d["period"], d["debts"], d["rentals"], d["rental_debt"], d["note"]
        locker = next(((r, a) for r, a in rentals if r.kind == "locker" and r.status == "active"), None)
        gloves = next(((r, a) for r, a in rentals if r.kind == "glove" and r.status == "active"), None)
        weekly = round(d["visit_count"] / 4, 1)
        last_visit = d["last_visit"]
        last = last_visit.replace(tzinfo=timezone.utc) if last_visit and last_visit.tzinfo is None else last_visit
        at_risk = last is not None and (now - last).days >= 7
        return {
            "member_id": member.id, "member_number": member.member_number, "full_name": member.full_name,
            "phone": member.phone, "photo_url": member.photo_url,
            "membership": ({"plan_name": period[1].description_snapshot, "starts_on": period[0].starts_on,
                "ends_on": period[0].ends_on, "status": evaluate_membership_access(session, period[0].id, today, branch).status.value,
                "days_remaining": (period[0].ends_on - today).days} if period else None),
            "financial": {"has_pending_balance": bool(debts) or rental_debt > 0, "pending_balance_minor": sum(x.remaining for x in debts) + rental_debt,
                          "unpaid_order_id": debts[0].order_id if debts else None},
            "rentals": {"active_locker": {"code": locker[1].code, "expires_at": locker[0].ends_on,
                "status": "expired" if locker[0].ends_on and locker[0].ends_on <= today else "active"} if locker else None,
                "active_gloves": {"code": gloves[1].code, "returned": False} if gloves else None},
            "habits": {"weekly_visits": weekly, "attendance_tier": "risk" if at_risk else "high" if weekly >= 3 else "normal",
                "greeting_prompt": "Reincorporación: Preguntar cómo ha estado tras varios días sin entrenar." if at_risk else
                    "Socio habitual: Saludo ágil y desear excelente entrenamiento." if weekly >= 3 else "Saludar cordialmente al socio.",
                "favorite_product": d["favorite"]},
            "latest_note": {"id": note[0].id, "body": note[0].body, "author_name": note[1],
                            "created_at": note[0].created_at} if note else None,
        }


def member_check_in_history(factory, principal: Principal, member_id: UUID, *, month, year, branch_id,
                            x_branch_id, x_organization_id) -> list[dict]:
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.utc)
    with factory() as session:
        branch = resolve_caller_branch(session, principal, branch_id, x_branch_id)
        member = rq.get_member_reload_data(session, member_id, principal.is_admin, branch, x_organization_id, 1)
        if member is None:
            raise _not_found()
        return [{"id": v.id, "branch_id": v.branch_id, "occurred_at": v.occurred_at, "access_reason": v.access_reason}
                for v in rq.list_check_ins_between(session, member_id, branch, start, end)]


def reload_member(factory, principal: Principal, member_id: UUID, *, visit_limit, branch_id, x_branch_id,
                  x_organization_id):
    with factory() as session:
        caller_branch_id = resolve_caller_branch(session, principal, branch_id, x_branch_id)
        reload_dto = rq.get_member_reload_data(
            session=session, member_id=member_id, principal_is_admin=principal.is_admin,
            caller_branch_id=caller_branch_id, caller_org_id=x_organization_id, visit_limit=visit_limit,
        )
        if reload_dto is None:
            raise _not_found()
        return reload_dto
