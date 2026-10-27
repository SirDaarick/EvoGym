import { describe, expect, it, vi } from 'vitest';
import { closeShift, getCurrentShift, getShiftHistory, getShiftSnapshot, listCashRegisters, openShift, type ApiRequest } from './shiftsApi';

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }

describe('authenticated shifts API', () => {
  it('uses only the supplied authenticated request for register, snapshot, current and history reads', async () => {
    const request = vi.fn<ApiRequest>(async path => {
      if (path === '/api/v1/registers') return response([{ id: 'register-1' }]);
      if (path.includes('/inventory-snapshot')) return response({ snapshot_id: 'snapshot-1' });
      if (path.includes('/api/v1/shifts/current')) return response({ id: 'shift-1' });
      return response({ items: [{ id: 'shift-1' }], total: 1, offset: 0, limit: 50 });
    });

    await listCashRegisters(request);
    await getCurrentShift(request, 'register-1');
    await getShiftSnapshot(request, 'register-1');
    await getShiftHistory(request, 'register-1', 50);

    expect(request).toHaveBeenNthCalledWith(1, '/api/v1/registers', undefined);
    expect(request).toHaveBeenCalledWith('/api/v1/registers/register-1/inventory-snapshots', { method: 'POST' });
    expect(request).toHaveBeenNthCalledWith(2, '/api/v1/shifts/current?register_id=register-1', undefined);
    expect(request).toHaveBeenNthCalledWith(4, '/api/v1/shifts?register_id=register-1&offset=50&limit=50', undefined);
  });

  it('omits the denomination breakdown for a true manual opening and submits closing notes', async () => {
    const request = vi.fn<ApiRequest>(async () => response({ id: 'shift-1' }, 201));
    await openShift(request, { cash_register_id: 'register-1', inventory_snapshot_id: 'snapshot-1', opening_cash_minor: 80000, inventory_observations: [] });
    await closeShift(request, 'shift-1', { counted_cash_minor: 80000, closing_notes: 'Revisado' });

    expect(request.mock.calls[0][1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(request.mock.calls[1][1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).not.toHaveProperty('denomination_counts');
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ counted_cash_minor: 80000, closing_notes: 'Revisado' });
  });
});
