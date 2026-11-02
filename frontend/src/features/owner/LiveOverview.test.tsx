import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Overview } from './Overview';

const data = {
  period: { from: '2026-10-01', to: '2026-10-01', branch_id: 'branch', timezone: 'America/Mexico_City' },
  pulse: { confirmed_minor: 5000, alerts_count: 1 },
  finances: { cash_minor: 5000, card_minor: 0, confirmed_count: 1, pending_transfer_minor: 0, pending_transfer_count: 0, shift_discrepancies: [], count_discrepancies: [] },
  members: { total_members: 2, active_members: 1, active_percent: 50, median_tenure_months: 3, expiring_soon_count: 1, expired_count: 0 },
  attendance: { live_occupancy_count: 1, gym_capacity: 50, peak_hour: 10, valley_hour: 8, total_check_ins: 4, memberships_sold_count: 1, memberships_renewed_count: 2 },
  inventory: { active_products_count: 2, low_stock_count: 1, retail_units_sold: 3, retail_revenue_minor: 5000 },
  staff: { next_payday: '2026-10-03', days_until_payday: 2, estimated_payroll_minor: 25000, staff_on_duty_count: 1, staff_absent_count: 0 },
  alerts: { total_count: 1, category_counts: [{ category: 'Casilleros vencidos', count: 1 }] },
};

describe('live overview', () => {
  it('renders API data without a demo provider and reloads valid periods', async () => {
    const request = vi.fn(async (_path: string) => new Response(JSON.stringify(data), { status: 200 }));
    render(<MemoryRouter><Overview apiRequest={request} /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Equipo y nómina' })).toBeVisible();
    expect(screen.getByText('Visitas en el periodo')).toBeVisible();
    expect(screen.getByText(/Casilleros vencidos:/).closest('.overview-category-tag')).toHaveTextContent('Casilleros vencidos: 1');
    expect(screen.getByText('Conversaciones Gimi').parentElement).toHaveTextContent('No disponible');
    expect(screen.getByRole('link', { name: 'Ver equipo y nómina →' })).toHaveAttribute('href', '/owner/staff');
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-02' } });
    await waitFor(() => expect(request.mock.calls.some(call => String(call[0]).includes('to=2026-10-02'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-09-01' } });
    expect(screen.getByText(/Selecciona fechas válidas/)).toBeVisible();
  });

  it('reports request failures', async () => {
    const request = vi.fn(async () => new Response(null, { status: 503 }));
    render(<MemoryRouter><Overview apiRequest={request} /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el resumen');
  });

  it('keeps period controls available after a later request fails', async () => {
    const request = vi.fn(async (path: string) => path.includes('to=2026-10-02')
      ? new Response(null, { status: 503 }) : new Response(JSON.stringify(data), { status: 200 }));
    render(<MemoryRouter><Overview apiRequest={request} /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Equipo y nómina' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-02' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el resumen');
    expect(screen.getByLabelText('Hasta')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Equipo y nómina' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-03' } });
    expect(await screen.findByRole('heading', { name: 'Equipo y nómina' })).toBeVisible();
  });
});
