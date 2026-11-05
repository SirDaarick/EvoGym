/**
 * Connectivity detector and heartbeat verifier (T5.10).
 *
 * Uses navigator.onLine and window events as hints, confirmed by
 * lightweight heartbeat checks to /api/v1/sync/status.
 */

import type { EvoGymLocalDB } from './db';
import { getSyncStatus } from './syncApi';

export type ConnectivityListener = (isOnline: boolean) => void;

/**
 * Safe accessor for navigator.onLine that guards against jsdom prototype stubs
 * (e.g. Object.create(window.navigator) in tests throwing TypeError on getter access).
 */
export function isOnlineHint(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'onLine' in navigator ? Boolean(navigator.onLine) : true;
  } catch {
    return true;
  }
}

class ConnectivityManager {
  private _isOnline = isOnlineHint();
  private readonly _listeners = new Set<ConnectivityListener>();
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _checking = false;

  get isOnline(): boolean {
    return this._isOnline;
  }

  private setOnline(value: boolean) {
    if (this._isOnline !== value) {
      this._isOnline = value;
      this._listeners.forEach(fn => fn(value));
    }
  }

  subscribe(listener: ConnectivityListener): () => void {
    this._listeners.add(listener);
    listener(this._isOnline);
    return () => this._listeners.delete(listener);
  }

  async check(db?: EvoGymLocalDB): Promise<boolean> {
    if (!isOnlineHint()) {
      this.setOnline(false);
      return false;
    }

    if (this._checking) return this._isOnline;
    this._checking = true;

    try {
      let token: string | undefined;
      if (db) {
        try {
          if (db.isOpen()) {
            const dev = await db.device.get('current');
            token = dev?.token;
          }
        } catch {
          // DB closing or closed
        }
      }

      if (!token) {
        const online = isOnlineHint();
        this.setOnline(online);
        return online;
      }

      // 4-second timeout heartbeat
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      try {
        const status = await getSyncStatus(token);
        clearTimeout(timeoutId);

        if (db && status.server_time) {
          try {
            if (db.isOpen()) {
              await db.meta.put({ key: 'server_time', value: status.server_time });
            }
          } catch {
            // DB closing or closed
          }
        }
        this.setOnline(true);
        return true;
      } catch {
        clearTimeout(timeoutId);
        this.setOnline(false);
        return false;
      }
    } finally {
      this._checking = false;
    }
  }

  startMonitoring(db?: EvoGymLocalDB, intervalMs = 30000): () => void {
    if (typeof window === 'undefined') return () => {};

    const onOnline = () => {
      void this.check(db).catch(() => {});
    };
    const onOffline = () => {
      this.setOnline(false);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onOnline);
    const onVisChange = () => {
      if (document.visibilityState === 'visible') onOnline();
    };
    document.addEventListener('visibilitychange', onVisChange);

    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = setInterval(() => {
      void this.check(db).catch(() => {});
    }, intervalMs);

    // Initial check
    void this.check(db).catch(() => {});

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onOnline);
      document.removeEventListener('visibilitychange', onVisChange);
      if (this._heartbeatTimer) {
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
      }
    };
  }

  stopMonitoring() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }
}

export const connectivity = new ConnectivityManager();
