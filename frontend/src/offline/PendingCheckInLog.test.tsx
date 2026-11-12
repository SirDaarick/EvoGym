import Dexie from 'dexie';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { openLocalDb, type LocalEvent } from './db';
import { PendingCheckInLog } from './PendingCheckInLog';

const db = openLocalDb(`pending-checkins-${Date.now()}`);
afterEach(async () => { db.close(); await Dexie.delete(db.name); });

it('shows queued and rejected local check-ins and updates after synchronization', async () => {
  await db.members.put({ member_id: 'member-1', member_number: 'M-1', full_name: 'Ana' });
  const event = (id: string, status: LocalEvent['sync_status']): LocalEvent => ({
    event_id: id, seq: 1, event_type: 'attendance.check_in', schema_version: 1,
    actor_staff_id: 'staff-1', payload: { member_id: 'member-1' }, payload_hash: 'hash',
    client_recorded_at: '2026-11-09T12:00:00.000Z', clock_anchor_utc: null,
    clock_monotonic_delta_ms: null, sync_status: status, created_at: '2026-11-09T12:00:00.000Z',
  });
  await db.local_event_queue.bulkPut([event('queued-1', 'queued'), event('rejected-1', 'rejected')]);
  render(<PendingCheckInLog db={db} />);
  await userEvent.click(await screen.findByText('Check-in sync log (2)'));
  expect(screen.getAllByText('Ana · M-1')).toHaveLength(2);
  expect(screen.getByText('Pending')).toBeInTheDocument();
  expect(screen.getByText('Needs attention')).toBeInTheDocument();
  await db.local_event_queue.update('queued-1', { sync_status: 'sending' });
  await waitFor(() => expect(screen.getByText('Syncing')).toBeInTheDocument());
  await db.local_event_queue.update('queued-1', { sync_status: 'unknown' });
  await waitFor(() => expect(screen.getAllByText('Needs attention')).toHaveLength(2));
  await db.local_event_queue.delete('queued-1');
  await waitFor(() => expect(screen.getByText('Check-in sync log (1)')).toBeInTheDocument());
});

it('updates the status when synchronization changes it during a delayed lookup', async () => {
  await db.open();
  await db.members.put({ member_id: 'member-1', member_number: 'M-1', full_name: 'Ana' });
  await db.local_event_queue.put({ event_id: 'race', seq: 1, event_type: 'attendance.check_in', schema_version: 1,
    actor_staff_id: 'staff-1', payload: { member_id: 'member-1' }, payload_hash: 'hash',
    client_recorded_at: '2026-11-09T12:00:00.000Z', clock_anchor_utc: null,
    clock_monotonic_delta_ms: null, sync_status: 'queued', created_at: '2026-11-09T12:00:00.000Z' });
  const originalGet = db.members.get.bind(db.members);
  const spy = vi.spyOn(db.members, 'get').mockImplementationOnce(((key: any) => {
    const original = originalGet(key);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        void db.local_event_queue.update('race', { sync_status: 'rejected' })
          .then(() => original.then(resolve, reject), reject);
      }, 0);
    });
  }) as any);
  try {
    render(<PendingCheckInLog db={db} />);
    await userEvent.click(await screen.findByText('Check-in sync log (1)'));
    await waitFor(() => expect(screen.getByText('Needs attention')).toBeInTheDocument());
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  } finally {
    spy.mockRestore();
  }
});
