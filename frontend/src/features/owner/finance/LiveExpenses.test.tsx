import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ExpenseReport } from '../ExpenseReport';

it('loads persisted expenses and excludes voided entries from totals', async () => {
  const base = { branch_id: 'b', shift_id: null, category: 'mantenimiento_cardio', payee_name: 'Shop', payment_method: 'transfer', voucher_reference: 'T1', evidence_url: null, recorded_by_name: 'Admin', recorded_at: '2026-10-10T12:00:00Z', voided_by_name: null, void_reason: null };
  const request = vi.fn(async (path: string) => {
    if (path.startsWith('/api/v1/admin/expenses?')) return new Response(JSON.stringify({ items: [
      { ...base, id: '1', concept: 'Repair', amount_minor: 250000, voided_at: null },
      { ...base, id: '2', concept: 'Cancelled', amount_minor: 400000, voided_at: '2026-10-11T12:00:00Z' },
    ], branches: [{ id: 'b', name: 'Central' }] }));
    if (path.startsWith('/api/v1/admin/pending-money')) return new Response(JSON.stringify({ items: [], total_items: 0, total_pending_minor: 0 }));
    return new Response('[]');
  });
  render(<MemoryRouter initialEntries={['/owner/expenses?tab=gastos&from=2026-10-01&to=2026-10-31']}><ExpenseReport apiRequest={request} /></MemoryRouter>);
  expect((await screen.findAllByText('Repair')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
  const kpis = screen.getByRole('region', { name: 'Gastos filtrados' });
  expect(within(kpis).getByText('$2,500.00 MXN')).toBeInTheDocument();
  expect(screen.getAllByText('Anulado').length).toBeGreaterThan(0);
  await userEvent.selectOptions(screen.getByLabelText('Sucursal'), 'b');
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('branch_id=b'), undefined));
});

