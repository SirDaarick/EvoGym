/**
 * Background sync queue flusher with Web Lock 'evogym-flush' and delta catch-up (T5.10).
 */

import { applyBootstrapSnapshot } from './bootstrap';
import type { EvoGymLocalDB, LocalEvent } from './db';
import { applyRosterDelta } from './rosterDelta';
import {
  getRosterDelta,
  postBootstrap,
  postContingencyEvents,
  type ContingencyEventIn,
  type IngestBatchResponse,
} from './syncApi';

const FLUSH_LOCK_NAME = 'evogym-flush';
const BATCH_SIZE = 50;

export interface FlushResult {
  flushedCount: number;
  remainingCount: number;
  errors: string[];
}

function toContingencyEventIn(ev: LocalEvent): ContingencyEventIn {
  return {
    event_id: ev.event_id,
    seq: ev.seq,
    event_type: ev.event_type as ContingencyEventIn['event_type'],
    schema_version: ev.schema_version,
    actor_staff_id: ev.actor_staff_id,
    payload: ev.payload as Record<string, unknown>,
    payload_hash: ev.payload_hash,
    client_recorded_at: ev.client_recorded_at,
    clock_anchor_utc: ev.clock_anchor_utc,
    clock_monotonic_delta_ms: ev.clock_monotonic_delta_ms,
  };
}

export async function flushQueue(db: EvoGymLocalDB): Promise<FlushResult> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks?.request) {
    let result: FlushResult = { flushedCount: 0, remainingCount: 0, errors: [] };
    await locks.request(FLUSH_LOCK_NAME, { ifAvailable: true }, async lock => {
      if (!lock) {
        // Another tab is flushing right now
        const count = await db.local_event_queue.where('sync_status').equals('queued').count();
        result = { flushedCount: 0, remainingCount: count, errors: [] };
        return;
      }
      result = await executeFlush(db);
    });
    return result;
  }
  return executeFlush(db);
}

async function executeFlush(db: EvoGymLocalDB): Promise<FlushResult> {
  const dev = await db.device.get('current');
  if (!dev?.token) {
    const count = await db.local_event_queue.where('sync_status').equals('queued').count();
    return { flushedCount: 0, remainingCount: count, errors: ['No device token provisioned'] };
  }

  // 1. Fetch queued events in strict seq order
  const queued = await db.local_event_queue
    .where('sync_status')
    .equals('queued')
    .sortBy('seq');

  if (queued.length === 0) {
    // No events to upload, perform roster delta catch-up
    await catchUpRosterDelta(db, dev.token);
    return { flushedCount: 0, remainingCount: 0, errors: [] };
  }

  const batch = queued.slice(0, BATCH_SIZE);
  const errors: string[] = [];
  let flushedCount = 0;

  // Mark as sending
  for (const ev of batch) {
    await db.local_event_queue.update(ev.event_id, { sync_status: 'sending' });
  }

  try {
    const payload = { events: batch.map(toContingencyEventIn) };
    const res: IngestBatchResponse = await postContingencyEvents(payload, dev.token);

    for (const item of res.ingested) {
      if (item.status === 'accepted' || item.status === 'flagged_audit') {
        // Record receipt and delete from active queue
        await db.receipts.put({
          event_id: item.event_id,
          seq: item.seq,
          status: item.status,
          reason_code: item.reason_code || null,
          acknowledged_at: new Date().toISOString(),
        });
        await db.local_event_queue.delete(item.event_id);
        flushedCount++;
      } else if (item.status === 'rejected') {
        // Event rejected by server, flag as rejected so it doesn't block future syncs
        await db.local_event_queue.update(item.event_id, {
          sync_status: 'rejected',
          receipt: { status: 'rejected', reason: item.reason_code || undefined },
        });
        errors.push(`Event ${item.event_id} rejected: ${item.reason_code}`);
      }
    }

    // Catch-up delta after successful flush
    await catchUpRosterDelta(db, dev.token);
  } catch (err) {
    // Network or server error: revert sending back to queued
    for (const ev of batch) {
      await db.local_event_queue.update(ev.event_id, { sync_status: 'queued' });
    }
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const remaining = await db.local_event_queue.where('sync_status').equals('queued').count();
  return { flushedCount, remainingCount: remaining, errors };
}

export async function catchUpRosterDelta(db: EvoGymLocalDB, token: string): Promise<void> {
  try {
    const cursorRow = await db.meta.get('last_roster_cursor');
    const cursorStr = typeof cursorRow?.value === 'string' ? cursorRow.value : null;

    const delta = await getRosterDelta({ cursor: cursorStr, limit: 500 }, token);

    if (delta.snapshot_required) {
      // Re-bootstrap
      const branchRow = await db.meta.get('branch');
      const branchId = (branchRow?.value as { id?: string })?.id;
      const dev = await db.device.get('current');
      const stationCode = dev?.devicePrefix?.split('-')[1] || 'SUR1';

      const snapshot = await postBootstrap({ station_code: stationCode }, token, branchId);
      await applyBootstrapSnapshot(db, snapshot);
    } else {
      await applyRosterDelta(db, delta);
    }
  } catch {
    // Ignore delta catch-up errors during offline operations
  }
}
