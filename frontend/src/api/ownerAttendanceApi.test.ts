import { describe, expect, it, vi } from 'vitest';
import { getOwnerAttendance } from './ownerAttendanceApi';

const raw = {
  period: { from: '2026-11-01', to: '2026-11-04', branch_id: 'b1', timezone: 'America/Mexico_City' },
  gym_capacity: 50, live_occupancy_count: 5, live_occupancy_percent: 10, total_check_ins: 7,
  member_check_ins: 5, class_sample_check_ins: 2,
  peak_hour: { hour: 7, label: '07:00', visits: 4 }, valley_hour: null,
  busiest_day: { day_index: 1, day_name: 'Martes', visits: 4, percent: 57 },
  hourly_bins: [{ hour: 7, hour_label: '07:00', time_range: '07:00–08:00', raw_visits: 4, is_peak: true, is_valley: false }],
  day_of_week_bins: [{ day_index: 1, day_name: 'Martes', short_name: 'Mar', raw_visits: 4, percent: 57, is_busiest: true }],
};

describe('owner attendance api', () => {
  it('maps snake_case to camelCase and sends the query', async () => {
    const request = vi.fn(async (_path: string) => new Response(JSON.stringify(raw), { status: 200 }));
    const result = await getOwnerAttendance(request, { from: '2026-11-01', to: '2026-11-04', branchId: 'b1' });
    expect(request).toHaveBeenCalledWith('/api/v1/owner/attendance?from=2026-11-01&to=2026-11-04&branch_id=b1');
    expect(result.period.branchId).toBe('b1');
    expect(result.peakHour?.label).toBe('07:00');
    expect(result.valleyHour).toBeNull();
    expect(result.busiestDay?.dayName).toBe('Martes');
    expect(result.hourlyBins[0]).toMatchObject({ hourLabel: '07:00', rawVisits: 4, isPeak: true });
    expect(result.dayOfWeekBins[0]).toMatchObject({ shortName: 'Mar', isBusiest: true });
  });

  it('omits the query without a period', async () => {
    const request = vi.fn(async (_path: string) => new Response(JSON.stringify(raw), { status: 200 }));
    await getOwnerAttendance(request);
    expect(request).toHaveBeenCalledWith('/api/v1/owner/attendance');
  });

  it('reports errors in Spanish', async () => {
    await expect(getOwnerAttendance(async () => new Response(null, { status: 403 }))).rejects.toThrow('No tienes permiso');
    await expect(getOwnerAttendance(async () => new Response(null, { status: 422 }))).rejects.toThrow('no es válido');
    await expect(getOwnerAttendance(async () => new Response(null, { status: 500 }))).rejects.toThrow('No se pudo cargar la afluencia');
  });
});
