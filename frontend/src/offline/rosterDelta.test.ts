import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBootstrapSnapshot } from './bootstrap';
import { openLocalDb, type EvoGymLocalDB } from './db';
import { applyRosterDelta } from './rosterDelta';
import type { BootstrapResponse, RosterDeltaResponse } from './syncApi';

let n = 0;
const uniq = () => `test-delta-${Date.now()}-${n++}`;
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
});

const baseSnapshot: BootstrapResponse = {
  device: {
    device_id: 'dev-1',
    device_prefix: 'REC-SUR1',
    token: 'tok',
    expires_at: '2026-12-01T00:00:00.000Z',
    next_seq: 1,
  },
  server_time: '2026-11-05T12:00:00.000Z',
  offline_grant_ttl_hours: 24,
  branch: { id: 'b-1', code: 'sur', name: 'Sur', timezone: 'America/Mexico_City' },
  roster: [
    {
      member_id: 'm-1',
      member_number: '1001',
      full_name: 'Member One',
      phone_last4: '1111',
      status: 'active',
      active_periods: [],
      has_debt: false,
      changed_at: '2026-11-05T10:00:00.000Z',
    },
    {
      member_id: 'm-2',
      member_number: '1002',
      full_name: 'Member Two',
      phone_last4: '2222',
      status: 'active',
      active_periods: [],
      has_debt: false,
      changed_at: '2026-11-05T10:00:00.000Z',
    },
  ],
  catalog: [
    {
      product_id: 'p-1',
      code: 'barrita',
      name: 'Barra Proteica',
      unit: 'pieza',
      price_minor: 3500,
      is_active: true,
      on_hand: 10,
    },
  ],
  registers: [],
  cursor: { changed_at: '2026-11-05T10:00:00.000Z', id: 'm-2' },
};

describe('applyRosterDelta', () => {
  it('returns snapshotRequired when delta asks for full snapshot', async () => {
    const db = open();
    const result = await applyRosterDelta(db, {
      members: [],
      removed_member_ids: [],
      registers: [],
      has_more: false,
      snapshot_required: true,
    });
    expect(result.snapshotRequired).toBe(true);
  });

  it('updates members, removes deleted members and updates cursor', async () => {
    const db = open();
    await applyBootstrapSnapshot(db, baseSnapshot);

    const delta: RosterDeltaResponse = {
      members: [
        {
          member_id: 'm-1',
          member_number: '1001',
          full_name: 'Member One Modified',
          phone_last4: '9999',
          status: 'active',
          active_periods: [],
          has_debt: true,
          changed_at: '2026-11-05T11:00:00.000Z',
        },
        {
          member_id: 'm-3',
          member_number: '1003',
          full_name: 'Member Three New',
          phone_last4: '3333',
          status: 'active',
          active_periods: [],
          has_debt: false,
          changed_at: '2026-11-05T11:00:00.000Z',
        },
      ],
      removed_member_ids: ['m-2'],
      catalog: null,
      registers: [],
      next_cursor: { changed_at: '2026-11-05T11:00:00.000Z', id: 'm-3' },
      has_more: false,
      snapshot_required: false,
    };

    const res = await applyRosterDelta(db, delta);
    expect(res.snapshotRequired).toBe(false);
    expect(res.appliedMembersCount).toBe(2);
    expect(res.removedMembersCount).toBe(1);

    // m-2 should be removed
    expect(await db.members.get('m-2')).toBeUndefined();

    // m-1 should be updated
    const m1 = await db.members.get('m-1');
    expect(m1?.full_name).toBe('Member One Modified');
    expect(m1?.has_debt).toBe(true);

    // m-3 should be inserted
    const m3 = await db.members.get('m-3');
    expect(m3?.member_number).toBe('1003');

    // cursor should be updated
    const cursor = await db.meta.get('last_roster_cursor');
    expect(cursor?.value).toBe('2026-11-05T11:00:00.000Z|m-3');
  });
});
