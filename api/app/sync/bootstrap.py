"""Sync bootstrap snapshot creation and sync status service (T5.4, T5.10)."""

from datetime import date, datetime, timezone
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.db.models.authorization import Branch
from app.db.models.members import Member
from app.db.models.sync import SyncDevice
from app.settings import Settings
from app.sync.devices import next_seq, provision_device
from app.sync.roster import (
    CatalogItemDTO,
    RegisterDTO,
    RosterRow,
    _aware_utc,
    build_roster_row,
    get_branch_catalog,
    get_branch_registers,
)


class SyncCursorDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    changed_at: str
    id: str


class BootstrapDeviceDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_id: str
    device_prefix: str
    token: str
    expires_at: str
    next_seq: int


class BranchInfoDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    code: str
    name: str
    timezone: str


class BootstrapResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device: BootstrapDeviceDTO
    server_time: str
    offline_grant_ttl_hours: int
    branch: BranchInfoDTO
    roster: list[RosterRow]
    catalog: list[CatalogItemDTO]
    registers: list[RegisterDTO]
    cursor: SyncCursorDTO | None = None


class SyncStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    server_time: str
    branch_active: bool
    device_expires_at: str
    snapshot_required: bool
    min_client_schema_version: int


def build_bootstrap_snapshot(
    session: Session,
    *,
    branch_id: UUID,
    station_code: str,
    reception_station_id: UUID | None,
    provisioned_by: UUID,
    rotate: bool,
    settings: Settings,
    now: datetime | None = None,
) -> BootstrapResponse:
    current_time = now or datetime.now(timezone.utc)
    branch = session.get(Branch, branch_id)
    if branch is None or not branch.is_active:
        raise ValueError("branch_not_found_or_inactive")

    # 1. Provision / rotate device token
    device, raw_token = provision_device(
        session,
        branch_id=branch_id,
        station_code=station_code,
        reception_station_id=reception_station_id,
        provisioned_by=provisioned_by,
        ttl_days=settings.sync_device_token_ttl_days,
        rotate=rotate,
        now=current_time,
    )

    # 2. Build roster
    today = current_time.date()
    members = session.scalars(Member.select_all_query() if hasattr(Member, "select_all_query") else Member.__table__.select()).all() if False else session.query(Member).all()
    roster_rows: list[RosterRow] = []
    max_cursor_dt: datetime | None = None
    last_member_id: str = ""

    for m in members:
        row, dt = build_roster_row(session, m, branch_id, today)
        if row is not None:
            roster_rows.append(row)
            if max_cursor_dt is None or dt > max_cursor_dt:
                max_cursor_dt = dt
                last_member_id = row.member_id

    cursor = None
    if max_cursor_dt is not None:
        cursor = SyncCursorDTO(changed_at=max_cursor_dt.isoformat(), id=last_member_id)

    # 3. Build catalog and registers
    catalog = get_branch_catalog(session, branch_id)
    registers = get_branch_registers(session, branch_id)

    session.commit()

    return BootstrapResponse(
        device=BootstrapDeviceDTO(
            device_id=str(device.id),
            device_prefix=device.device_prefix,
            token=raw_token,
            expires_at=_aware_utc(device.expires_at).isoformat(),
            next_seq=next_seq(device),
        ),
        server_time=_aware_utc(current_time).isoformat(),
        offline_grant_ttl_hours=settings.sync_offline_grant_ttl_hours,
        branch=BranchInfoDTO(
            id=str(branch.id),
            code=branch.code,
            name=branch.name,
            timezone=branch.timezone,
        ),
        roster=roster_rows,
        catalog=catalog,
        registers=registers,
        cursor=cursor,
    )


def get_sync_status(
    session: Session, device: SyncDevice, settings: Settings, now: datetime | None = None
) -> SyncStatusResponse:
    current_time = now or datetime.now(timezone.utc)
    branch = session.get(Branch, device.branch_id)
    branch_active = branch.is_active if branch else False

    return SyncStatusResponse(
        server_time=_aware_utc(current_time).isoformat(),
        branch_active=branch_active,
        device_expires_at=_aware_utc(device.expires_at).isoformat(),
        snapshot_required=False,
        min_client_schema_version=1,
    )
