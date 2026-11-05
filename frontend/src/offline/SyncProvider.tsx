/**
 * React Context providing offline sync state, pending queue count, and flush actions (T5.10).
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { connectivity } from './connectivity';
import { openLocalDb, type EvoGymLocalDB } from './db';
import { flushQueue } from './flushManager';

export type SyncBadgeStatus = 'offline' | 'syncing' | 'synced' | 'error';

export interface SyncContextValue {
  status: SyncBadgeStatus;
  isOnline: boolean;
  pendingCount: number;
  lastSyncAt: Date | null;
  error: string | null;
  flushNow: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({
  children,
  dbInstance,
  autoFlushIntervalMs = 30000,
}: {
  children: ReactNode;
  dbInstance?: EvoGymLocalDB;
  autoFlushIntervalMs?: number;
}) {
  const db = useRef(dbInstance || openLocalDb()).current;
  const [isOnline, setIsOnline] = useState(connectivity.isOnline);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshPendingCount = useCallback(async () => {
    try {
      if (!db.isOpen()) return;
      const count = await db.local_event_queue.where('sync_status').equals('queued').count();
      setPendingCount(count);
    } catch {
      // Ignore count errors if DB is closing/busy
    }
  }, [db]);

  const flushNow = useCallback(async () => {
    if (isSyncing) return;
    try {
      if (!db.isOpen()) return;
    } catch {
      return;
    }
    setIsSyncing(true);
    setError(null);

    try {
      const res = await flushQueue(db);
      await refreshPendingCount();
      if (res.errors.length > 0) {
        setError(res.errors[0]);
      } else {
        setLastSyncAt(new Date());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSyncing(false);
    }
  }, [db, isSyncing, refreshPendingCount]);

  useEffect(() => {
    const unsubConnectivity = connectivity.subscribe(online => {
      setIsOnline(online);
      if (online) {
        void flushNow();
      }
    });

    const stopMonitoring = connectivity.startMonitoring(db);
    void refreshPendingCount();

    const interval = setInterval(() => {
      void refreshPendingCount();
      if (connectivity.isOnline) {
        void flushNow();
      }
    }, autoFlushIntervalMs);

    return () => {
      unsubConnectivity();
      stopMonitoring?.();
      clearInterval(interval);
    };
  }, [db, flushNow, refreshPendingCount, autoFlushIntervalMs]);

  // Determine badge status
  let status: SyncBadgeStatus = 'synced';
  if (!isOnline) {
    status = 'offline';
  } else if (isSyncing) {
    status = 'syncing';
  } else if (error && pendingCount > 0) {
    status = 'error';
  }

  const value: SyncContextValue = {
    status,
    isOnline,
    pendingCount,
    lastSyncAt,
    error,
    flushNow,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    return {
      status: 'synced',
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      pendingCount: 0,
      lastSyncAt: null,
      error: null,
      flushNow: async () => {},
    };
  }
  return ctx;
}
