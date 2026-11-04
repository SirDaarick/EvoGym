import { describe, expect, it, vi } from 'vitest';
import { getOwnerHistory } from './ownerHistoryApi';

const item = {
  id: 'p1', occurred_at: '2026-10-01T15:00:00Z', category: 'membership', branch_id: 'b1', shift_id: null,
  description: 'Mensual', detail: 'Pago', status: 'confirmed', amount_minor: 50000, method: 'cash',
  actor_id: 'a1', actor_name: 'Ana', member_id: 'm1', member_name: 'Luis',
};

describe('ownerHistoryApi', () => {
  it('builds the query and maps rows to camelCase', async () => {
    const request = vi.fn(async (_path: string) => new Response(JSON.stringify({
      period: { from: '2026-10-01', to: '2026-10-02', timezone: 'America/Mexico_City' },
      items: [item, { ...item, id: 's1', category: 'shift', member_id: null, member_name: null, amount_minor: null, method: null, shift_id: 'sh', status: 'opened' }],
      next_cursor: 'abc',
    }), { status: 200 }));
    const page = await getOwnerHistory(request, { from: '2026-10-01', to: '2026-10-02', category: 'membership', method: 'cash', branchId: 'b1', cursor: 'c0', limit: 500 });
    const url = new URL(String(request.mock.calls[0][0]), 'http://x');
    expect(url.pathname).toBe('/api/v1/owner/history');
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: '2026-10-01', to: '2026-10-02', category: 'membership', method: 'cash', branch_id: 'b1', cursor: 'c0', limit: '200' });
    expect(page.nextCursor).toBe('abc');
    expect(page.records[0]).toMatchObject({ id: 'p1', recordedAt: '2026-10-01T15:00:00Z', shiftId: '', amountMinor: 50000, status: 'Confirmado', memberId: 'm1', memberName: 'Luis', actorName: 'Ana' });
    expect(page.records[1]).toMatchObject({ shiftId: 'sh', status: 'Apertura', method: null, amountMinor: null });
    expect(page.records[1].memberId).toBeUndefined();
  });

  it('omits empty params and throws on failure', async () => {
    const request = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(getOwnerHistory(request)).rejects.toThrow('No se pudo cargar el historial');
    expect(request).toHaveBeenCalledWith('/api/v1/owner/history');
  });
});
