/**
 * Local command dispatcher: sequences, validates, hashes, persists, and optimistically projects offline events (T5.1).
 */

import { payloadHash } from './canonicalJson';
import { isAllowedOffline, OnlineOnlyError, type OfflineCommand } from './capabilities';
import type { EvoGymLocalDB, LocalEvent } from './db';
import { allocateEventId } from './sequence';

export interface CheckInCommandPayload {
  member_id: string;
  period_id: string;
  branch_id: string;
  local_access_decision: 'valid' | 'valid_with_outstanding_balance' | 'denied';
  online_idempotency_key?: string;
  confirm_outstanding_balance?: boolean;
}

export interface CashSaleItemPayload {
  product_id: string;
  quantity: number;
  unit_price_minor: number;
}

export interface CashSaleCommandPayload {
  register_id: string;
  local_shift_ref: string;
  member_id?: string | null;
  items: CashSaleItemPayload[];
  total_minor: number;
  online_idempotency_key?: string;
}

export interface DenominationCountPayload {
  denomination_minor: number;
  quantity: number;
}

export interface ShiftOpenCommandPayload {
  register_id: string;
  opening_cash_minor: number;
  denomination_counts: DenominationCountPayload[];
}

export interface ArqueoCloseCommandPayload {
  shift_ref: string;
  denomination_counts: DenominationCountPayload[];
  counted_cash_minor?: number;
  voucher_count: number;
  closing_notes?: string | null;
}

export type ContingencyCommand =
  | { type: 'attendance.check_in'; payload: CheckInCommandPayload }
  | { type: 'pos.cash_sale'; payload: CashSaleCommandPayload }
  | { type: 'shift.open'; payload: ShiftOpenCommandPayload }
  | { type: 'shift.arqueo_close'; payload: ArqueoCloseCommandPayload };

export interface DispatchResult {
  success: true;
  eventId: string;
  seq: number;
  localEvent: LocalEvent;
}

export async function dispatch(
  db: EvoGymLocalDB,
  command: ContingencyCommand,
  actorStaffId: string,
  now: Date = new Date(),
): Promise<DispatchResult> {
  // 1. Enforce offline capability
  if (!isAllowedOffline(command.type as OfflineCommand)) {
    throw new OnlineOnlyError(command.type);
  }

  // 2. Fetch device prefix
  const dev = await db.device.get('current');
  const prefix = dev?.devicePrefix || 'OFFLINE-DEV';

  // 3. Allocate next sequential seq & eventId
  const { event_id, seq } = await allocateEventId(db, prefix);

  // 4. Compute canonical hash
  const hash = await payloadHash(command.payload);

  // 5. Build clock anchor
  const serverTimeMeta = await db.meta.get('server_time');
  const clockAnchorUtc = typeof serverTimeMeta?.value === 'string' ? serverTimeMeta.value : null;
  const monotonicDeltaMs = typeof performance !== 'undefined' ? Math.round(performance.now()) : null;

  const recordedAt = now.toISOString();

  // 6. Build event
  const localEvent: LocalEvent = {
    event_id,
    seq,
    event_type: command.type,
    schema_version: 1,
    actor_staff_id: actorStaffId,
    payload: command.payload,
    payload_hash: hash,
    client_recorded_at: recordedAt,
    clock_anchor_utc: clockAnchorUtc,
    clock_monotonic_delta_ms: monotonicDeltaMs,
    sync_status: 'queued',
    created_at: recordedAt,
  };

  // 7. Atomic transaction: write event + optimistic projection
  await db.transaction(
    'rw',
    [db.local_event_queue, db.local_check_ins, db.catalog, db.shift_state],
    async () => {
      // Append to queue
      await db.local_event_queue.put(localEvent);

      // Optimistic projection
      if (command.type === 'attendance.check_in') {
        await db.local_check_ins.add({
          member_id: command.payload.member_id,
          recorded_at: recordedAt,
        });
      } else if (command.type === 'pos.cash_sale') {
        for (const line of command.payload.items) {
          const product = await db.catalog.get(line.product_id);
          if (!command.payload.online_idempotency_key &&
              (!product || typeof product.on_hand !== 'number' || product.on_hand < line.quantity)) {
            throw new Error('No hay existencias suficientes en el inventario local.');
          }
          if (product && typeof product.on_hand === 'number') {
            await db.catalog.update(line.product_id, {
              on_hand: product.on_hand - line.quantity,
            });
          }
        }
      } else if (command.type === 'shift.open') {
        await db.shift_state.put({
          register_id: command.payload.register_id,
          shift_id: event_id,
          opening_cash_minor: command.payload.opening_cash_minor,
          opened_at: recordedAt,
          status: 'open',
        });
      } else if (command.type === 'shift.arqueo_close') {
        const shifts = await db.shift_state.toArray();
        for (const s of shifts) {
          if (s.shift_id === command.payload.shift_ref || s.status === 'open') {
            await db.shift_state.update(s.register_id, {
              status: 'closed',
              closed_at: recordedAt,
            });
          }
        }
      }
    },
  );

  return {
    success: true,
    eventId: event_id,
    seq,
    localEvent,
  };
}
