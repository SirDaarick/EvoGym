import { useMemo } from 'react';
import { barX, barY, defineChart, group } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { formatMoney } from '../../../demo/adapter';
import { getFinanceTimeBins } from '../../../demo/financeReportSelector';
import type {
  FinanceDateRange,
  FinanceRow,
  FinanceSourceTotal,
} from '../../../demo/financeReportSelector';
import type { FlowGranularity } from './types';

interface FlowChartProps {
  rows: FinanceRow[];
  range: FinanceDateRange;
  granularity: FlowGranularity;
  onGranularityChange: (value: FlowGranularity) => void;
}

interface FlowDatum {
  period: string;
  series: 'Entradas' | 'Salidas';
  amount: number;
  amountMinor: number;
}

const sourceLabels: Record<string, string> = {
  membership: 'Membresías',
  product: 'Productos',
  visit: 'Visitas',
  supplement: 'Suplementos',
  glove: 'Renta de guantes',
  locker: 'Renta de casilleros',
  unknown: 'Origen desconocido',
};

function weekStart(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

export function FinanceFlowChart({
  rows,
  range,
  granularity,
  onGranularityChange,
}: FlowChartProps) {
  const data: FlowDatum[] = useMemo(() => {
    const bins = getFinanceTimeBins(rows, range);
    const grouped = new Map<string, { inflow: number; outflow: number }>();

    for (const bin of bins) {
      const period = granularity === 'day' ? bin.key : weekStart(bin.key);
      const current = grouped.get(period) ?? { inflow: 0, outflow: 0 };
      current.inflow += bin.inflowMinor;
      current.outflow += bin.outflowMinor;
      grouped.set(period, current);
    }

    return [...grouped.entries()].flatMap(([period, value]) => [
      {
        period,
        series: 'Entradas' as const,
        amount: value.inflow / 100,
        amountMinor: value.inflow,
      },
      {
        period,
        series: 'Salidas' as const,
        amount: value.outflow / 100,
        amountMinor: value.outflow,
      },
    ]);
  }, [rows, range, granularity]);

  const definition = defineChart({
    marks: [barY(data, {
      x: 'period',
      y: 'amount',
      z: 'series',
      layout: group({ padding: 0.14 }),
      inset: 2,
      fill: datum => datum.series === 'Entradas'
        ? 'var(--finance-accent)'
        : 'var(--finance-outflow)',
    })],
    scales: {
      x: { scale: () => scaleBand().padding(0.18) },
      y: {
        scale: scaleLinear,
        nice: true,
        zero: true,
        grid: true,
        axis: { label: 'Importe (MXN)' },
      },
    },
    keyboard: true,
  });

  const periodCount = new Set(data.map(item => item.period)).size;
  const flowLabel = `Entradas y salidas ${granularity === 'day' ? 'diarias' : 'semanales'}`;

  return <div className="finance-chart-wrap">
    <label className="finance-granularity">
      Agrupar por
      <select
        aria-label="Agrupar por"
        value={granularity}
        onChange={event => onGranularityChange(event.target.value as FlowGranularity)}
      >
        <option value="day">Día</option>
        <option value="week">Semana</option>
      </select>
    </label>
    {data.some(item => item.amountMinor !== 0) ? (
      <Chart
        definition={definition}
        height={Math.max(260, Math.min(520, periodCount * 42))}
        ariaLabel={flowLabel}
      />
    ) : (
      <p className="finance-chart-empty">Sin movimientos en el periodo seleccionado.</p>
    )}
    <ul className="finance-chart-legend" aria-label="Series del gráfico">
      <li><span className="finance-dot finance-dot-in" />Entradas</li>
      <li><span className="finance-dot finance-dot-out" />Salidas</li>
    </ul>
    <section
      role="region"
      aria-label={`Valores exactos del flujo ${granularity === 'day' ? 'diario' : 'semanal'}`}
    >
      <details className="finance-exact-data">
        <summary>Ver valores exactos del flujo</summary>
        <div className="table-region">
          <table>
            <thead>
              <tr>
                <th>Periodo</th>
                <th className="numeric">Entradas</th>
                <th className="numeric">Salidas</th>
              </tr>
            </thead>
            <tbody>
              {[...new Set(data.map(item => item.period))].map(period => {
                const inflow = data.find(item =>
                  item.period === period && item.series === 'Entradas'
                )?.amountMinor ?? 0;
                const outflow = data.find(item =>
                  item.period === period && item.series === 'Salidas'
                )?.amountMinor ?? 0;

                return (
                  <tr key={period}>
                    <td>{period}</td>
                    <td className="numeric">{formatMoney(inflow)}</td>
                    <td className="numeric">{formatMoney(outflow)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  </div>;
}

export function FinanceRankingChart({
  title,
  totals,
}: {
  title: string;
  totals: FinanceSourceTotal[];
}) {
  const ranked = totals
    .filter(row => row.amountMinor !== 0)
    .sort((left, right) => Math.abs(right.amountMinor) - Math.abs(left.amountMinor));
  const data = ranked.map(row => ({
    source: sourceLabels[row.sourceFamily] ?? row.sourceFamily,
    amount: row.amountMinor / 100,
  }));
  const definition = defineChart({
    marks: [barX(data, {
      x: 'amount',
      y: 'source',
      fill: 'var(--finance-accent)',
      inset: 3,
      radius: 4,
    })],
    scales: {
      x: {
        scale: scaleLinear,
        nice: true,
        zero: true,
        grid: true,
        axis: { label: 'Importe (MXN)' },
      },
      y: { scale: () => scaleBand().padding(0.18) },
    },
    keyboard: true,
  });

  return <section className="finance-ranking">
    <h2>{title}</h2>
    {ranked.length ? (
      <>
        <Chart
          definition={definition}
          height={Math.max(160, ranked.length * 42)}
          ariaLabel={title}
        />
        <ul className="finance-ranking-list">
          {ranked.map(row => (
            <li key={row.sourceFamily}>
              <span>{sourceLabels[row.sourceFamily] ?? row.sourceFamily}</span>
              <strong>{formatMoney(row.amountMinor)} MXN</strong>
              <small>{row.count} movimientos</small>
            </li>
          ))}
        </ul>
      </>
    ) : (
      <p className="finance-chart-empty">Sin movimientos filtrados por origen.</p>
    )}
  </section>;
}
