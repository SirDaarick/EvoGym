import { describe, expect, it, vi } from 'vitest';
import { formatShiftWindow, getOwnerOverview } from './ownerOverviewApi';

describe('ownerOverviewApi', () => {
  it('passes period params and returns the snake_case payload untouched', async () => {
    const body = { finances: { by_method: [], deposits: { held_minor: 1, refunded_minor: 0, retained_minor: 0 } } };
    const request = vi.fn(async (_path: string) => new Response(JSON.stringify(body), { status: 200 }));
    const result = await getOwnerOverview(request, { from: '2026-10-01', to: '2026-10-02', branchId: 'b1' });
    expect(request).toHaveBeenCalledWith('/api/v1/owner/overview?from=2026-10-01&to=2026-10-02&branch_id=b1');
    expect(result.finances.deposits?.held_minor).toBe(1);
  });

  it('fails with a Spanish message on non-ok responses', async () => {
    await expect(getOwnerOverview(async () => new Response(null, { status: 500 }))).rejects.toThrow('No se pudo cargar');
  });

  it('formats shift windows with the period timezone, ignoring invalid dates', () => {
    expect(formatShiftWindow('bad', undefined, 'America/Mexico_City')).toBe('');
    expect(formatShiftWindow(undefined, '2026-10-02T00:30:00Z', 'America/Mexico_City')).toMatch(/^Cierre 01 oct, 18:30$/);
  });
});
