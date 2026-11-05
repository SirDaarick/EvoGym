"""Sync events router for offline contingency event ingestion (T5.7)."""

from fastapi import APIRouter

from app.api.deps import SessionDep, SettingsDep
from app.sync.devices import SyncDeviceDep
from app.sync.envelope import ContingencyBatchIn
from app.sync.ingest import IngestBatchResponse, ingest_batch

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])


@router.post("/contingency-events", response_model=IngestBatchResponse)
def upload_contingency_events(
    device: SyncDeviceDep,
    session: SessionDep,
    settings: SettingsDep,
    batch: ContingencyBatchIn,
) -> IngestBatchResponse:
    return ingest_batch(session, device, batch, settings)
