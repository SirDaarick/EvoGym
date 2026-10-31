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
