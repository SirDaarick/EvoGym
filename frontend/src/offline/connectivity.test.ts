import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectivity } from './connectivity';
import { openLocalDb, type EvoGymLocalDB } from './db';
import * as syncApi from './syncApi';

let n = 0;
const uniq = () => `test-conn-db-${Date.now()}-${n++}`;
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

describe('connectivity detector and heartbeat', () => {
  it('reports initial online status and notifies subscribers', () => {
    const states: boolean[] = [];
    const unsub = connectivity.subscribe(online => {
      states.push(online);
    });

    expect(states.length).toBeGreaterThanOrEqual(1);
    expect(states[0]).toBe(connectivity.isOnline);
    unsub();
  });

  it('checks online status using navigator.onLine when no device token exists', async () => {
    const db = open();
    await db.open();

    const isOnline = await connectivity.check(db);
    expect(isOnline).toBe(typeof navigator !== 'undefined' ? navigator.onLine : true);
  });

  it('performs heartbeat check when device token exists and records server_time', async () => {
    const db = open();
    await db.open();
    await db.device.put({ id: 'current', token: 'device-token-123' });

    vi.spyOn(syncApi, 'getSyncStatus').mockResolvedValueOnce({
      server_time: '2026-11-05T12:00:00Z',
      open_audit_flags_count: 0,
      pending_contingency_events_count: 0,
      device: {
        device_id: 'd1',
        device_prefix: 'DEV-SUR1',
        last_ingested_seq: 1,
        expires_at: '2026-11-06T00:00:00Z',
      },
    });

    const isOnline = await connectivity.check(db);
    expect(isOnline).toBe(true);

    const serverTimeMeta = await db.meta.get('server_time');
    expect(serverTimeMeta?.value).toBe('2026-11-05T12:00:00Z');
  });

  it('marks as offline when heartbeat request fails', async () => {
    const db = open();
    await db.open();
    await db.device.put({ id: 'current', token: 'device-token-123' });

    vi.spyOn(syncApi, 'getSyncStatus').mockRejectedValueOnce(new Error('Network failure'));

    const isOnline = await connectivity.check(db);
    expect(isOnline).toBe(false);
    expect(connectivity.isOnline).toBe(false);
  });

  it('starts monitoring and cleans up listeners', () => {
    const db = open();
    const cleanup = connectivity.startMonitoring(db, 60000);
    expect(typeof cleanup).toBe('function');
    cleanup?.();
  });
});
