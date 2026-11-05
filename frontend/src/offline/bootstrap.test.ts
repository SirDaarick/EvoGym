import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBootstrapSnapshot, tokenizeName, toMemberRow } from './bootstrap';
import { openLocalDb, type EvoGymLocalDB } from './db';
import type { BootstrapResponse } from './syncApi';

let n = 0;
const uniq = () => `test-boot-${Date.now()}-${n++}`;
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

const sampleSnapshot: BootstrapResponse = {
  device: {
    device_id: 'dev-1',
    device_prefix: 'REC-SUR1',
    token: 'test-token-xyz',
    expires_at: '2026-12-01T00:00:00.000Z',
    next_seq: 10,
  },
  server_time: '2026-11-05T12:00:00.000Z',
  offline_grant_ttl_hours: 24,
  branch: {
    id: 'b-1',
    code: 'sur',
    name: 'Sur',
    timezone: 'America/Mexico_City',
  },
  roster: [
    {
      member_id: 'm-1',
      member_number: '1001',
      full_name: 'Maria Perez Lopez',
      phone_last4: '1234',
      status: 'active',
      active_periods: [
        {
          period_id: 'p-1',
          starts_on: '2026-11-01',
          ends_on: '2026-12-01',
          access: 'valid',
        },
      ],
      has_debt: false,
      changed_at: '2026-11-05T10:00:00.000Z',
    },
  ],
  catalog: [
    {
      product_id: 'prod-1',
      code: 'agua',
      name: 'Agua 500ml',
      unit: 'pieza',
      price_minor: 1500,
      is_active: true,
      on_hand: 25,
    },
  ],
  registers: [
    {
      register_id: 'reg-1',
      name: 'Caja Principal',
      open_shift: {
        shift_id: 'shift-1',
        opened_at: '2026-11-05T08:00:00.000Z',
        opening_cash_minor: 50000,
      },
    },
  ],
  cursor: {
    changed_at: '2026-11-05T10:00:00.000Z',
    id: 'm-1',
  },
};

describe('bootstrap and snapshot application', () => {
  it('tokenizes names removing diacritics and lowercasing', () => {
    expect(tokenizeName('José María García')).toEqual(['jose', 'maria', 'garcia']);
  });

  it('atomically populates device, meta, members, catalog and shift_state', async () => {
    const db = open();
    await applyBootstrapSnapshot(db, sampleSnapshot);

    const device = await db.device.get('current');
    expect(device?.devicePrefix).toBe('REC-SUR1');
    expect(device?.next_seq).toBe(10);
    expect(device?.token).toBe('test-token-xyz');

    const cursor = await db.meta.get('last_roster_cursor');
    expect(cursor?.value).toBe('2026-11-05T10:00:00.000Z|m-1');

    const member = await db.members.get('m-1');
    expect(member?.full_name).toBe('Maria Perez Lopez');
    expect(member?.nameTokens).toEqual(['maria', 'perez', 'lopez']);

    const product = await db.catalog.get('prod-1');
    expect(product?.name).toBe('Agua 500ml');
    expect(product?.on_hand).toBe(25);

    const shift = await db.shift_state.get('reg-1');
    expect(shift?.status).toBe('open');
    expect(shift?.opening_cash_minor).toBe(50000);
  });
});
