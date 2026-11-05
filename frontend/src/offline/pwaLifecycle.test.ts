import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPwaState, resetPwaLifecycle, setNeedRefresh, setOfflineReady, setUpdater,
  subscribe, updateServiceWorker, dismissPwaNotices, initPwa,
} from './pwaLifecycle';

describe('pwaLifecycle', () => {
  beforeEach(resetPwaLifecycle);
  it('notifies subscribers and supports unsubscribe', () => {
    const fn = vi.fn();
    const off = subscribe(fn);
    setOfflineReady();
    expect(getPwaState()).toEqual({ offlineReady: true, needRefresh: false });
    setNeedRefresh();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    dismissPwaNotices();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(getPwaState()).toEqual({ offlineReady: false, needRefresh: false });
  });
  it('delegates updateServiceWorker and tolerates no updater', async () => {
    await expect(updateServiceWorker()).resolves.toBeUndefined();
    const up = vi.fn().mockResolvedValue(undefined);
    setUpdater(up);
    await updateServiceWorker(false);
    expect(up).toHaveBeenCalledWith(false);
  });
  it('initPwa is a no-op outside production', async () => {
    await expect(initPwa()).resolves.toBeUndefined();
  });
});
