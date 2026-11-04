import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AttendanceAnalytics } from './AttendanceAnalytics';
import { attendanceRange } from './LiveAttendance';

const hourly = Array.from({ length: 24 }, (_, hour) => ({
  hour, hour_label: `${String(hour).padStart(2, '0')}:00`, time_range: `${hour}-${hour + 1}`,
  raw_visits: hour === 7 ? 4 : 0, is_peak: hour === 7, is_valley: hour === 9,
}));
const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((day_name, day_index) => ({
  day_index, day_name, short_name: day_name.slice(0, 3), raw_visits: day_index === 1 ? 4 : 0,
  percent: day_index === 1 ? 100 : 0, is_busiest: day_index === 1,
}));
const data = {
  period: { from: '2026-10-29', to: '2026-11-04', branch_id: 'b', timezone: 'America/Mexico_City' },
  gym_capacity: 50, live_occupancy_count: 5, live_occupancy_percent: 10, total_check_ins: 4, member_check_ins: 3,
  class_sample_check_ins: 1, peak_hour: { hour: 7, label: '07:00', visits: 4 }, valley_hour: { hour: 9, label: '09:00', visits: 0 },
  busiest_day: { day_index: 1, day_name: 'Martes', visits: 4, percent: 100 }, hourly_bins: hourly, day_of_week_bins: days,
};

describe('live attendance', () => {
  it('renders API data without a demo provider and hides sections the API does not provide', async () => {
    localStorage.clear();
    const request = vi.fn(async (_path: string) => new Response(JSON.stringify(data), { status: 200 }));
    render(<MemoryRouter><AttendanceAnalytics apiRequest={request} /></MemoryRouter>);
    expect(await screen.findByText('Ocupación en vivo')).toBeVisible();
    expect(screen.getByText('10% aforo')).toBeVisible();
    expect(screen.getAllByText('07:00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Martes').length).toBeGreaterThan(0);
    expect(screen.queryByText('Duración promedio')).toBeNull();
    expect(screen.queryByText(/Franjas operativas/)).toBeNull();
    expect(screen.queryByText(/Socios actualmente/)).toBeNull();
    expect(screen.queryByText(/Recomendaciones estratégicas/)).toBeNull();
    expect(String(request.mock.calls[0]?.[0])).toMatch(/from=\d{4}-\d{2}-\d{2}&to=/);
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar hoy' }));
    await waitFor(() => expect(request.mock.calls.some(call => /from=(\d{4}-\d{2}-\d{2})&to=\1/.test(String(call[0])))).toBe(true));
  });

  it('reports request failures', async () => {
    const request = vi.fn(async () => new Response(null, { status: 503 }));
    render(<MemoryRouter><AttendanceAnalytics apiRequest={request} /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la afluencia');
  });

  it('computes the range from the branch business date, not UTC', () => {
    const instant = new Date('2026-11-02T02:00:00Z');
    expect(attendanceRange('today', 'America/Mexico_City', instant)).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(attendanceRange('week', 'UTC', instant)).toEqual({ from: '2026-10-27', to: '2026-11-02' });
    expect(attendanceRange('month', 'America/Mexico_City', instant)).toEqual({ from: '2026-10-03', to: '2026-11-01' });
  });
});
