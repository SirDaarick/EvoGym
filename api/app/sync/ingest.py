"""Ingestion pipeline for contingency event batches (T5.7)."""

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.audit import AuditEvent
from app.db.models.sync import ContingencyEvent, SyncDevice
from app.settings import Settings
from app.sync.envelope import ContingencyBatchIn, parse_payload, payload_hash
from app.sync.reconcile import reconcile_event


class IngestedEventDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str
    seq: int
    status: Literal["accepted", "flagged_audit", "rejected"]
    reason_code: str | None = None


class IngestBatchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ingested: list[IngestedEventDTO]
    last_ingested_seq: int


def ingest_batch(
    session: Session,
    device: SyncDevice,
    batch: ContingencyBatchIn,
    settings: Settings,
    now: datetime | None = None,
) -> IngestBatchResponse:
    current_time = now or datetime.now(timezone.utc)
    results: list[IngestedEventDTO] = []

    for event in batch.events:
        # 1. Device prefix match
        if event.device_prefix != device.device_prefix:
            raise HTTPException(
                422,
                f"event_id prefix {event.device_prefix} does not match registered device prefix {device.device_prefix}",
            )

        # 2. Payload hash verification
        computed_hash = payload_hash(event.payload)
        if computed_hash != event.payload_hash:
            raise HTTPException(
                422,
                f"payload_hash mismatch for event {event.event_id}: computed {computed_hash}, got {event.payload_hash}",
            )

        # 3. Payload schema validation
        try:
            parse_payload(event.event_type, event.payload)
        except Exception as exc:
            raise HTTPException(422, f"Invalid payload for {event.event_type}: {exc}")

        # 4. Check for idempotent replay
        existing = session.scalar(
            select(ContingencyEvent).where(ContingencyEvent.event_id == event.event_id)
        )
        if existing is not None:
            results.append(
                IngestedEventDTO(
                    event_id=existing.event_id,
                    seq=existing.seq,
                    status=existing.status,  # type: ignore[arg-type]
                    reason_code=existing.reason_code,
                )
            )
            continue

        # 5. Strictly sequential sequence check per device
        expected_seq = device.last_ingested_seq + 1
        if event.seq != expected_seq:
            raise HTTPException(
                409,
                f"Sequence gap or regression for device {device.device_prefix}: expected seq {expected_seq}, got {event.seq}",
            )

        # 6. Insert contingency event journal row
        row = ContingencyEvent(
            device_id=device.id,
            event_id=event.event_id,
            seq=event.seq,
            event_type=event.event_type,
            schema_version=event.schema_version,
            actor_staff_id=event.actor_staff_id,
            payload=event.payload,
            payload_hash=event.payload_hash,
            client_recorded_at=event.client_recorded_at,
            clock_anchor_utc=event.clock_anchor_utc,
            clock_monotonic_delta_ms=event.clock_monotonic_delta_ms,
            server_received_at=current_time,
            status="accepted",
        )
        session.add(row)
        session.flush()

        # 7. Audit log event
        audit = AuditEvent(
            actor_id=event.actor_staff_id,
            branch_id=device.branch_id,
            action="sync_ingest",
            request_id=uuid4(),
            occurred_at=current_time,
        )
        session.add(audit)

        # 8. Reconcile domain effects & flags
        reconcile_event(session, device, row, settings, now=current_time)

        # 9. Advance device watermark
        device.last_ingested_seq = event.seq
        device.last_seen_at = current_time
        session.flush()

        results.append(
            IngestedEventDTO(
                event_id=row.event_id,
                seq=row.seq,
                status=row.status,  # type: ignore[arg-type]
                reason_code=row.reason_code,
            )
        )

    session.commit()

    return IngestBatchResponse(
        ingested=results,
        last_ingested_seq=device.last_ingested_seq,
    )
