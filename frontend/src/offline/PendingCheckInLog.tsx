import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { openLocalDb, type EvoGymLocalDB } from './db';

type Entry = { id: string; member: string; recordedAt: string; status: string };

export function PendingCheckInLog({ db: suppliedDb }: { db?: EvoGymLocalDB }) {
  const [db] = useState(() => suppliedDb ?? openLocalDb());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const events = await db.local_event_queue.where('sync_status').anyOf('queued', 'sending', 'rejected', 'unknown').sortBy('seq');
      return Promise.all(events.filter(event => event.event_type === 'attendance.check_in').map(async event => {
        const payload = event.payload as { member_id?: unknown } | null;
        const id = typeof payload?.member_id === 'string' ? payload.member_id : '';
        const member = id ? await db.members.get(id) : undefined;
        return {
          id: event.event_id,
          member: member ? `${member.full_name ?? member.member_id} · ${member.member_number ?? member.member_id}` : id || event.event_id,
          recordedAt: event.client_recorded_at,
          status: event.sync_status === 'rejected' || event.sync_status === 'unknown' ? 'Needs attention' : event.sync_status === 'sending' ? 'Syncing' : 'Pending',
        };
      }));
    }).subscribe({ next: value => { setEntries(value); setError(false); }, error: () => setError(true) });
    return () => { subscription.unsubscribe(); if (!suppliedDb) db.close(); };
  }, [db, suppliedDb]);

  if (error) return <p role="alert">Could not load the check-in sync log.</p>;
  if (!entries.length) return null;
  return <details>
    <summary>Check-in sync log ({entries.length})</summary>
    <ul>{entries.map(entry => <li key={entry.id}><span>{entry.member}</span> · <time dateTime={entry.recordedAt}>{entry.recordedAt}</time> · <span>{entry.status}</span></li>)}</ul>
  </details>;
}