it('shows real payroll history in the live report without demo or local stores', async () => {
  window.localStorage.clear();
  const item = { profile_id: 'p1', full_name: 'Emigdio', base_minor: 350000, advances_minor: 50000, net_minor: 300000, daily_minor: 70000, paid_minor: 300000, outflow_minor: 350000, paid: { payment_method: 'cash', paid_at: '2026-11-01T12:00:00Z' } };
  const request = vi.fn(async (path: string) => {
    if (path.startsWith('/api/v1/admin/payroll/history?')) return new Response(JSON.stringify({
      from: '2026-10-01', to: '2026-10-31', branches: [{ id: 'b', name: 'Central' }], base_minor: 350000, advances_minor: 50000, net_minor: 300000, paid_minor: 300000, outflow_minor: 350000,
      weeks: [{ week_start: '2026-10-26', branch_id: 'b', branch_name: 'Central', items: [item], base_minor: 350000, advances_minor: 50000, net_minor: 300000, paid_minor: 300000, outflow_minor: 350000 }] }));
    if (path.startsWith('/api/v1/admin/pending-money')) return new Response(JSON.stringify({ items: [], total_items: 0, total_pending_minor: 0 }));
    return new Response(JSON.stringify({ items: [], branches: [] }));
  });
  render(<MemoryRouter initialEntries={['/owner/expenses?tab=presupuesto&from=2026-10-01&to=2026-10-31']}><ExpenseReport apiRequest={request} /></MemoryRouter>);
  expect(await screen.findByText('Emigdio')).toBeInTheDocument();
  expect(screen.getByText('Pagado (efectivo)')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Totales de nómina' })).toHaveTextContent('$3,500.00 MXN');
  expect(screen.queryByText('Ajustar costos fijos')).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledWith(expect.stringContaining('/api/v1/admin/payroll/history?from=2026-10-01&to=2026-10-31'), undefined);
});

it('displays review warning when voiding a purchase expense whose products were already sold (L16)', async () => {
  const base = {
    id: 'exp-purchase-1',
    branch_id: 'b',
    shift_id: null,
    category: 'consumibles',
    concept: 'Compra de inventario #1',
    payee_name: 'Distribuidora',
    payment_method: 'cash',
    amount_minor: 50000,
    voucher_reference: null,
    evidence_url: null,
    recorded_by_name: 'Admin',
    recorded_at: '2026-10-10T12:00:00Z',
    voided_at: null,
    voided_by_name: null,
    void_reason: null,
  };
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/api/v1/admin/expenses?')) {
      return new Response(JSON.stringify({ items: [base], branches: [{ id: 'b', name: 'Central' }] }));
    }
    if (path.startsWith('/api/v1/admin/pending-money')) {
      return new Response(JSON.stringify({ items: [], total_items: 0, total_pending_minor: 0 }));
    }
    if (path === '/api/v1/expenses/exp-purchase-1/void' && init?.method === 'POST') {
      return new Response(
        JSON.stringify({
          error: {
            code: 'purchase_cancellation_requires_review',
            message: 'Purchase has products already sold or consumed; administrator review is required.',
          },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('[]');
  });

  render(
    <MemoryRouter initialEntries={['/owner/expenses?tab=gastos&from=2026-10-01&to=2026-10-31']}>
      <ExpenseReport apiRequest={request} />
    </MemoryRouter>
  );

  expect((await screen.findAllByText('Compra de inventario #1')).length).toBeGreaterThan(0);
  const voidButton = screen.getByRole('button', { name: 'Anular' });
  await userEvent.click(voidButton);

  expect(screen.getByRole('heading', { name: 'Anular gasto' })).toBeInTheDocument();
  const reasonInput = screen.getByLabelText(/Motivo/);
  await userEvent.type(reasonInput, 'Error en captura');

  const confirmButton = screen.getByRole('button', { name: 'Confirmar anulación' });
  await userEvent.click(confirmButton);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(
    'Esta compra tiene productos que ya fueron vendidos o consumidos; requiere revisión de un administrador.'
  );
  expect(screen.getByRole('heading', { name: 'Anular gasto' })).toBeInTheDocument();
});

it('successfully voids an expense when stock is intact', async () => {
  let isVoided = false;
  const base = {
    id: 'exp-purchase-2',
    branch_id: 'b',
    shift_id: null,
    category: 'consumibles',
    concept: 'Compra de toallas',
    payee_name: 'Distribuidora',
    payment_method: 'cash',
    amount_minor: 30000,
    voucher_reference: null,
    evidence_url: null,
    recorded_by_name: 'Admin',
    recorded_at: '2026-10-10T12:00:00Z',
    voided_at: null,
    voided_by_name: null,
    void_reason: null,
  };

  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/api/v1/admin/expenses?')) {
      const item = isVoided
        ? { ...base, voided_at: '2026-10-11T12:00:00Z', void_reason: 'Devolución al proveedor' }
        : base;
      return new Response(JSON.stringify({ items: [item], branches: [{ id: 'b', name: 'Central' }] }));
    }
    if (path.startsWith('/api/v1/admin/pending-money')) {
      return new Response(JSON.stringify({ items: [], total_items: 0, total_pending_minor: 0 }));
    }
    if (path === '/api/v1/expenses/exp-purchase-2/void' && init?.method === 'POST') {
      isVoided = true;
      return new Response(
        JSON.stringify({ ...base, voided_at: '2026-10-11T12:00:00Z', void_reason: 'Devolución al proveedor' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('[]');
  });

  render(
    <MemoryRouter initialEntries={['/owner/expenses?tab=gastos&from=2026-10-01&to=2026-10-31']}>
      <ExpenseReport apiRequest={request} />
    </MemoryRouter>
  );

  expect((await screen.findAllByText('Compra de toallas')).length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: 'Anular' }));

  const reasonInput = screen.getByLabelText(/Motivo/);
  await userEvent.type(reasonInput, 'Devolución al proveedor');
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar anulación' }));

  await vi.waitFor(() => {
    expect(screen.queryByRole('heading', { name: 'Anular gasto' })).not.toBeInTheDocument();
  });
  expect((await screen.findAllByText('Anulado')).length).toBeGreaterThan(0);
});
