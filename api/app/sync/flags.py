"""Helpers for creating, listing, and resolving sync audit flags (T5.7, T5.9)."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.sync import FLAG_KINDS, SyncAuditFlag


class AuditFlagDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    event_row_id: str
    branch_id: str
    shift_id: str | None = None
    kind: str
    details: dict
    created_at: str
    resolved_at: str | None = None
    resolved_by: str | None = None


def flag_to_dto(flag: SyncAuditFlag) -> AuditFlagDTO:
    return AuditFlagDTO(
        id=str(flag.id),
        event_row_id=str(flag.event_row_id),
        branch_id=str(flag.branch_id),
        shift_id=str(flag.shift_id) if flag.shift_id else None,
        kind=flag.kind,
        details=flag.details or {},
        created_at=flag.created_at.isoformat() if flag.created_at else "",
        resolved_at=flag.resolved_at.isoformat() if flag.resolved_at else None,
        resolved_by=str(flag.resolved_by) if flag.resolved_by else None,
    )


def raise_flag(
    session: Session,
    *,
    event_row_id: UUID,
    branch_id: UUID,
    shift_id: UUID | None,
    kind: str,
    details: dict | None = None,
    now: datetime | None = None,
) -> SyncAuditFlag:
    if kind not in FLAG_KINDS:
        raise ValueError(f"Invalid flag kind: {kind}")
    current_time = now or datetime.now(timezone.utc)
    flag = SyncAuditFlag(
        event_row_id=event_row_id,
        branch_id=branch_id,
        shift_id=shift_id,
        kind=kind,
        details=details or {},
        created_at=current_time,
    )
    session.add(flag)
    session.flush()
    return flag


def list_flags(
    session: Session,
    *,
    branch_id: UUID | None = None,
    shift_id: UUID | None = None,
    open_only: bool = True,
    limit: int = 100,
) -> list[SyncAuditFlag]:
    stmt = select(SyncAuditFlag)
    if branch_id is not None:
        stmt = stmt.where(SyncAuditFlag.branch_id == branch_id)
    if shift_id is not None:
        stmt = stmt.where(SyncAuditFlag.shift_id == shift_id)
    if open_only:
        stmt = stmt.where(SyncAuditFlag.resolved_at.is_(None))
    stmt = stmt.order_by(SyncAuditFlag.created_at.desc()).limit(limit)
    return list(session.scalars(stmt).all())


def resolve_flag(
    session: Session,
    flag_id: UUID,
    *,
    resolved_by: UUID,
    now: datetime | None = None,
) -> SyncAuditFlag:
    flag = session.get(SyncAuditFlag, flag_id)
    if flag is None:
        raise HTTPException(404, "Audit flag not found.")
    if flag.resolved_at is not None:
        return flag  # already resolved
    flag.resolved_at = now or datetime.now(timezone.utc)
    flag.resolved_by = resolved_by
    session.flush()
    return flag
