import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AttendanceCalendar } from './AttendanceCalendar';

describe('attendance calendar disclosure', () => {
  it('separates attendance frequency, measured duration and unknown time', () => {
    render(<AttendanceCalendar now="2026-10-08T12:00:00-06:00" visits={[
      { id: 'a', memberId: 'demo', observedCheckIn: '2026-10-07T12:00:00-06:00', observedCheckOut: '2026-10-07T12:30:00-06:00', autoClosedAt: null },
      { id: 'b', memberId: 'demo', observedCheckIn: '2026-10-07T15:00:00-06:00', observedCheckOut: null, autoClosedAt: '2026-10-07T22:00:00-06:00' },
    ]} />);
    expect(screen.getByText('1 días con asistencia · 2 visitas')).toBeVisible();
    expect(screen.getByText('30 min medidos · 1 visitas con duración desconocida')).toBeVisible();
    expect(screen.getByRole('button', { name: /2026-10-07: 2 visitas, 30 min medidos, 1 duración desconocida/ })).toHaveAttribute('title');
    expect(screen.getAllByRole('button')).toHaveLength(84);
    fireEvent.focus(screen.getByRole('button', { name: /2026-10-07: 2 visitas/ }));
    expect(screen.getByRole('status', { name: 'Detalle del día' })).toHaveTextContent('2026-10-07: 2 visitas');
  });
});
