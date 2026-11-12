"""Member query functions."""
import re
from datetime import date, datetime, timedelta, timezone
from typing import NamedTuple
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models.members import Member, MemberEligibilityRecord, MemberNote
from app.db.models.membership_debts import MembershipDebt
from app.db.models.membership_debt_payments import MembershipDebtPayment
from app.db.models.memberships import MembershipPeriod
from app.members.schemas import CreateMemberDTO, UpdateMemberDTO


DIRECT_SORT_COLUMNS = {
    "full_name": Member.full_name,
    "joined_on": Member.joined_on,
    "member_number": Member.member_number,
    "phone": Member.phone,
}
ALLOWED_SORT_FIELDS = frozenset({*DIRECT_SORT_COLUMNS, "membership_status", "membership_ends_on"})
ALLOWED_MEMBERSHIP_STATUSES = frozenset({"active", "expired", "inactive", "suspended", "pending"})

def _derive_membership_status(member_status: str, ends_on: date | None, today: date) -> str:
    """Derive operational membership status from latest period end date and profile status."""
    if member_status == "suspended":
        return "suspended"
    if member_status in ("inactive",):
        return "inactive"
    if member_status == "expired":
        return "expired"
    if ends_on is None:
        return "active" if member_status == "active" else "inactive"
    if ends_on > today:
        return "active"
    return "expired" if (today - ends_on).days < 31 else "inactive"


def _build_derived_status_expr(ends_on_expr, today: date, expired_cutoff: date):
    """Build SQL CASE expression mirroring `_derive_membership_status`."""
    return case(
        (Member.status == "suspended", "suspended"),
        (Member.status == "inactive", "inactive"),
        (Member.status == "expired", "expired"),
        (
            ends_on_expr.is_(None),
            case((Member.status == "active", "active"), else_="inactive"),
        ),
        (ends_on_expr > today, "active"),
        (ends_on_expr > expired_cutoff, "expired"),
        else_="inactive",
    )


class MemberListResult(NamedTuple):
    """Result container for paginated members list."""

    items: list[Member]
    total: int
    pages: int


