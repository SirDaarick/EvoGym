"""Sync delta queries for incremental roster and catalog catch-up (T5.6)."""

from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.inventory import Product
from app.db.models.members import Member
from app.db.models.sync import SyncDevice
from app.settings import Settings
from app.sync.bootstrap import SyncCursorDTO
from app.sync.roster import (
    CatalogItemDTO,
    RegisterDTO,
    RosterRow,
    _aware_utc,
    build_roster_row,
    get_branch_catalog,
    get_branch_registers,
)


class RosterDeltaResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    members: list[RosterRow]
    removed_member_ids: list[str]
    catalog: list[CatalogItemDTO] | None = None
    registers: list[RegisterDTO]
    next_cursor: SyncCursorDTO | None = None
    has_more: bool
    snapshot_required: bool


def parse_cursor(cursor_str: str | None) -> tuple[datetime | None, str | None]:
    if not cursor_str:
        return None, None
    parts = cursor_str.split("|", 1)
    if len(parts) != 2:
        return None, None
    try:
        dt_str = parts[0].strip()
        if " " in dt_str and "+" not in dt_str:
            last_space = dt_str.rfind(" ")
            dt_str = dt_str[:last_space] + "+" + dt_str[last_space + 1 :]
        dt = datetime.fromisoformat(dt_str)
        return _aware_utc(dt), parts[1].strip()
    except Exception:
        return None, None


def build_roster_delta(
    session: Session,
    device: SyncDevice,
    cursor_str: str | None,
    limit: int,
    settings: Settings,
    now: datetime | None = None,
) -> RosterDeltaResponse:
    current_time = now or datetime.now(timezone.utc)
    registers = get_branch_registers(session, device.branch_id)

    # 1. Parse and validate cursor
    cursor_dt, cursor_id = parse_cursor(cursor_str)
    if cursor_dt is None or cursor_id is None:
        return RosterDeltaResponse(
            members=[],
            removed_member_ids=[],
            catalog=None,
            registers=registers,
            next_cursor=None,
            has_more=False,
            snapshot_required=True,
        )

    # 2. Check maximum cursor age
    max_age = timedelta(days=settings.sync_delta_max_age_days)
    if cursor_dt < (current_time - max_age):
        return RosterDeltaResponse(
            members=[],
            removed_member_ids=[],
            catalog=None,
            registers=registers,
            next_cursor=None,
            has_more=False,
            snapshot_required=True,
        )

    # 3. Query all members changed since cursor
    today = current_time.date()
    all_members = session.query(Member).order_by(Member.id).all()
    changed_candidates: list[tuple[RosterRow | None, datetime, str]] = []

    for m in all_members:
        row, dt = build_roster_row(session, m, device.branch_id, today)
        m_id = str(m.id)
        # Compare (dt, m_id) > (cursor_dt, cursor_id)
        if dt > cursor_dt or (dt == cursor_dt and m_id > cursor_id):
            changed_candidates.append((row, dt, m_id))

    # Sort candidates by (dt, m_id)
    changed_candidates.sort(key=lambda item: (item[1], item[2]))

    # Paginate with limit
    has_more = len(changed_candidates) > limit
    page = changed_candidates[:limit]

    members: list[RosterRow] = []
    removed_ids: list[str] = []
    last_cursor: SyncCursorDTO | None = None

    for row, dt, m_id in page:
        last_cursor = SyncCursorDTO(changed_at=dt.isoformat(), id=m_id)
        if row is not None:
            members.append(row)
        else:
            removed_ids.append(m_id)

    # 4. Check if catalog changed since cursor_dt
    catalog = None
    any_prod_changed = session.scalar(
        select(Product.id).where(Product.updated_at > cursor_dt).limit(1)
    )
    if any_prod_changed is not None:
        catalog = get_branch_catalog(session, device.branch_id)

    return RosterDeltaResponse(
        members=members,
        removed_member_ids=removed_ids,
        catalog=catalog,
        registers=registers,
        next_cursor=last_cursor or SyncCursorDTO(changed_at=cursor_dt.isoformat(), id=cursor_id),
        has_more=has_more,
        snapshot_required=False,
    )
