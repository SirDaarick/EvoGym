/**
 * React hook for PWA lifecycle notices and updates (T5.1).
 * Postpones updates while pending offline events exist in the queue.
 */

import { useEffect, useState } from 'react';
import {
  dismissPwaNotices,
  getPwaState,
  subscribe,
  updateServiceWorker,
  type PwaLifecycleState,
} from '../offline/pwaLifecycle';
import { useSync } from '../offline/SyncProvider';

export interface UsePwaLifecycleReturn extends PwaLifecycleState {
  canUpdateNow: boolean;
  applyUpdate: () => Promise<void>;
  dismiss: () => void;
}

export function usePwaLifecycle(): UsePwaLifecycleReturn {
  const [state, setState] = useState<PwaLifecycleState>(getPwaState());
  const { pendingCount } = useSync();

  useEffect(() => {
    return subscribe(setState);
  }, []);

  const canUpdateNow = pendingCount === 0;

  const applyUpdate = async () => {
    if (!canUpdateNow) return;
    await updateServiceWorker(true);
  };

  return {
    offlineReady: state.offlineReady,
    needRefresh: state.needRefresh,
    canUpdateNow,
    applyUpdate,
    dismiss: dismissPwaNotices,
  };
}
