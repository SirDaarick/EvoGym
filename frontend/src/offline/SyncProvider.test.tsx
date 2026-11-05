import Dexie from 'dexie';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLocalDb, type EvoGymLocalDB } from './db';
import { SyncProvider, useSync } from './SyncProvider';
import * as flushManager from './flushManager';

let n = 0;
const uniq = () => `test-syncprov-db-${Date.now()}-${n++}`;
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
  vi.restoreAllMocks();
});

function Consumer() {
  const { status, isOnline, pendingCount, flushNow } = useSync();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="online">{String(isOnline)}</span>
      <span data-testid="count">{pendingCount}</span>
      <button onClick={() => flushNow()}>Flush</button>
    </div>
  );
}

describe('SyncProvider', () => {
  it('returns safe default values when useSync is used outside provider', () => {
    render(<Consumer />);
    expect(screen.getByTestId('status').textContent).toBe('synced');
    expect(screen.getByTestId('online').textContent).toBe('true');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('provides sync state and updates pending count inside provider', async () => {
    const db = open();
    await db.open();

    render(
      <SyncProvider dbInstance={db} autoFlushIntervalMs={60000}>
        <Consumer />
      </SyncProvider>
    );

    expect(screen.getByTestId('status')).toBeDefined();
    expect(screen.getByTestId('online')).toBeDefined();
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('triggers manual flush when flushNow is called', async () => {
    const db = open();
    await db.open();

    const flushSpy = vi.spyOn(flushManager, 'flushQueue').mockResolvedValueOnce({
      flushedCount: 1,
      remainingCount: 0,
      errors: [],
    });

    render(
      <SyncProvider dbInstance={db} autoFlushIntervalMs={60000}>
        <Consumer />
      </SyncProvider>
    );

    const button = screen.getByText('Flush');
    await act(async () => {
      button.click();
    });

    expect(flushSpy).toHaveBeenCalledWith(db);
  });
});
