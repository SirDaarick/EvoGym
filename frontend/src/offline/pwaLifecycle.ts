// Tiny store exposing service-worker lifecycle state to the UI (rendered by a later task).
export interface PwaLifecycleState {
  offlineReady: boolean;
  needRefresh: boolean;
}

type Listener = (state: PwaLifecycleState) => void;
type UpdateFn = (reloadPage?: boolean) => Promise<void>;

let state: PwaLifecycleState = { offlineReady: false, needRefresh: false };
let updater: UpdateFn | null = null;
const listeners = new Set<Listener>();

function set(patch: Partial<PwaLifecycleState>): void {
  state = { ...state, ...patch };
  for (const l of [...listeners]) l(state);
}

export const getPwaState = (): PwaLifecycleState => state;
export const subscribe = (l: Listener): (() => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
export const setOfflineReady = (v = true): void => set({ offlineReady: v });
export const setNeedRefresh = (v = true): void => set({ needRefresh: v });
export const dismissPwaNotices = (): void => set({ offlineReady: false, needRefresh: false });
export const setUpdater = (fn: UpdateFn | null): void => { updater = fn; };
export async function updateServiceWorker(reloadPage = true): Promise<void> {
  if (updater) await updater(reloadPage);
}
export function resetPwaLifecycle(): void {
  state = { offlineReady: false, needRefresh: false };
  updater = null;
  listeners.clear();
}

/** Registers the service worker in production builds only (never in vitest/dev). */
export async function initPwa(): Promise<void> {
  if (!import.meta.env.PROD) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    setUpdater(registerSW({
      onOfflineReady: () => setOfflineReady(true),
      onNeedRefresh: () => setNeedRefresh(true),
    }));
  } catch {
    // Service worker unsupported or blocked: app keeps working online.
  }
}
