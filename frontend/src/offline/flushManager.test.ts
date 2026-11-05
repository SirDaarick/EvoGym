import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalDb, type EvoGymLocalDB, type LocalEvent } from './db';
import { catchUpRosterDelta, flushQueue } from './flushManager';
import * as syncApi from './syncApi';
import * as bootstrap from './bootstrap';

let n = 0;
const uniq = () => `test-flush-db-${Date.now()}-${n++}`;
const dbs: EvoGymLocalDB[] = [];
const open = () => {
  const d = openLocalDb(uniq());
  dbs.push(d);
  return d;
};

afterEach(async () => {
  for (const d of dbs.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
  vi.restoreAllMocks();
});

const sampleEvent = (seq: number, eventId = `EV-${seq}`): LocalEvent => ({
  event_id: eventId,
  seq,
  event_type: 'pos.cash_sale',
  schema_version: 1,
  actor_staff_id: 'staff-1',
  payload: { total_minor: 1000 },
  payload_hash: 'hash-abc',
  client_recorded_at: '2026-11-05T10:00:00Z',
  clock_anchor_utc: null,
  clock_monotonic_delta_ms: null,
  sync_status: 'queued',
  created_at: '2026-11-05T10:00:00Z',
});

describe('flushManager', () => {
  it('returns error when no device token is provisioned', async () => {
    const db = open();
    await db.open();
    await db.local_event_queue.put(sampleEvent(1));

    const result = await flushQueue(db);
    expect(result.flushedCount).toBe(0);
    expect(result.remainingCount).toBe(1);
    expect(result.errors).toContain('No device token provisioned');
  });

  it('performs delta catch-up when queue is empty', async () => {
    const db = open();
    await db.open();
    await db.device.put({ id: 'current', token: 'token-abc' });

    const deltaSpy = vi.spyOn(syncApi, 'getRosterDelta').mockResolvedValueOnce({
      members: [],
      removed_member_ids: [],
      catalog: null,
      registers: [],
      next_cursor: { changed_at: '2026-11-05T10:00:00Z', id: 'm1' },
      has_more: false,
      snapshot_required: false,
    });

    const result = await flushQueue(db);
    expect(result.flushedCount).toBe(0);
    expect(result.remainingCount).toBe(0);
    expect(deltaSpy).toHaveBeenCalled();
  });

  it('flushes queued events and moves accepted ones to receipts table', async () => {
    const db = open();
    await db.open();
    await db.device.put({ id: 'current', token: 'token-abc' });
    await db.local_event_queue.bulkPut([sampleEvent(1, 'EV-1'), sampleEvent(2, 'EV-2')]);

    vi.spyOn(syncApi, 'postContingencyEvents').mockResolvedValueOnce({
      ingested: [
        { event_id: 'EV-1', seq: 1, status: 'accepted' },
        { event_id: 'EV-2', seq: 2, status: 'flagged_audit', reason_code: 'price_mismatch' },
      ],
      last_ingested_seq: 2,
    });

    vi.spyOn(syncApi, 'getRosterDelta').mockResolvedValueOnce({
      members: [],
      removed_member_ids: [],
      catalog: null,
      registers: [],
      next_cursor: { changed_at: '2026-11-05T10:00:00Z', id: 'm2' },
      has_more: false,
      snapshot_required: false,
    });

    const result = await flushQueue(db);
    expect(result.flushedCount).toBe(2);
    expect(result.remainingCount).toBe(0);

    const queuedAfter = await db.local_event_queue.toArray();
    expect(queuedAfter.length).toBe(0);

    const receipts = await db.receipts.toArray();
    expect(receipts.length).toBe(2);
    expect(receipts.map(r => r.event_id)).toEqual(['EV-1', 'EV-2']);
  });

  it('marks rejected events as rejected and keeps them out of queued status', async () => {
    const db = open();
    await db.open();
    await db.device.put({ id: 'current', token: 'token-abc' });
    await db.local_event_queue.put(sampleEvent(1, 'EV-REJ'));

    vi.spyOn(syncApi, 'postContingencyEvents').mockResolvedValueOnce({
      ingested: [
        { event_id: 'EV-REJ', seq: 1, status: 'rejected', reason_code: 'invalid_signature' },
      ],
      last_ingested_seq: 1,
    });

    vi.spyOn(syncApi, 'getRosterDelta').mockResolvedValueOnce({
      members: [],
      removed_member_ids: [],
      catalog: null,
      registers: [],
      next_cursor: { changed_at: '2026-11-05T10:00:00Z', id: 'm3' },
      has_more: false,
      snapshot_required: false,
    });

    const result = await flushQueue(db);
    expect(result.flushedCount).toBe(0);
    expect(result.remainingCount).toBe(0); // 0 in queued status
    expect(result.errors.length).toBe(1);

    const ev = await db.local_event_queue.get('EV-REJ');
    expect(ev?.sync_status).toBe('rejected');
  });

  it('reverts sending events back to queued status on network failure', async () => {
    const db = open();
    await db.open();
    await db.device.put({ id: 'current', token: 'token-abc' });
    await db.local_event_queue.put(sampleEvent(1, 'EV-FAIL'));

    vi.spyOn(syncApi, 'postContingencyEvents').mockRejectedValueOnce(new Error('Network dropped'));

    const result = await flushQueue(db);
    expect(result.flushedCount).toBe(0);
    expect(result.remainingCount).toBe(1);
    expect(result.errors).toContain('Network dropped');

    const ev = await db.local_event_queue.get('EV-FAIL');
    expect(ev?.sync_status).toBe('queued');
  });

  it('triggers full re-bootstrap when delta indicates snapshot_required', async () => {
    const db = open();
    await db.open();
    await db.meta.put({ key: 'branch', value: { id: 'branch-1' } });
    await db.device.put({ id: 'current', token: 'token-abc', devicePrefix: 'DEV-SUR1' });

    vi.spyOn(syncApi, 'getRosterDelta').mockResolvedValueOnce({
      members: [],
      removed_member_ids: [],
      catalog: null,
      registers: [],
      next_cursor: null,
      has_more: false,
      snapshot_required: true,
    });

    const postBootstrapSpy = vi.spyOn(syncApi, 'postBootstrap').mockResolvedValueOnce({
      branch: { id: 'branch-1', code: 'SUR', name: 'Sur', timezone: 'America/Mexico_City' },
      device: { device_id: 'd1', device_prefix: 'DEV-SUR1', token: 'new-token', expires_at: '2026-11-06T00:00:00Z', next_seq: 1 },
      offline_grant_ttl_hours: 24,
      server_time: '2026-11-05T10:00:00Z',
      cursor: null,
      roster: [],
      catalog: [],
      registers: [],
    });

    const applyBootstrapSpy = vi.spyOn(bootstrap, 'applyBootstrapSnapshot').mockResolvedValueOnce(undefined);

    await catchUpRosterDelta(db, 'token-abc');
    expect(postBootstrapSpy).toHaveBeenCalled();
    expect(applyBootstrapSpy).toHaveBeenCalled();
  });
});
