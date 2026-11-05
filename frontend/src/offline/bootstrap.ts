/**
 * Atomic application of bootstrap snapshot into local Dexie database (T5.5).
 */

import type { EvoGymLocalDB, MemberRow } from './db';
import type { BootstrapResponse, RosterMemberDTO } from './syncApi';

export function tokenizeName(fullName: string): string[] {
  return fullName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter(token => token.length > 0);
}

export function toMemberRow(dto: RosterMemberDTO): MemberRow {
  return {
    member_id: dto.member_id,
    member_number: dto.member_number,
    full_name: dto.full_name,
    phone_last4: dto.phone_last4,
    photo_hash: dto.photo_hash || null,
    status: dto.status,
    active_periods: dto.active_periods,
    has_debt: dto.has_debt,
    changed_at: dto.changed_at,
    nameTokens: tokenizeName(dto.full_name),
  };
}

export async function applyBootstrapSnapshot(
  db: EvoGymLocalDB,
  snapshot: BootstrapResponse,
): Promise<void> {
  await db.transaction(
    'rw',
    [db.meta, db.device, db.members, db.catalog, db.registers, db.shift_state],
    async () => {
      // 1. Store device credentials and sequence
      await db.device.put({
        id: 'current',
        deviceId: snapshot.device.device_id,
        devicePrefix: snapshot.device.device_prefix,
        token: snapshot.device.token,
        expiresAt: snapshot.device.expires_at,
        branchId: snapshot.branch.id,
        next_seq: snapshot.device.next_seq,
      });

      // 2. Store metadata
      const cursorStr = snapshot.cursor
        ? `${snapshot.cursor.changed_at}|${snapshot.cursor.id}`
        : null;

      await db.meta.bulkPut([
        { key: 'branch', value: snapshot.branch },
        { key: 'server_time', value: snapshot.server_time },
        { key: 'offline_grant_ttl_hours', value: snapshot.offline_grant_ttl_hours },
        { key: 'last_roster_cursor', value: cursorStr },
        { key: 'bootstrapped_at', value: new Date().toISOString() },
      ]);

      // 3. Replace member roster
      await db.members.clear();
      if (snapshot.roster.length > 0) {
        const memberRows = snapshot.roster.map(toMemberRow);
        await db.members.bulkPut(memberRows);
      }

      // 4. Replace catalog
      await db.catalog.clear();
      if (snapshot.catalog.length > 0) {
        await db.catalog.bulkPut(
          snapshot.catalog.map(c => ({
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

      // 5. Replace cash registers and active shifts
      await db.registers.clear();
      await db.shift_state.clear();
      if (snapshot.registers.length > 0) {
        await db.registers.bulkPut(
          snapshot.registers.map(r => ({
            register_id: r.register_id,
            name: r.name,
          })),
        );

        for (const r of snapshot.registers) {
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
    },
  );
}
