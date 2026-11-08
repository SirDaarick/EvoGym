import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Overview } from './Overview';
import { formatShiftWindow } from '../../api/ownerOverviewApi';

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

const rich = {
  ...data,
  pulse: { confirmed_minor: 2000, alerts_count: 1 },
  finances: { ...data.finances, cash_minor: 500, card_minor: 1500, confirmed_count: 3,
    deposits: { held_minor: 500, refunded_minor: 250, retained_minor: 50 },
    by_method: [
      { method: 'cash', label: 'Efectivo', count: 1, gross_minor: 500, refunds_minor: 0, amount_minor: 500 },
      { method: 'transfer', label: 'Transferencia confirmada', count: 0, gross_minor: 0, refunds_minor: 0, amount_minor: 0 },
      { method: 'card', label: 'Tarjeta', count: 2, gross_minor: 2500, refunds_minor: 1000, amount_minor: 1500, terminals: [
        { terminal_id: 't1', terminal_name: 'Point Recepcion', count: 1, amount_minor: 2000 },
        { terminal_id: null, terminal_name: null, count: 1, amount_minor: 500 }] },
    ],
    shift_discrepancies: [{ shift_id: 'shift-1', difference_minor: -500, register_id: 'r1', register_name: 'Caja Principal',
      opened_at: '2026-10-01T15:00:00Z', closed_at: '2026-10-02T00:30:00Z' }] },
  cancellations: { total_count: 4, product_sales: { count: 1 }, product_refunds: { count: 1, amount_minor: 1000 },
    rental_cancellations: { count: 2, refund_amount_minor: 250, cancelled_debt_minor: 100, unreviewed_count: 1 } },
};

describe('live overview finance detail', () => {
  it('shows methods with Point terminals, cancellations, named discrepancies and separate deposits', async () => {
    const request = vi.fn(async (_path: string) => new Response(JSON.stringify(rich), { status: 200 }));
    render(<MemoryRouter><Overview apiRequest={request} /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Cancelaciones y reembolsos' })).toBeVisible();
    expect(screen.getByText('Transferencia confirmada')).toBeVisible();
    expect(screen.getByText(/Point · Point Recepcion \(1\)/)).toBeVisible();
    expect(screen.getByText(/Point · Sin terminal asignada \(1\)/)).toBeVisible();
    expect(screen.getByText(/Bruto .*25.* reembolsos .*10/)).toBeVisible();
    expect(screen.getByText(/Rentas canceladas: 2/)).toBeVisible();
    expect(screen.getByText(/sin revisar: 1/)).toBeVisible();
    expect(screen.getByText('Caja Principal')).toBeVisible();
    expect(screen.getByText('01 oct, 09:00 – 18:30')).toBeVisible();
    expect(screen.getByTestId('deposits-line')).toHaveTextContent(/recibidos.*5\.00.*devueltos.*2\.50.*retenidos.*0\.50/);
  });

  it('labels the credit method as Saldo a favor', async () => {
    const withCredit = { ...rich, finances: { ...rich.finances, by_method: [
      ...rich.finances.by_method, { method: 'credit', label: 'credit', count: 1, gross_minor: 700, refunds_minor: 0, amount_minor: 700 }] } };
    const request = vi.fn(async (_path: string) => new Response(JSON.stringify(withCredit), { status: 200 }));
    render(<MemoryRouter><Overview apiRequest={request} /></MemoryRouter>);
    expect(await screen.findByText('Saldo a favor')).toBeVisible();
  });

  it('degrades to the cash/card rows when an older API omits the new fields', async () => {
    const request = vi.fn(async (_path: string) => new Response(JSON.stringify(data), { status: 200 }));
    render(<MemoryRouter><Overview apiRequest={request} /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Equipo y nómina' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Cancelaciones y reembolsos' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('deposits-line')).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Tarjeta' })).toBeVisible();
  });
});

describe('formatShiftWindow', () => {
  it('converts to the branch timezone and handles missing times', () => {
    expect(formatShiftWindow('2026-10-01T15:00:00Z', '2026-10-02T00:30:00Z', 'America/Mexico_City')).toBe('01 oct, 09:00 – 18:30');
    expect(formatShiftWindow('2026-10-01T15:00:00Z', '2026-10-02T12:00:00Z', 'America/Mexico_City')).toMatch(/01 oct 09:00 – 02 oct 06:00/);
    expect(formatShiftWindow(null, null, 'America/Mexico_City')).toBe('');
    expect(formatShiftWindow('2026-10-01T15:00:00Z', null, 'America/Mexico_City')).toBe('01 oct, 09:00 – sin cierre');
  });
});


describe('live overview count discrepancies', () => {
  it('shows n/d instead of NaN when the expected quantity was never initialized', async () => {
    const body = { ...data, finances: { ...data.finances, count_discrepancies: [
      { shift_id: 's1', product: 'Agua', expected_quantity: null, physical_quantity: 4 }] } };
    const request = vi.fn(async (_path: string) => new Response(JSON.stringify(body), { status: 200 }));
    render(<MemoryRouter><Overview apiRequest={request} /></MemoryRouter>);
    expect(await screen.findByText('Agua')).toBeVisible();
    expect(screen.getByText('n/d')).toBeVisible();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });
});