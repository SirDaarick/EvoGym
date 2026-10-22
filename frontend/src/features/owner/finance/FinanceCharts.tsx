import { useMemo } from 'react';
import { barX, barY, defineChart, group, text, waterfall } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { pie, polar, radialArc } from '@tanstack/charts/polar';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { formatMoney } from '../../../demo/adapter';
import { getFinanceTimeBins } from '../../../demo/financeReportSelector';
import type {
  FinanceDateRange,
  FinanceRow,
  FinanceSourceFamily,
  FinanceSourceTotal,
  FinanceTotals,
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
      className="finance-sr-only"
    >
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

export interface FinanceReconciliationWaterfallProps {
  totals?: FinanceTotals;
  grossMinor?: number;
  refundsMinor?: number;
  extrasMinor?: number;
  expensesMinor?: number;
  balanceMinor?: number;
}

export function FinanceReconciliationWaterfall({
  totals,
  grossMinor: propGross,
  refundsMinor: propRefunds,
  extrasMinor: propExtras,
  expensesMinor: propExpenses,
  balanceMinor: propBalance,
}: FinanceReconciliationWaterfallProps) {
  const grossMinor = totals?.grossMinor ?? propGross ?? 0;
  const refundsMinor = totals?.refundsMinor ?? propRefunds ?? 0;
  const extrasMinor = totals?.extrasMinor ?? propExtras ?? 0;
  const expensesMinor = totals?.expensesMinor ?? propExpenses ?? 0;
  const balanceMinor = totals?.balanceMinor ?? propBalance ?? (grossMinor - refundsMinor + extrasMinor - expensesMinor);

  const rawSteps = useMemo(() => [
    { step: 'Cobros brutos', amount: grossMinor / 100, deltaMinor: grossMinor },
    { step: 'Reembolsos', amount: -refundsMinor / 100, deltaMinor: -refundsMinor },
    { step: 'Extras', amount: extrasMinor / 100, deltaMinor: extrasMinor },
    { step: 'Gastos', amount: -expensesMinor / 100, deltaMinor: -expensesMinor },
  ], [grossMinor, refundsMinor, extrasMinor, expensesMinor]);

  const data = useMemo(() => {
    const raw = waterfall(rawSteps, { value: 'amount', total: true });
    return raw.map(item => ({
      ...item,
      step: item.kind === 'total' ? 'Balance final' : ((item as unknown as { step: string }).step ?? 'Balance final'),
      amountMinor: item.kind === 'total' ? balanceMinor : ((item as unknown as { deltaMinor: number }).deltaMinor ?? Math.round(item.delta * 100)),
    }));
  }, [rawSteps, balanceMinor]);

  const definition = useMemo(() => {
    const maxY = Math.max(0, ...data.map(d => Math.max(d.start, d.end)));
    const minY = Math.min(0, ...data.map(d => Math.min(d.start, d.end)));
    const headroom = (maxY - minY) * 0.18 || 10;
    const yScale = scaleLinear()
      .domain([minY < 0 ? minY - headroom : 0, (maxY || 1) + headroom])
      .nice();

    return defineChart({
      marks: [
        barY(data, {
          x: 'step',
          y1: 'start',
          y2: 'end',
          radius: 4,
          inset: 4,
          fill: datum => {
            if (datum.kind === 'total') return 'var(--finance-accent)';
            if (datum.kind === 'increase') return 'var(--finance-income, #10b981)';
            return 'var(--finance-outflow)';
          },
        }),
        text(data, {
          x: 'step',
          y: datum => datum.kind === 'decrease' || datum.amountMinor < 0 ? Math.min(datum.start, datum.end) : Math.max(datum.start, datum.end),
          text: datum => (datum.kind === 'increase' ? '+' : '') + formatMoney(datum.amountMinor),
          dy: datum => datum.kind === 'decrease' || datum.amountMinor < 0 ? 12 : -8,
          anchor: 'middle',
          fontSize: 11,
          fill: 'var(--finance-ink)',
        }),
      ],
      scales: {
        x: { scale: () => scaleBand().padding(0.2) },
        y: {
          scale: yScale,
          grid: true,
          axis: { label: 'Importe (MXN)' },
        },
      },
      keyboard: true,
    });
  }, [data]);

  return (
    <div className="finance-chart-wrap finance-waterfall-wrap">
      <Chart
        definition={definition}
        height={260}
        ariaLabel="Conciliación del periodo en cascada"
      />
      <ul className="finance-chart-legend" aria-label="Leyenda de conciliación">
        <li><span className="finance-dot finance-dot-income" />Aumentos / Cobros</li>
        <li><span className="finance-dot finance-dot-out" />Disminuciones / Gastos</li>
        <li><span className="finance-dot finance-dot-total" />Balance final</li>
      </ul>
      <section
        role="region"
        aria-label="Desglose de conciliación del periodo"
        className="finance-sr-only"
      >
        <div className="table-region">
          <table>
            <thead>
              <tr>
                <th>Concepto</th>
                <th className="numeric">Variación</th>
                <th className="numeric">Nivel resultante</th>
              </tr>
            </thead>
            <tbody>
              {data.map(item => (
                <tr key={item.step}>
                  <td>{item.step}</td>
                  <td className="numeric">
                    {item.kind === 'total'
                      ? formatMoney(item.amountMinor)
                      : `${item.delta >= 0 ? '+' : ''}${formatMoney(item.amountMinor)}`}
                  </td>
                  <td className="numeric">{formatMoney(Math.round(item.end * 100))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export interface PeriodMetrics {
  inflowsMinor: number;
  outflowsMinor: number;
  balanceMinor: number;
}

export interface FinancePeriodComparisonChartProps {
  current: PeriodMetrics;
  previous: PeriodMetrics;
}

interface ComparisonDatum {
  metric: string;
  series: 'Periodo actual' | 'Periodo anterior';
  amount: number;
  amountMinor: number;
}

export function FinancePeriodComparisonChart({
  current,
  previous,
}: FinancePeriodComparisonChartProps) {
  const data: ComparisonDatum[] = useMemo(() => [
    {
      metric: 'Entradas',
      series: 'Periodo actual',
      amount: current.inflowsMinor / 100,
      amountMinor: current.inflowsMinor,
    },
    {
      metric: 'Entradas',
      series: 'Periodo anterior',
      amount: previous.inflowsMinor / 100,
      amountMinor: previous.inflowsMinor,
    },
    {
      metric: 'Salidas',
      series: 'Periodo actual',
      amount: current.outflowsMinor / 100,
      amountMinor: current.outflowsMinor,
    },
    {
      metric: 'Salidas',
      series: 'Periodo anterior',
      amount: previous.outflowsMinor / 100,
      amountMinor: previous.outflowsMinor,
    },
    {
      metric: 'Balance',
      series: 'Periodo actual',
      amount: current.balanceMinor / 100,
      amountMinor: current.balanceMinor,
    },
    {
      metric: 'Balance',
      series: 'Periodo anterior',
      amount: previous.balanceMinor / 100,
      amountMinor: previous.balanceMinor,
    },
  ], [current, previous]);

  const definition = useMemo(() => {
    const maxY = Math.max(0, ...data.map(d => d.amount));
    const minY = Math.min(0, ...data.map(d => d.amount));
    const headroom = (maxY - minY) * 0.16 || 10;
    const yScale = scaleLinear()
      .domain([minY < 0 ? minY - headroom : 0, (maxY || 1) + headroom])
      .nice();

    return defineChart({
      marks: [
        barY(data, {
          x: 'metric',
          y: 'amount',
          z: 'series',
          layout: group({ padding: 0.16 }),
          inset: 4,
          radius: 4,
          fill: datum => datum.series === 'Periodo actual'
            ? 'var(--finance-accent)'
            : 'var(--finance-outflow)',
        }),
        text(data, {
          x: 'metric',
          y: 'amount',
          z: 'series',
          text: datum => formatMoney(datum.amountMinor),
          dx: datum => datum.series === 'Periodo actual' ? -20 : 20,
          dy: datum => datum.amount >= 0 ? -8 : 12,
          anchor: 'middle',
          fontSize: 10,
          fill: 'var(--finance-ink)',
        }),
      ],
      scales: {
        x: { scale: () => scaleBand().padding(0.24) },
        y: {
          scale: yScale,
          grid: true,
          axis: { label: 'Importe (MXN)' },
        },
      },
      keyboard: true,
    });
  }, [data]);

  return (
    <div className="finance-chart-wrap finance-comparison-wrap">
      <Chart
        definition={definition}
        height={240}
        ariaLabel="Comparación de periodos"
      />
      <ul className="finance-chart-legend" aria-label="Series de comparación de periodos">
        <li><span className="finance-dot finance-dot-current" />Periodo actual</li>
        <li><span className="finance-dot finance-dot-previous" />Periodo anterior</li>
      </ul>
      <section
        role="region"
        aria-label="Datos de comparación entre periodos"
        className="finance-sr-only"
      >
        <div className="table-region">
          <table>
            <thead>
              <tr>
                <th>Métrica</th>
                <th className="numeric">Periodo actual</th>
                <th className="numeric">Periodo anterior</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Entradas</td>
                <td className="numeric">{formatMoney(current.inflowsMinor)}</td>
                <td className="numeric">{formatMoney(previous.inflowsMinor)}</td>
              </tr>
              <tr>
                <td>Salidas</td>
                <td className="numeric">{formatMoney(current.outflowsMinor)}</td>
                <td className="numeric">{formatMoney(previous.outflowsMinor)}</td>
              </tr>
              <tr>
                <td>Balance</td>
                <td className="numeric">{formatMoney(current.balanceMinor)}</td>
                <td className="numeric">{formatMoney(previous.balanceMinor)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const sourceFamilyColors: Record<FinanceSourceFamily | string, string> = {
  membership: 'var(--finance-accent, #bd561c)',
  product: 'var(--finance-outflow, #506574)',
  visit: 'var(--finance-income, #10b981)',
  supplement: '#8b5cf6',
  glove: '#d97706',
  locker: '#0284c7',
  unknown: '#64748b',
};

export interface FinanceSourcesDonutChartProps {
  totals: FinanceSourceTotal[];
}

export function FinanceSourcesDonutChart({ totals }: FinanceSourcesDonutChartProps) {
  const slices = useMemo(() => {
    const positive = totals.filter(item => item.amountMinor > 0);
    const totalMinor = positive.reduce((sum, item) => sum + item.amountMinor, 0);
    return positive
      .sort((a, b) => b.amountMinor - a.amountMinor)
      .map(item => {
        const label = sourceLabels[item.sourceFamily] ?? item.sourceFamily;
        const percent = totalMinor > 0 ? Math.round((item.amountMinor / totalMinor) * 100) : 0;
        return {
          sourceFamily: item.sourceFamily,
          label,
          amount: item.amountMinor / 100,
          amountMinor: item.amountMinor,
          count: item.count,
          percent,
          color: sourceFamilyColors[item.sourceFamily] ?? 'var(--finance-accent)',
        };
      });
  }, [totals]);

  const definition = useMemo(() => {
    if (!slices.length) return null;
    return defineChart({
      marks: [
        polar({
          inset: 6,
          radiusRatio: 0.94,
          marks: [
            radialArc(pie(slices, { value: 'amount' }), {
              innerRadius: ({ radius }) => radius * 0.62,
              cornerRadius: 4,
              color: 'sourceFamily',
              key: 'sourceFamily',
            }),
          ],
          scales: { angle: null, radius: null },
        }),
      ],
      scales: { x: null, y: null },
      color: {
        domain: slices.map(s => s.sourceFamily),
        range: slices.map(s => s.color),
      },
      keyboard: true,
    });
  }, [slices]);

  return (
    <section className="finance-donut-section">
      <h2>Distribución por origen</h2>
      {definition && slices.length > 0 ? (
        <>
          <div className="finance-donut-body">
            <div className="finance-donut-chart-wrap">
              <Chart
                definition={definition}
                height={240}
                ariaLabel="Distribución de cobros por origen"
              />
            </div>
            <ul className="finance-donut-legend" aria-label="Proporciones por origen de cobro">
              {slices.map(slice => (
                <li key={slice.sourceFamily}>
                  <span className="finance-dot" style={{ backgroundColor: slice.color }} />
                  <span className="finance-donut-label">{slice.label}</span>
                  <strong className="numeric">{slice.percent}%</strong>
                  <small className="numeric">{formatMoney(slice.amountMinor)} MXN</small>
                </li>
              ))}
            </ul>
          </div>
          <section
            role="region"
            aria-label="Desglose porcentual por origen"
            className="finance-sr-only"
          >
            <div className="table-region">
              <table>
                <thead>
                  <tr>
                    <th>Origen</th>
                    <th className="numeric">Importe</th>
                    <th className="numeric">Proporción</th>
                    <th className="numeric">Movimientos</th>
                  </tr>
                </thead>
                <tbody>
                  {slices.map(slice => (
                    <tr key={slice.sourceFamily}>
                      <td>{slice.label}</td>
                      <td className="numeric">{formatMoney(slice.amountMinor)}</td>
                      <td className="numeric">{slice.percent}%</td>
                      <td className="numeric">{slice.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <p className="finance-chart-empty">Sin cobros para graficar distribución.</p>
      )}
    </section>
  );
}
