import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDb, type EvoGymLocalDB } from './db';
import { dispatch } from './dispatcher';

let n = 0;
const uniq = () => `test-dispatch-${Date.now()}-${n++}`;
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

describe('local command dispatcher', () => {
  it('rejects online-only commands', async () => {
    const db = open();
    await expect(
      dispatch(
        db,
        { type: 'membership.sale' as any, payload: {} as any },
        'staff-1',
      ),
    ).rejects.toThrow('Requiere internet');
  });

  it('dispatches check-in and records in local_check_ins', async () => {
    const db = open();
    await db.device.put({ id: 'current', devicePrefix: 'REC-SUR1', next_seq: 1 });

    const res = await dispatch(
      db,
      {
        type: 'attendance.check_in',
        payload: {
          member_id: 'm-123',
          period_id: 'p-456',
          branch_id: 'b-789',
          local_access_decision: 'valid',
        },
      },
      'staff-1',
    );

    expect(res.success).toBe(true);
    expect(res.eventId).toBe('REC-SUR1-00001');
    expect(res.seq).toBe(1);

    // Verify written to local_event_queue
    const queued = await db.local_event_queue.get(res.eventId);
    expect(queued?.sync_status).toBe('queued');
    expect(queued?.actor_staff_id).toBe('staff-1');

    // Verify optimistic check_in
    const localCheckIns = await db.local_check_ins.where('member_id').equals('m-123').toArray();
    expect(localCheckIns.length).toBe(1);
  });

  it('dispatches cash sale and optimistically deducts stock', async () => {
    const db = open();
    await db.device.put({ id: 'current', devicePrefix: 'REC-SUR1', next_seq: 1 });
    await db.catalog.put({
      product_id: 'prod-1',
      code: 'agua',
      name: 'Agua',
      unit: 'pieza',
      price_minor: 1500,
      is_active: true,
      on_hand: 20,
    });

    const res = await dispatch(
      db,
      {
        type: 'pos.cash_sale',
        payload: {
          register_id: 'reg-1',
          local_shift_ref: 'shift-1',
          items: [{ product_id: 'prod-1', quantity: 3, unit_price_minor: 1500 }],
          total_minor: 4500,
        },
      },
      'staff-1',
    );

    expect(res.success).toBe(true);
    expect(res.eventId).toBe('REC-SUR1-00001');

    // Verify optimistic stock reduction
    const p = await db.catalog.get('prod-1');
    expect(p?.on_hand).toBe(17);
  });
});
