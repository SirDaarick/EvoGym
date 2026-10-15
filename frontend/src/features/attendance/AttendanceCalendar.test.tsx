import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AttendanceCalendar, buildAttendanceYearCells } from './AttendanceCalendar';

describe('attendance calendar disclosure', () => {
  it('groups visits once while preserving gym-local leap-day values and unknown duration', () => {
    const readCheckIn = vi.fn(() => '2024-03-01T01:00:00Z');
    const cells = buildAttendanceYearCells(2024, [
      { id: 'measured', memberId: 'm', get observedCheckIn() { return readCheckIn(); }, observedCheckOut: '2024-03-01T02:30:00Z', autoClosedAt: null },
      { id: 'unknown', memberId: 'm', observedCheckIn: '2024-02-29T22:00:00-06:00', observedCheckOut: null, autoClosedAt: '2024-02-29T22:00:00-06:00' },
      { id: 'invalid', memberId: 'm', observedCheckIn: 'invalid', observedCheckOut: null, autoClosedAt: null },
      { id: 'future', memberId: 'm', observedCheckIn: '2024-03-02T08:00:00-06:00', observedCheckOut: '2024-03-02T08:00:00-06:00', autoClosedAt: null },
    ], '2024-03-01T12:00:00-06:00');
    expect(cells).toHaveLength(366);
    expect(cells.find(cell => cell.date === '2024-02-29')).toMatchObject({ count: 2, minutes: 90, unknown: 1, level: 2, future: false });
    expect(cells.find(cell => cell.date === '2024-03-02')).toMatchObject({ count: 1, minutes: 0, unknown: 0, level: 0, future: true });
    // One date lookup and one duration calculation, independent of the year's length.
    expect(readCheckIn).toHaveBeenCalledTimes(2);
  });

  it('separates attendance frequency, measured duration and unknown time', () => {
    render(<AttendanceCalendar now="2026-10-08T12:00:00-06:00" visits={[
      { id: 'a', memberId: 'demo', observedCheckIn: '2026-10-07T12:00:00-06:00', observedCheckOut: '2026-10-07T12:30:00-06:00', autoClosedAt: null },
      { id: 'b', memberId: 'demo', observedCheckIn: '2026-10-07T15:00:00-06:00', observedCheckOut: null, autoClosedAt: '2026-10-07T22:00:00-06:00' },
    ]} />);
    expect(screen.getByText(/visitas totales/)).toBeVisible();
    expect(screen.getByText(/visitas últimos 30 días/)).toBeVisible();
    expect(screen.getByRole('img', { name: /Mapa anual de asistencia 2026/ })).toBeVisible();
    expect(screen.getByRole('img', { name: /Mapa anual de asistencia 2026/ }).querySelectorAll('rect[stroke="#c2410c"]').length).toBe(1);
    expect(screen.getAllByRole('button', { name: /2026-10-0/ }).length).toBeGreaterThan(0);
    fireEvent.focus(screen.getByRole('button', { name: /2026-10-07: 2 visitas, 30 min medidos, 1 duración desconocida/ }));
    expect(screen.getByRole('status', { name: 'Detalle del día' })).toHaveTextContent('2026-10-07: 2 visitas');
  });

  it('renders all leap-year days and disables future dates', () => {
    render(<AttendanceCalendar now="2024-06-15T12:00:00-06:00" visits={[]} />);
    expect(screen.getAllByRole('button', { name: /2024-/ })).toHaveLength(366);
    expect(screen.getByRole('button', { name: /2024-12-31: 0 visitas/ })).toBeDisabled();
  });

  it('keeps KPIs member-wide across year changes and counts the rolling 30 calendar days across New Year', async () => {
    render(<AttendanceCalendar now="2026-01-05T12:00:00-06:00" visits={[
      { id: 'a', memberId: 'm', observedCheckIn: '2025-12-07T08:00:00-06:00', observedCheckOut: null, autoClosedAt: '2025-12-07T22:00:00-06:00' },
      { id: 'b', memberId: 'm', observedCheckIn: '2025-12-08T08:00:00-06:00', observedCheckOut: null, autoClosedAt: '2025-12-08T22:00:00-06:00' },
      { id: 'c', memberId: 'm', observedCheckIn: '2026-01-05T08:00:00-06:00', observedCheckOut: null, autoClosedAt: '2026-01-05T22:00:00-06:00' },
      { id: 'd', memberId: 'm', observedCheckIn: '2025-12-06T08:00:00-06:00', observedCheckOut: null, autoClosedAt: '2025-12-06T22:00:00-06:00' },
    ]} />);
    expect(screen.getByText(/visitas totales/).querySelector('strong')).toHaveTextContent('4');
    expect(screen.getByText(/visitas últimos 30 días/).querySelector('strong')).toHaveTextContent('3');
    await userEvent.click(screen.getByRole('button', { name: 'Año anterior' }));
    expect(screen.getByRole('img', { name: /Mapa anual de asistencia 2025/ })).toBeVisible();
    expect(screen.getByText(/visitas totales/).querySelector('strong')).toHaveTextContent('4');
    expect(screen.getByText(/visitas últimos 30 días/).querySelector('strong')).toHaveTextContent('3');
  });

  it('places Monday at the top of the chart coordinate system', () => {
    const cells = buildAttendanceYearCells(2026, [], '2026-12-31T23:00:00-06:00');
    expect(cells.find(cell => cell.date === '2026-01-05')?.y0).toBe(6);
    expect(cells.find(cell => cell.date === '2026-01-11')?.y0).toBe(0);
  });
});



