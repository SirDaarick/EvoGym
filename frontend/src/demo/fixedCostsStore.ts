import { useEffect, useState } from 'react';
import type { Money } from '../domain/models';

export interface FixedCostsConfig {
  rentMinor: Money;
  aguaMinor: Money;
  luzMinor: Money;
  internetMinor: Money;
  basuraMinor: Money;
}

export const DEFAULT_FIXED_COSTS: FixedCostsConfig = {
  rentMinor: 6600000,   // $66,000.00 MXN
  aguaMinor: 900000,    // $9,000.00 MXN
  luzMinor: 800000,     // $8,000.00 MXN
  internetMinor: 80000, // $800.00 MXN
  basuraMinor: 20000,   // $200.00 MXN
};

const STORAGE_KEY = 'evogym_fixed_costs';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage || window.sessionStorage || null;
  } catch {
    return null;
  }
}

function loadPersistedCosts(): FixedCostsConfig {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_FIXED_COSTS };

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FIXED_COSTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_FIXED_COSTS };

    return {
      rentMinor: typeof parsed.rentMinor === 'number' && parsed.rentMinor >= 0 && Number.isFinite(parsed.rentMinor)
        ? Math.round(parsed.rentMinor)
        : DEFAULT_FIXED_COSTS.rentMinor,
      aguaMinor: typeof parsed.aguaMinor === 'number' && parsed.aguaMinor >= 0 && Number.isFinite(parsed.aguaMinor)
        ? Math.round(parsed.aguaMinor)
        : DEFAULT_FIXED_COSTS.aguaMinor,
      luzMinor: typeof parsed.luzMinor === 'number' && parsed.luzMinor >= 0 && Number.isFinite(parsed.luzMinor)
        ? Math.round(parsed.luzMinor)
        : DEFAULT_FIXED_COSTS.luzMinor,
      internetMinor: typeof parsed.internetMinor === 'number' && parsed.internetMinor >= 0 && Number.isFinite(parsed.internetMinor)
        ? Math.round(parsed.internetMinor)
        : DEFAULT_FIXED_COSTS.internetMinor,
      basuraMinor: typeof parsed.basuraMinor === 'number' && parsed.basuraMinor >= 0 && Number.isFinite(parsed.basuraMinor)
        ? Math.round(parsed.basuraMinor)
        : DEFAULT_FIXED_COSTS.basuraMinor,
    };
  } catch {
    return { ...DEFAULT_FIXED_COSTS };
  }
}

let currentFixedCosts: FixedCostsConfig = loadPersistedCosts();
const listeners = new Set<(costs: FixedCostsConfig) => void>();

function notify() {
  const snapshot: FixedCostsConfig = { ...currentFixedCosts };
  listeners.forEach(fn => fn(snapshot));
}

export function getFixedCosts(): FixedCostsConfig {
  return { ...currentFixedCosts };
}

export function subscribeFixedCosts(listener: (costs: FixedCostsConfig) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function saveFixedCosts(updates: Partial<FixedCostsConfig>): FixedCostsConfig {
  const next: FixedCostsConfig = { ...currentFixedCosts };

  if (typeof updates.rentMinor === 'number' && Number.isFinite(updates.rentMinor) && updates.rentMinor >= 0) {
    next.rentMinor = Math.round(updates.rentMinor);
  }
  if (typeof updates.aguaMinor === 'number' && Number.isFinite(updates.aguaMinor) && updates.aguaMinor >= 0) {
    next.aguaMinor = Math.round(updates.aguaMinor);
  }
  if (typeof updates.luzMinor === 'number' && Number.isFinite(updates.luzMinor) && updates.luzMinor >= 0) {
    next.luzMinor = Math.round(updates.luzMinor);
  }
  if (typeof updates.internetMinor === 'number' && Number.isFinite(updates.internetMinor) && updates.internetMinor >= 0) {
    next.internetMinor = Math.round(updates.internetMinor);
  }
  if (typeof updates.basuraMinor === 'number' && Number.isFinite(updates.basuraMinor) && updates.basuraMinor >= 0) {
    next.basuraMinor = Math.round(updates.basuraMinor);
  }

  currentFixedCosts = next;

  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(currentFixedCosts));
    } catch {
      // Storage unavailable or quota exceeded; in-memory copy preserved
    }
  }

  notify();
  return { ...currentFixedCosts };
}

export function resetFixedCosts(): void {
  currentFixedCosts = { ...DEFAULT_FIXED_COSTS };
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable
    }
  }
  notify();
}

export function useFixedCosts(): FixedCostsConfig {
  const [costs, setCosts] = useState<FixedCostsConfig>(getFixedCosts);

  useEffect(() => {
    return subscribeFixedCosts(setCosts);
  }, []);

  return costs;
}
