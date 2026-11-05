"""Sync delta endpoint for incremental catch-up (T5.6)."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import SessionDep, SettingsDep
from app.sync.delta import RosterDeltaResponse, build_roster_delta
from app.sync.devices import SyncDeviceDep

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])


@router.get("/roster-delta", response_model=RosterDeltaResponse)
def sync_roster_delta(
    device: SyncDeviceDep,
    session: SessionDep,
    settings: SettingsDep,
    cursor: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
) -> RosterDeltaResponse:
    return build_roster_delta(
        session,
        device=device,
        cursor_str=cursor,
        limit=limit,
        settings=settings,
    )
