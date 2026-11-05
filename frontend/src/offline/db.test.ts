import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EvoGymLocalDB, isStorageHealthy, markStorageUnhealthy, openLocalDb, OfflineStorageError,
  requestPersistentStorage, safeWrite, type LocalEvent,
} from './db';

let n = 0;
const uniq = () => `test-db-${Date.now()}-${n++}`;
const dbs: EvoGymLocalDB[] = [];
const open = (name = uniq()) => { const d = openLocalDb(name); dbs.push(d); return d; };
afterEach(async () => { for (const d of dbs.splice(0)) { d.close(); await Dexie.delete(d.name); } });

const ev = (seq: number): LocalEvent => ({
  event_id: `REC-SUR1-${String(seq).padStart(5, '0')}`, seq, event_type: 'pos.cash_sale', schema_version: 1,
  actor_staff_id: 's1', payload: { a: 1 }, payload_hash: 'h', client_recorded_at: '2026-11-05T18:00:00.000Z',
  clock_anchor_utc: null, clock_monotonic_delta_ms: null, sync_status: 'queued', created_at: '2026-11-05T18:00:00.000Z',
});

describe('EvoGymLocalDB', () => {
  it('opens with all tables', async () => {
    const db = open();
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'catalog', 'device', 'local_check_ins', 'local_event_queue', 'members', 'meta',
      'offline_credentials', 'receipts', 'registers', 'shift_state',
    ]);
  });
  it('keeps queue rows after reopen', async () => {
    const name = uniq();
    const a = open(name);
    await a.local_event_queue.add(ev(1));
    a.close();
    const b = open(name);
    expect((await b.local_event_queue.get('REC-SUR1-00001'))?.seq).toBe(1);
  });
  it('defaults to healthy and can be marked unhealthy', async () => {
    const db = open();
    expect(await isStorageHealthy(db)).toBe(true);
    await markStorageUnhealthy(db);
    expect(await isStorageHealthy(db)).toBe(false);
    expect((await db.meta.get('storageHealthy'))?.value).toBe(false);
  });
  it('safeWrite converts quota errors into OfflineStorageError and flags storage', async () => {
    const db = open();
    const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    await expect(safeWrite(db, async () => { throw quota; })).rejects.toBeInstanceOf(OfflineStorageError);
    expect(await isStorageHealthy(db)).toBe(false);
  });
  it('safeWrite detects quota errors nested in Dexie inner and passes others through', async () => {
    const db = open();
    const inner = Object.assign(new Error('x'), { name: 'QuotaExceededError' });
    const wrapped = Object.assign(new Error('wrap'), { name: 'AbortError', inner });
    await expect(safeWrite(db, async () => { throw wrapped; })).rejects.toBeInstanceOf(OfflineStorageError);
    const db2 = open();
    await expect(safeWrite(db2, async () => { throw new TypeError('nope'); })).rejects.toBeInstanceOf(TypeError);
    expect(await isStorageHealthy(db2)).toBe(true);
  });
  it('requestPersistentStorage is safe without or with failing API', async () => {
    const orig = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
    expect(await requestPersistentStorage()).toBe(false);
    Object.defineProperty(navigator, 'storage', { value: { persist: vi.fn().mockResolvedValue(true) }, configurable: true });
    expect(await requestPersistentStorage()).toBe(true);
    Object.defineProperty(navigator, 'storage', { value: { persist: vi.fn().mockRejectedValue(new Error('x')) }, configurable: true });
    expect(await requestPersistentStorage()).toBe(false);
    if (orig) Object.defineProperty(navigator, 'storage', orig); else delete (navigator as unknown as Record<string, unknown>).storage;
  });
});
