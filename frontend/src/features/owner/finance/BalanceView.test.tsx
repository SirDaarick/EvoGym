import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FinanceProjection, FinanceRow } from '../../../demo/financeReportSelector';
import { BalanceView } from './BalanceView';

const range = { from: '2026-10-01', to: '2026-10-02' };
const extras: FinanceRow[] = [
  {
    id: 'extra-positive',
    sourceFamily: 'extra',
    sourceReference: 'positive',
    memberLabel: null,
    method: null,
    status: 'confirmed',
    recordedAt: '2026-10-01T10:00:00-06:00',
    dateKey: '2026-10-01',
    amountMinor: 10_000,
    subtype: 'extra',
    orphan: false,
    description: 'Extra positivo',
  },
  {
    id: 'extra-negative',
    sourceFamily: 'extra',
    sourceReference: 'negative',
    memberLabel: null,
    method: null,
    status: 'confirmed',
    recordedAt: '2026-10-02T10:00:00-06:00',
    dateKey: '2026-10-02',
    amountMinor: -5_000,
    subtype: 'extra',
    orphan: false,
    description: 'Extra negativo',
  },
];

function projection(rows: FinanceRow[], extrasMinor: number): FinanceProjection {
  return {
    range,
    rangeValid: true,
    rows,
    totals: {
      grossMinor: 0,
      refundsMinor: 0,
      netMinor: 0,
      extrasMinor,
      expensesMinor: 0,
      balanceMinor: extrasMinor,
      pendingMinor: 0,
    },
    bySource: [],
    issues: [],
  };
}

describe('BalanceView', () => {
  it('keeps mixed-sign extra KPIs aligned with signed flow buckets and net balance', () => {
    const current = projection(extras, 5_000);
    const previous = projection([], 0);
    render(
      <BalanceView
        projection={current}
        previous={previous}
        range={range}
        granularity="day"
        onGranularityChange={() => {}}
      />,
    );

    const kpis = screen.getByRole('region', { name: 'Indicadores del balance registrado' });
    expect(within(kpis).getByText('Entradas registradas').parentElement).toHaveTextContent('$100.00');
    expect(within(kpis).getByText('Salidas registradas').parentElement).toHaveTextContent('$50.00');
    expect(within(kpis).getByText('Balance registrado').parentElement).toHaveTextContent('$50.00');
    expect(screen.getByText(/Neto del gráfico/).parentElement).toHaveTextContent('$50.00');
  });
});
