import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDb, type EvoGymLocalDB } from './db';
import { registerOfflinePin, timingSafeEqual, verifyOfflinePin } from './offlinePin';

let n = 0;
const uniq = () => `test-pin-${Date.now()}-${n++}`;
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

describe('offlinePin authentication', () => {
  it('timingSafeEqual correctly compares Uint8Arrays', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    const c = new Uint8Array([1, 2, 4]);
    const d = new Uint8Array([1, 2]);

    expect(timingSafeEqual(a, b)).toBe(true);
    expect(timingSafeEqual(a, c)).toBe(false);
    expect(timingSafeEqual(a, d)).toBe(false);
  });

  it('enrolls and verifies correct PIN', async () => {
    const db = open();
    await registerOfflinePin(db, 'staff-1', '1234');

    const result = await verifyOfflinePin(db, 'staff-1', '1234');
    expect(result.success).toBe(true);
  });

  it('fails with invalid_pin and decrements remaining attempts', async () => {
    const db = open();
    await registerOfflinePin(db, 'staff-1', '1234');

    const result = await verifyOfflinePin(db, 'staff-1', '9999');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('invalid_pin');
      expect(result.remainingAttempts).toBe(4);
    }
  });

  it('locks out after 5 consecutive failed attempts', async () => {
    const db = open();
    await registerOfflinePin(db, 'staff-1', '1234');

    for (let i = 0; i < 4; i++) {
      await verifyOfflinePin(db, 'staff-1', '0000');
    }
    const fifth = await verifyOfflinePin(db, 'staff-1', '0000');
    expect(fifth.success).toBe(false);
    if (!fifth.success) {
      expect(fifth.error).toBe('locked');
    }

    // Even with the correct PIN, it is now locked
    const lockedTry = await verifyOfflinePin(db, 'staff-1', '1234');
    expect(lockedTry.success).toBe(false);
    if (!lockedTry.success) {
      expect(lockedTry.error).toBe('locked');
    }
  });

  it('rejects expired grants', async () => {
    const db = open();
    await registerOfflinePin(db, 'staff-1', '1234', 1); // 1 hour TTL

    // Fast-forward 2 hours
    const future = new Date(Date.now() + 2 * 3600 * 1000);
    const result = await verifyOfflinePin(db, 'staff-1', '1234', future);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('expired');
    }
  });
});
