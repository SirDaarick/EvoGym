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

    expect(screen.getByLabelText('Conciliación del periodo en cascada')).toBeInTheDocument();
    expect(screen.getByLabelText('Comparación de periodos')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Desglose de conciliación del periodo' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Datos de comparación entre periodos' })).toBeInTheDocument();
  });

  it('renders reconciliation waterfall breakdown table with step labels and signed amounts', () => {
    const fullTotals = {
      grossMinor: 150_000,
      refundsMinor: 20_000,
      netMinor: 130_000,
      extrasMinor: 10_000,
      expensesMinor: 50_000,
      balanceMinor: 90_000,
      pendingMinor: 5_000,
    };
    const current = { ...projection([], 0), totals: fullTotals };
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

    const waterfallRegion = screen.getByRole('region', { name: 'Desglose de conciliación del periodo' });
    expect(within(waterfallRegion).getByText('Cobros brutos')).toBeInTheDocument();
    expect(within(waterfallRegion).getByText('Reembolsos')).toBeInTheDocument();
    expect(within(waterfallRegion).getByText('Extras')).toBeInTheDocument();
    expect(within(waterfallRegion).getByText('Gastos')).toBeInTheDocument();
    expect(within(waterfallRegion).getByText('Balance final')).toBeInTheDocument();

    const comparisonRegion = screen.getByRole('region', { name: 'Datos de comparación entre periodos' });
    expect(within(comparisonRegion).getByText('Entradas')).toBeInTheDocument();
    expect(within(comparisonRegion).getByText('Salidas')).toBeInTheDocument();
    expect(within(comparisonRegion).getByText('Balance')).toBeInTheDocument();
  });

  it('renders structured 2-column table in finance-constrained-table and keeps chart tables sr-only without accordions', () => {
    const fullTotals = {
      grossMinor: 150_000,
      refundsMinor: 20_000,
      netMinor: 130_000,
      extrasMinor: 10_000,
      expensesMinor: 50_000,
      balanceMinor: 90_000,
      pendingMinor: 5_000,
    };
    const current = { ...projection([], 0), totals: fullTotals };
    const previous = projection([], 0);

    const { container } = render(
      <BalanceView
        projection={current}
        previous={previous}
        range={range}
        granularity="day"
        onGranularityChange={() => {}}
      />,
    );

    // 2-column breakdown table in constrained wrapper
    const constrained = container.querySelector('.finance-constrained-table');
    expect(constrained).toBeInTheDocument();
    const table = within(constrained as HTMLElement).getByRole('table');
    expect(table).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Concepto' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Importe (MXN)' })).toBeInTheDocument();
    expect(within(table).getByText('Cobros brutos confirmados')).toBeInTheDocument();
    expect(within(table).getByText('$1,500.00 MXN')).toBeInTheDocument();

    // No details / summary accordion buttons in BalanceView
    expect(container.querySelectorAll('details.finance-exact-data')).toHaveLength(0);
    expect(screen.queryByText(/Ver valores exactos del flujo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ver detalle de conciliación/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ver datos de comparación/i)).not.toBeInTheDocument();

    // Accessible tables have finance-sr-only
    const waterfallSection = screen.getByRole('region', { name: 'Desglose de conciliación del periodo' });
    expect(waterfallSection).toHaveClass('finance-sr-only');
    const comparisonSection = screen.getByRole('region', { name: 'Datos de comparación entre periodos' });
    expect(comparisonSection).toHaveClass('finance-sr-only');
    const flowSection = screen.getByRole('region', { name: 'Valores exactos del flujo diario' });
    expect(flowSection).toHaveClass('finance-sr-only');
  });
});
