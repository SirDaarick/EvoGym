import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDemoModeEnabled, isRichDemoEnabled } from './adapter';

afterEach(() => vi.unstubAllEnvs());

describe('demo configuration', () => {
  it('allows demo only for the exact explicit true value', () => {
    for (const value of [undefined, '', 'false', 'TRUE', 'yes', '1']) {
      vi.unstubAllEnvs();
      if (value !== undefined) vi.stubEnv('VITE_DEMO_MODE', value);
      expect(isDemoModeEnabled()).toBe(false);
    }
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    expect(isDemoModeEnabled()).toBe(true);
  });

  it('keeps rich demo as seed selection independent of the live-mode boundary', () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    vi.stubEnv('VITE_USE_RICH_DEMO', 'true');
    expect(isDemoModeEnabled()).toBe(false);
    expect(isRichDemoEnabled()).toBe(true);
  });
});
