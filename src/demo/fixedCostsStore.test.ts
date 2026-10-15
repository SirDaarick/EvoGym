import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FIXED_COSTS,
  getFixedCosts,
  resetFixedCosts,
  saveFixedCosts,
  subscribeFixedCosts,
} from './fixedCostsStore';

describe('fixedCostsStore', () => {
  beforeEach(() => {
    resetFixedCosts();
    if (typeof window !== 'undefined') {
      window.localStorage?.clear();
      window.sessionStorage?.clear();
    }
  });

  it('provides default fixed costs matching master Excel', () => {
    const costs = getFixedCosts();
    expect(costs.rentMinor).toBe(6600000); // $66,000
    expect(costs.aguaMinor).toBe(900000);  // $9,000
    expect(costs.luzMinor).toBe(800000);   // $8,000
    expect(costs.internetMinor).toBe(80000); // $800
    expect(costs.basuraMinor).toBe(20000);  // $200
    expect(costs).toEqual(DEFAULT_FIXED_COSTS);
  });

  it('saves partial updates and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFixedCosts(listener);

    const updated = saveFixedCosts({
      rentMinor: 7000000, // $70,000
      luzMinor: 850000,   // $8,500
    });

    expect(updated.rentMinor).toBe(7000000);
    expect(updated.luzMinor).toBe(850000);
    expect(updated.aguaMinor).toBe(900000); // untouched

    expect(getFixedCosts().rentMinor).toBe(7000000);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      rentMinor: 7000000,
      luzMinor: 850000,
    }));

    unsubscribe();
    saveFixedCosts({ rentMinor: 7500000 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('resets fixed costs back to defaults', () => {
    saveFixedCosts({ rentMinor: 8000000 });
    expect(getFixedCosts().rentMinor).toBe(8000000);

    resetFixedCosts();
    expect(getFixedCosts().rentMinor).toBe(6600000);
    expect(getFixedCosts()).toEqual(DEFAULT_FIXED_COSTS);
  });

  it('persists and recovers from storage', () => {
    saveFixedCosts({ internetMinor: 95000 });
    expect(getFixedCosts().internetMinor).toBe(95000);

    // Verify storage has the persisted JSON
    const stored = window.localStorage.getItem('evogym_fixed_costs');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.internetMinor).toBe(95000);
  });

  it('ignores negative or invalid numbers defensively', () => {
    saveFixedCosts({
      rentMinor: -5000,
      aguaMinor: Number.NaN,
    });

    // Should retain previous or default values without corrupting state
    expect(getFixedCosts().rentMinor).toBe(6600000);
    expect(getFixedCosts().aguaMinor).toBe(900000);
  });
});
