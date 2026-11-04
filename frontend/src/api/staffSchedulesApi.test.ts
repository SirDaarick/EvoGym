import { describe, expect, it, vi } from 'vitest';
import { createScheduleException, listScheduleSeries } from './staffSchedulesApi';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('staffSchedulesApi', () => {
  it('lists the branch series through the injected request and throws on failure', async () => {
    const request = vi.fn().mockResolvedValueOnce(json([{ id: 's1' }])).mockResolvedValueOnce(json({}, 500));
    await expect(listScheduleSeries(request, 'b/1')).resolves.toEqual([{ id: 's1' }]);
    expect(request).toHaveBeenCalledWith('/api/v1/staff-schedules/branches/b%2F1');
    await expect(listScheduleSeries(request, 'b/1')).rejects.toThrow('Error al cargar turnos (500)');
  });

  it('puts an exception and surfaces the server detail on failure', async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ series_id: 's1' })).mockResolvedValueOnce(json({ detail: 'Fecha inválida' }, 422));
    await createScheduleException(request, 's1', '2026-10-08', { action: 'skip' });
    expect(request).toHaveBeenCalledWith(
      '/api/v1/staff-schedules/s1/occurrences/2026-10-08',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ action: 'skip' }) })
    );
    await expect(createScheduleException(request, 's1', '2026-10-08', { action: 'skip' })).rejects.toThrow('Fecha inválida');
  });
});
