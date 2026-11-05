import type { EvoGymLocalDB } from './db';

export interface AllocatedEventId { event_id: string; seq: number }

export const formatEventId = (devicePrefix: string, seq: number): string =>
  `${devicePrefix}-${String(seq).padStart(5, '0')}`;

/**
 * Seq gaps are allowed: allocation can succeed and the subsequent event write fail, burning a number.
 * Bootstrap seeds device.next_seq from the server's last_ingested_seq + 1; allocation takes the max of that and
 * the persisted meta counter so it never decreases.
 */
async function allocateInTx(db: EvoGymLocalDB, devicePrefix: string): Promise<AllocatedEventId> {
  return db.transaction('rw', db.meta, db.device, async () => {
    const row = await db.meta.get('next_seq');
    const devices = await db.device.toArray();
    const fromDevice = devices.find((d) => typeof d.next_seq === 'number')?.next_seq;
    const fromMeta = typeof row?.value === 'number' ? row.value : undefined;
    // Never go below an already-issued counter, even if device.next_seq was re-seeded lower.
    const seq = Math.max(fromMeta ?? 1, fromDevice ?? 1);
    await db.meta.put({ key: 'next_seq', value: seq + 1 });
    return { event_id: formatEventId(devicePrefix, seq), seq };
  });
}

/**
 * Allocates the next provisional folio. Serialized across tabs by the 'evogym-seq' Web Lock;
 * the Dexie rw transaction on meta additionally guarantees uniqueness if locks are unavailable.
 */
export async function allocateEventId(db: EvoGymLocalDB, devicePrefix: string): Promise<AllocatedEventId> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return allocateInTx(db, devicePrefix);
  let result: AllocatedEventId | undefined;
  let failure: unknown;
  await locks.request('evogym-seq', { mode: 'exclusive' }, async () => {
    try {
      result = await allocateInTx(db, devicePrefix);
    } catch (e) {
      failure = e;
    }
  });
  if (failure) throw failure;
  if (!result) throw new Error('sequence allocation did not run');
  return result;
}