def list_members(
    session: Session,
    *,
    page: int = 1,
    limit: int = 20,
    search: str | None = None,
    status: str | None = None,
    membership_status: str | None = None,
    sort_by: str = "full_name",
    sort_dir: str = "asc",
    branch_timezone: str = "America/Mexico_City",
) -> MemberListResult:
    """Retrieve paginated members with search, filter, and sorting.

    Args:
        session: Active SQLAlchemy session.
        page: 1-indexed page number (>= 1).
        limit: Number of items per page (>= 1).
        search: Optional case-insensitive substring for full_name, phone, or member_number.
        status: Optional exact profile status filter.
        membership_status: Optional derived operational membership status filter.
        sort_by: Field to sort by ('full_name', 'joined_on', 'member_number', 'phone',
            'membership_status', or 'membership_ends_on').
        sort_dir: Direction ('asc' or 'desc').
        branch_timezone: IANA timezone name for branch-local date boundaries.

    Returns:
        MemberListResult containing (items, total, pages).
    """
    if sort_by not in ALLOWED_SORT_FIELDS:
        raise ValueError(f"Invalid sort field: {sort_by}")
    if sort_dir not in ("asc", "desc"):
        raise ValueError(f"Invalid sort direction: {sort_dir}")
    if page < 1:
        raise ValueError("page must be >= 1")
    if limit < 1:
        raise ValueError("limit must be >= 1")
    normalized_membership_status: str | None = None
    if membership_status is not None:
        normalized_membership_status = membership_status.strip()
        if normalized_membership_status not in ALLOWED_MEMBERSHIP_STATUSES:
            raise ValueError(f"Invalid membership status: {membership_status}")

    today = datetime.now(ZoneInfo(branch_timezone)).date()
    expired_cutoff = today - timedelta(days=31)

    # Correlated lookup only evaluates the 50 page rows for direct sorts; when
    # filtering or sorting across all members by derived period fields, a single
    # grouped index-only aggregation avoids repeated per-row SubPlan lookups.
    needs_full_period_scan = (
        normalized_membership_status is not None or sort_by not in DIRECT_SORT_COLUMNS
    )
    if needs_full_period_scan:
        latest_period_sq = (
            select(
                MembershipPeriod.member_id.label("member_id"),
                func.max(MembershipPeriod.ends_on).label("max_ends_on"),
            )
            .group_by(MembershipPeriod.member_id)
            .subquery()
        )
        ends_on_expr = latest_period_sq.c.max_ends_on
    else:
        latest_period_sq = None
        ends_on_expr = (
            select(func.max(MembershipPeriod.ends_on))
            .where(MembershipPeriod.member_id == Member.id)
            .correlate(Member)
            .scalar_subquery()
        )

    derived_status_expr = _build_derived_status_expr(ends_on_expr, today, expired_cutoff)

    filters = []
    if search is not None and search.strip():
        term = f"%{search.strip()}%"
        digits = "".join(ch for ch in search if ch.isdigit())
        conditions = [
            Member.full_name.ilike(term),
            Member.preferred_name.ilike(term),
            Member.phone.ilike(term),
            Member.member_number.ilike(term),
        ]
        if digits:
            conditions.append(Member.phone_key.ilike(f"%{digits}%"))
        filters.append(or_(*conditions))
    if status is not None and status.strip():
        filters.append(Member.status == status.strip())
    if normalized_membership_status is not None:
        filters.append(derived_status_expr == normalized_membership_status)

    count_stmt = select(func.count()).select_from(Member)
    if latest_period_sq is not None and normalized_membership_status is not None:
        count_stmt = count_stmt.outerjoin(
            latest_period_sq, latest_period_sq.c.member_id == Member.id
        )
    if filters:
        count_stmt = count_stmt.where(*filters)
    total = session.scalar(count_stmt) or 0

    pages = max(1, (total + limit - 1) // limit)

    if sort_by in DIRECT_SORT_COLUMNS:
        sort_col = DIRECT_SORT_COLUMNS[sort_by]
        order_clauses = [sort_col.asc() if sort_dir == "asc" else sort_col.desc(), Member.id.asc()]
    elif sort_by == "membership_ends_on":
        ends_on_nulls_last = case((ends_on_expr.is_(None), 1), else_=0).asc()
        ends_on_dir = ends_on_expr.asc() if sort_dir == "asc" else ends_on_expr.desc()
        order_clauses = [ends_on_nulls_last, ends_on_dir, Member.id.asc()]
    else:
        status_rank = case(
            {"active": 0, "expired": 1, "pending": 2, "suspended": 3},
            value=derived_status_expr,
            else_=4,
        )
        rank_dir = status_rank.asc() if sort_dir == "asc" else status_rank.desc()
        ends_on_nulls_last = case((ends_on_expr.is_(None), 1), else_=0).asc()
        order_clauses = [rank_dir, ends_on_nulls_last, ends_on_expr.desc(), Member.id.asc()]

    stmt = select(
        Member,
        ends_on_expr.label("membership_ends_on"),
        derived_status_expr.label("derived_status"),
    )
    if latest_period_sq is not None:
        stmt = stmt.outerjoin(latest_period_sq, latest_period_sq.c.member_id == Member.id)
    if filters:
        stmt = stmt.where(*filters)
    stmt = (
        stmt.order_by(*order_clauses)
        .offset((page - 1) * limit)
        .limit(limit)
    )
    items: list[Member] = []
    for member, ends_on, derived_status in session.execute(stmt).all():
        member.membership_ends_on = ends_on
        member.membership_status = derived_status
        items.append(member)

    return MemberListResult(items=items, total=total, pages=pages)


def get_member_by_id(session: Session, member_id: UUID | str) -> Member | None:
    """Retrieve a single member by primary key."""
    if isinstance(member_id, str):
        try:
            member_id = UUID(member_id)
        except ValueError:
            return None
    return session.get(Member, member_id)


def get_member_note(session: Session, note_id: UUID) -> MemberNote | None:
    return session.get(MemberNote, note_id)


def get_member_eligibility_record(session: Session, record_id: UUID) -> MemberEligibilityRecord | None:
    return session.get(MemberEligibilityRecord, record_id)


def get_member_pending_balance_minor(session: Session, member_id: UUID) -> int:
    """Return remaining partial-sale debt after explicit order-specific cash receipts."""
    debts: dict[UUID, int] = {}
    for debt_id, initial_amount in session.execute(
        select(MembershipDebt.id, MembershipDebt.initial_outstanding_minor)
        .where(MembershipDebt.member_id == member_id)
    ):
        if type(initial_amount) is not int or initial_amount <= 0 or initial_amount > 2**63 - 1:
            raise ValueError("Member pending balance is outside signed 64-bit minor units.")
        debts[debt_id] = initial_amount

    paid_by_debt: dict[UUID, int] = {}
    for debt_id, amount in session.execute(
        select(MembershipDebtPayment.debt_id, MembershipDebtPayment.amount_minor)
        .join(MembershipDebt, MembershipDebt.id == MembershipDebtPayment.debt_id)
        .where(MembershipDebt.member_id == member_id)
    ):
        current = paid_by_debt.get(debt_id, 0)
        if type(amount) is not int or amount <= 0 or current > (2**63 - 1) - amount:
            raise ValueError("Member repayment total is outside signed 64-bit minor units.")
        paid_by_debt[debt_id] = current + amount

    remaining_total = 0
    for debt_id, initial_amount in debts.items():
        paid_amount = paid_by_debt.get(debt_id, 0)
        if paid_amount > initial_amount:
            raise ValueError("Recorded repayments exceed an initial membership debt.")
        remaining = initial_amount - paid_amount
        if remaining_total > (2**63 - 1) - remaining:
            raise ValueError("Member pending balance is outside signed 64-bit minor units.")
        remaining_total += remaining
    return remaining_total


class DuplicateMemberNumberError(Exception):
    """Raised when attempting to create a member with an existing member number."""
    pass


def phone_key(phone: str) -> str | None:
    return re.sub(r"[^0-9]", "", phone)[-32:] or None


def create_member(
    session: Session,
    data: CreateMemberDTO,
    actor_id: UUID | str,
    is_admin: bool,
) -> Member:
    """Create a new member with validation and uniqueness enforcement.

    Args:
        session: Active SQLAlchemy session.
        data: DTO containing member attributes to populate.
        actor_id: UUID or string UUID of staff or admin user executing the action.
        is_admin: Whether the acting principal is an administrator.

    Returns:
        The newly persisted Member entity.

    Raises:
        DuplicateMemberNumberError: If a member with the same member_number exists.
    """
    if isinstance(actor_id, str):
        actor_id = UUID(actor_id)

    member_number = data.member_number
    existing = session.scalar(
        select(Member.id).where(Member.member_number == member_number)
    )
    if existing is not None:
        raise DuplicateMemberNumberError(f"Member number '{member_number}' already exists.")
    key = phone_key(data.phone)

    joined_on = data.joined_on if data.joined_on is not None else date.today()
    initial_note = (
        data.initial_notes.strip()
        if (data.initial_notes is not None and data.initial_notes.strip() and is_admin)
        else None
    )

    member = Member(
        member_number=member_number,
        full_name=data.full_name,
        preferred_name=data.preferred_name.strip() if data.preferred_name is not None and data.preferred_name.strip() else None,
        phone=data.phone,
        phone_key=key,
        email=data.email.strip() if data.email is not None and data.email.strip() else None,
        birth_date=data.birth_date,
        emergency_contact_name=(
            data.emergency_contact_name.strip()
            if data.emergency_contact_name is not None and data.emergency_contact_name.strip()
            else None
        ),
        emergency_contact_phone=(
            data.emergency_contact_phone.strip()
            if data.emergency_contact_phone is not None and data.emergency_contact_phone.strip()
            else None
        ),
        photo_url=data.photo_url.strip() if data.photo_url is not None and data.photo_url.strip() else None,
        joined_on=joined_on,
        notes=initial_note,
        status="active",
        credit_balance_minor=0,
    )
    session.add(member)
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise DuplicateMemberNumberError(f"Member number '{member_number}' already exists.") from exc

    if initial_note:
        add_member_note(session, member.id, actor_id, initial_note)

    return member


def update_member(
    session: Session,
    member_id: UUID | str,
    data: UpdateMemberDTO,
) -> Member | None:
    """Update existing member attributes under concurrency row locking.

    Args:
        session: Active SQLAlchemy session.
        member_id: UUID or string UUID of the member to update.
        data: Validated DTO; non-None fields overwrite, while explicit null clears birth_date.

    Returns:
        The updated Member entity, or None if member not found.
    """
    if isinstance(member_id, str):
        try:
            member_id = UUID(member_id)
        except ValueError:
            return None

    stmt = select(Member).where(Member.id == member_id).with_for_update()
    member = session.scalar(stmt)
    if member is None:
        return None

    if data.full_name is not None:
        member.full_name = data.full_name
    if data.preferred_name is not None:
        member.preferred_name = data.preferred_name.strip() if data.preferred_name.strip() else None
    if data.phone is not None:
        key = phone_key(data.phone)
        member.phone = data.phone
        member.phone_key = key
    if data.email is not None:
        member.email = data.email.strip() if data.email.strip() else None
    if "birth_date" in data.model_fields_set:
        member.birth_date = data.birth_date
    if data.emergency_contact_name is not None:
        member.emergency_contact_name = (
            data.emergency_contact_name.strip() if data.emergency_contact_name.strip() else None
        )
    if data.emergency_contact_phone is not None:
        member.emergency_contact_phone = (
            data.emergency_contact_phone.strip() if data.emergency_contact_phone.strip() else None
        )
    if data.photo_url is not None:
        member.photo_url = data.photo_url.strip() if data.photo_url.strip() else None
    if data.status is not None:
        member.status = data.status.strip()

    session.flush()
    return member



# -------------------------------------------------------------------------
# Member Notes Queries & Operations
# -------------------------------------------------------------------------


def add_member_note(
    session: Session,
    member_id: UUID | str,
    author_id: UUID | str,
    body: str,
) -> MemberNote:
    """Add a new restricted note for a member."""
    if isinstance(member_id, str):
        member_id = UUID(member_id)
    if isinstance(author_id, str):
        author_id = UUID(author_id)
    note = MemberNote(
        member_id=member_id,
        author_id=author_id,
        body=body.strip(),
    )
    session.add(note)
    session.flush()
    return note


def list_member_notes(
    session: Session,
    member_id: UUID | str,
    include_voided: bool = False,
) -> list[MemberNote]:
    """List restricted notes for a member, optionally including voided ones."""
    if isinstance(member_id, str):
        try:
            member_id = UUID(member_id)
        except ValueError:
            return []
    stmt = select(MemberNote).where(MemberNote.member_id == member_id)
    if not include_voided:
        stmt = stmt.where(MemberNote.voided_at.is_(None))
    stmt = stmt.order_by(MemberNote.created_at.desc())
    return list(session.scalars(stmt).all())


def void_member_note(
    session: Session,
    note_id: UUID | str,
    voided_by: UUID | str,
) -> MemberNote | None:
    """Soft-delete / void a member note."""
    if isinstance(note_id, str):
        try:
            note_id = UUID(note_id)
        except ValueError:
            return None
    if isinstance(voided_by, str):
        voided_by = UUID(voided_by)
    note = session.get(MemberNote, note_id)
    if note is None:
        return None
    if note.voided_at is None:
        note.voided_at = datetime.now(timezone.utc)
        note.voided_by = voided_by
        session.flush()
    return note


# -------------------------------------------------------------------------
# Member Eligibility Queries & Operations
# -------------------------------------------------------------------------


def add_member_eligibility(
    session: Session,
    member_id: UUID | str,
    eligibility_type: str,
    verified_by: UUID | str,
    valid_until: date | None = None,
    notes: str | None = None,
) -> MemberEligibilityRecord:
    """Add a verified eligibility attestation record for a member."""
    if isinstance(member_id, str):
        member_id = UUID(member_id)
    if isinstance(verified_by, str):
        verified_by = UUID(verified_by)
    record = MemberEligibilityRecord(
        member_id=member_id,
        eligibility_type=eligibility_type.strip(),
        verified_by=verified_by,
        valid_until=valid_until,
        notes=notes.strip() if notes else None,
    )
    session.add(record)
    session.flush()
    return record


def list_member_eligibility(
    session: Session,
    member_id: UUID | str,
    only_active: bool = True,
) -> list[MemberEligibilityRecord]:
    """List eligibility records for a member."""
    if isinstance(member_id, str):
        try:
            member_id = UUID(member_id)
        except ValueError:
            return []
    stmt = select(MemberEligibilityRecord).where(MemberEligibilityRecord.member_id == member_id)
    if only_active:
        stmt = stmt.where(
            MemberEligibilityRecord.revoked_at.is_(None),
            or_(
                MemberEligibilityRecord.valid_until.is_(None),
                MemberEligibilityRecord.valid_until >= func.current_date(),
            ),
        )
    stmt = stmt.order_by(MemberEligibilityRecord.created_at.desc())
    return list(session.scalars(stmt).all())


def revoke_member_eligibility(
    session: Session,
    record_id: UUID | str,
    revoked_by: UUID | str,
) -> MemberEligibilityRecord | None:
    """Revoke an active eligibility record."""
    if isinstance(record_id, str):
        try:
            record_id = UUID(record_id)
        except ValueError:
            return None
    if isinstance(revoked_by, str):
        revoked_by = UUID(revoked_by)
    record = session.get(MemberEligibilityRecord, record_id)
    if record is None:
        return None
    if record.revoked_at is None:
        record.revoked_at = datetime.now(timezone.utc)
        record.revoked_by = revoked_by
        session.flush()
    return record

