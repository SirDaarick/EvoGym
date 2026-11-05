/**
 * Incremental application of roster and catalog delta (T5.6).
 */

import { toMemberRow } from './bootstrap';
import type { EvoGymLocalDB } from './db';
import type { RosterDeltaResponse } from './syncApi';

export interface ApplyDeltaResult {
  snapshotRequired: boolean;
  hasMore: boolean;
  appliedMembersCount: number;
  removedMembersCount: number;
}

export async function applyRosterDelta(
  db: EvoGymLocalDB,
  delta: RosterDeltaResponse,
): Promise<ApplyDeltaResult> {
  if (delta.snapshot_required) {
    return {
      snapshotRequired: true,
      hasMore: false,
      appliedMembersCount: 0,
      removedMembersCount: 0,
    };
  }

  await db.transaction(
    'rw',
    [db.meta, db.members, db.catalog, db.registers, db.shift_state],
    async () => {
      // 1. Remove deleted or disqualified members
      if (delta.removed_member_ids && delta.removed_member_ids.length > 0) {
        await db.members.bulkDelete(delta.removed_member_ids);
      }

      // 2. Upsert changed members
      if (delta.members && delta.members.length > 0) {
        const memberRows = delta.members.map(toMemberRow);
        await db.members.bulkPut(memberRows);
      }

      // 3. Replace catalog if updated
      if (delta.catalog) {
        await db.catalog.clear();
        if (delta.catalog.length > 0) {
          await db.catalog.bulkPut(
            delta.catalog.map(c => ({
              product_id: c.product_id,
              code: c.code,
              name: c.name,
              unit: c.unit,
              price_minor: c.price_minor,
              is_active: c.is_active,
              on_hand: c.on_hand,
            })),
          );
        }
      }

      // 4. Update registers if provided
      if (delta.registers && delta.registers.length > 0) {
        await db.registers.clear();
        await db.shift_state.clear();
        await db.registers.bulkPut(
          delta.registers.map(r => ({
            register_id: r.register_id,
            name: r.name,
          })),
        );

        for (const r of delta.registers) {
          if (r.open_shift) {
            await db.shift_state.put({
              register_id: r.register_id,
              shift_id: r.open_shift.shift_id,
              opened_at: r.open_shift.opened_at,
              opening_cash_minor: r.open_shift.opening_cash_minor,
              status: 'open',
            });
          }
        }
      }

      // 5. Update cursor
      if (delta.next_cursor) {
        const cursorStr = `${delta.next_cursor.changed_at}|${delta.next_cursor.id}`;
        await db.meta.put({ key: 'last_roster_cursor', value: cursorStr });
      }
    },
  );

  return {
    snapshotRequired: false,
    hasMore: delta.has_more,
    appliedMembersCount: delta.members?.length || 0,
    removedMembersCount: delta.removed_member_ids?.length || 0,
  };
}
