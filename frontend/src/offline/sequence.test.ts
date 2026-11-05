import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDb, type EvoGymLocalDB } from './db';
import { allocateEventId, formatEventId } from './sequence';

let n = 0;
const dbs: EvoGymLocalDB[] = [];
const open = (name: string) => { const d = openLocalDb(name); dbs.push(d); return d; };
const uniq = () => `seq-db-${Date.now()}-${n++}`;
afterEach(async () => { for (const d of dbs.splice(0)) { d.close(); await Dexie.delete(d.name); } });

describe('allocateEventId', () => {
  it('formats REC-SUR1-00001 and increments', async () => {
    const db = open(uniq());
    expect(await allocateEventId(db, 'REC-SUR1')).toEqual({ event_id: 'REC-SUR1-00001', seq: 1 });
    expect((await allocateEventId(db, 'REC-SUR1')).seq).toBe(2);
  });
  it('starts from device.next_seq and allows more than 5 digits', async () => {
    const db = open(uniq());
    await db.device.put({ id: 'current', next_seq: 123 });
    expect((await allocateEventId(db, 'REC-SUR1')).event_id).toBe('REC-SUR1-00123');
    expect(formatEventId('REC-SUR1', 123456)).toBe('REC-SUR1-123456');
  });
  it('has no duplicates under concurrency', async () => {
    const db = open(uniq());
    const r = await Promise.all(Array.from({ length: 50 }, () => allocateEventId(db, 'REC-SUR1')));
    const seqs = r.map((x) => x.seq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(50);
    expect(seqs[0]).toBe(1);
    expect(seqs[49]).toBe(50);
  });
  it('has no duplicates across two Dexie instances (tabs)', async () => {
    const name = uniq();
    const a = open(name);
    const b = open(name);
    const r = await Promise.all(Array.from({ length: 40 }, (_, i) => allocateEventId(i % 2 ? a : b, 'REC-SUR1')));
    expect(new Set(r.map((x) => x.event_id)).size).toBe(40);
  });
});
