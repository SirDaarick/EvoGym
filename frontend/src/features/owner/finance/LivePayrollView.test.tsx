import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LivePayrollView } from './LivePayrollView';

const item = {
  profile_id: 'p1',
  full_name: 'Lucia',
  base_minor: 350000,
  advances_minor: 50000,
  net_minor: 300000,
  daily_minor: 70000,
  paid_minor: 300000,
  outflow_minor: 350000,
  paid: { payment_method: 'cash' as const, paid_at: '2026-10-30T12:00:00Z' },
  advance_payment_method: 'cash' as const,
};
const open = {
  ...item,
  profile_id: 'p2',
  full_name: 'Mario',
  advances_minor: 20000,
  net_minor: 330000,
  paid_minor: 0,
  outflow_minor: 20000,
  paid: null,
  advance_payment_method: 'transfer' as const,
};
const history = {
  from: '2026-10-26',
  to: '2026-11-08',
  branches: [{ id: 'b1', name: 'Sur' }],
  base_minor: 700000,
  advances_minor: 70000,
  net_minor: 630000,
  paid_minor: 300000,
  outflow_minor: 370000,
  weeks: [
    {
      week_start: '2026-10-26',
      branch_id: 'b1',
      branch_name: 'Sur',
      items: [item, open],
      base_minor: 700000,
      advances_minor: 70000,
      net_minor: 630000,
      paid_minor: 300000,
      outflow_minor: 370000,
    },
  ],
};
const range = { from: '2026-10-26', to: '2026-11-08' };

describe('LivePayrollView', () => {
  it('shows the server totals, advance payment methods, and owner account notice', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify(history)));
    render(<LivePayrollView apiRequest={request as never} range={range} branchId="b1" />);

    // Verify explanation note that payroll comes from owner account and does not affect drawer
    expect(
      await screen.findByText(/salen de la cuenta del dueño, no descuenta de la caja del turno/i)
    ).toBeInTheDocument();

    const totals = await screen.findByLabelText('Totales de nómina');
    expect(within(totals).getByText('Egreso de nómina').nextSibling).toHaveTextContent('$3,700.00 MXN');
    expect(within(totals).getByText('Anticipos').nextSibling).toHaveTextContent('$700.00 MXN');
    expect(within(totals).getByText('Pagos semanales netos').nextSibling).toHaveTextContent('$3,000.00 MXN');

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Lucia');
    expect(rows[0]).toHaveTextContent('$500.00 MXN (efectivo)');
    expect(rows[0]).toHaveTextContent('Pagado (efectivo)');

    expect(rows[1]).toHaveTextContent('Mario');
    expect(rows[1]).toHaveTextContent('$200.00 MXN (transferencia)');
    expect(rows[1]).toHaveTextContent('Pendiente');

    expect(request).toHaveBeenCalledWith(
      '/api/v1/admin/payroll/history?from=2026-10-26&to=2026-11-08&branch_id=b1',
      undefined
    );
  });

  it('shows an empty message and a clear error without stale data', async () => {
    const empty = vi.fn(async () => new Response(JSON.stringify({ ...history, weeks: [] })));
    const first = render(<LivePayrollView apiRequest={empty as never} range={range} />);
    expect(await screen.findByText('No hay pagos ni anticipos de nómina en este periodo.')).toBeInTheDocument();
    first.unmount();

    const failing = vi.fn(async () => new Response('{}', { status: 500 }));
    render(<LivePayrollView apiRequest={failing as never} range={range} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByLabelText('Totales de nómina')).toBeNull();
  });
});
