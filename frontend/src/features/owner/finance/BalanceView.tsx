import { formatMoney } from '../../../demo/adapter';
import { getFinanceComparison, getFinanceTimeBins, getPreviousComparableRange, type FinanceProjection } from '../../../demo/financeReportSelector';
import type { FinanceDateRange } from '../../../demo/financeReportSelector';
import { Badge, Panel } from '../../../shared/ui';
import { FinanceFlowChart } from './FinanceCharts';
import type { FlowGranularity } from './types';

interface BalanceViewProps {
  projection: FinanceProjection;
  previous: FinanceProjection;
  range: FinanceDateRange;
  granularity: FlowGranularity;
  onGranularityChange: (value: FlowGranularity) => void;
}

const mxn = (minor: number) => `${formatMoney(minor)} MXN`;

export function BalanceView({ projection, previous, range, granularity, onGranularityChange }: BalanceViewProps) {
  const { totals } = projection;
  const previousRange = getPreviousComparableRange(range);
  const comparison = getFinanceComparison(totals.balanceMinor, previous.totals.balanceMinor);
  const currentDays = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000 + 1;
  const previousDays = (Date.parse(`${previousRange.to}T00:00:00Z`) - Date.parse(`${previousRange.from}T00:00:00Z`)) / 86400000 + 1;
  const orphanCount = projection.rows.filter(row => row.orphan).length;
  const flowTotals = getFinanceTimeBins(projection.rows, range).reduce(
    (total, bin) => ({
      inflows: total.inflows + bin.inflowMinor,
      outflows: total.outflows + bin.outflowMinor,
    }),
    { inflows: 0, outflows: 0 },
  );
  const { inflows, outflows } = flowTotals;
  return <div className="finance-view finance-balance-view">
      <section className="finance-kpis" aria-label="Indicadores del balance registrado">
      <Panel className="finance-kpi finance-kpi-inflow">
        <span>Entradas registradas</span>
        <strong>{mxn(inflows)}</strong>
        <small>Cobros confirmados y extras positivos</small>
      </Panel>
      <Panel className="finance-kpi finance-kpi-outflow">
        <span>Salidas registradas</span>
        <strong>{mxn(outflows)}</strong>
        <small>Reembolsos, gastos y extras negativos</small>
      </Panel>
      <Panel className="finance-kpi finance-kpi-balance">
        <span>Balance registrado</span>
        <strong>{mxn(totals.balanceMinor)}</strong>
        <small>No representa saldo bancario ni utilidad</small>
      </Panel>
    </section>
    <Panel className="finance-flow-panel">
      <div className="finance-section-heading">
        <div>
          <p className="eyebrow">MOVIMIENTO REGISTRADO</p>
          <h2>Flujo de entradas y salidas</h2>
          <p className="muted">
            Cada barra agrega las filas válidas del periodo; salidas y entradas parten de cero.
          </p>
        </div>
        <p className="finance-chart-total">Neto del gráfico <strong>{mxn(inflows - outflows)}</strong></p>
      </div>
    <FinanceFlowChart rows={projection.rows} range={range} granularity={granularity} onGranularityChange={onGranularityChange} />
    </Panel>
    <div className="finance-balance-details">
      <Panel><h2>Conciliación del periodo</h2><dl className="finance-breakdown">
        <dt>Cobros brutos confirmados</dt><dd>{mxn(totals.grossMinor)}</dd>
        <dt>Reembolsos registrados</dt><dd>−{mxn(totals.refundsMinor)}</dd>
        <dt>Neto de cobros</dt><dd>{mxn(totals.netMinor)}</dd>
        <dt>Extras registrados</dt><dd>{mxn(totals.extrasMinor)}</dd>
        <dt>Gastos registrados</dt><dd>−{mxn(totals.expensesMinor)}</dd>
        <dt>Transferencias pendientes</dt><dd>{mxn(totals.pendingMinor)}</dd>
      </dl><p className="muted">Lo pendiente se muestra aparte y no se incorpora al balance confirmado.</p></Panel>
      <Panel><h2>Comparación de periodos</h2>
        <p>Periodo seleccionado: <strong>{range.from}–{range.to}</strong> ({currentDays} días).</p>
        <p>Periodo inmediatamente anterior de igual duración: <strong>{previousRange.from}–{previousRange.to}</strong> ({previousDays} días).</p>
        <p>
          Cambio del balance registrado: <strong>{mxn(comparison.deltaMinor)}</strong>{' '}
          {comparison.deltaPercent === null
            ? <Badge>Sin porcentaje comparable</Badge>
            : <span>({comparison.deltaPercent.toFixed(1)}%)</span>}
        </p>
      </Panel>
    </div>
    {projection.issues.length > 0 && (
      <Panel className="finance-warning">
        <h2>Datos omitidos del cálculo</h2>
        <p>
          Se excluyeron {projection.issues.length} registros por monto, fecha inválidos o riesgo de desbordamiento.
          El resultado utiliza solo filas válidas.
        </p>
        <ul>
          {projection.issues.slice(0, 10).map(issue => (
            <li key={`${issue.id}:${issue.reason}`}>{issue.id} · {issue.reason}</li>
          ))}
        </ul>
        {projection.issues.length > 10 && <p>Y {projection.issues.length - 10} registros adicionales.</p>}
      </Panel>
    )}
    {orphanCount > 0 && (
      <Panel className="finance-warning">
        <h2>Evidencia sin registro de origen</h2>
        <p>
          {orphanCount} eventos del libro no coinciden con una fuente conocida.
          Se conservaron sus importes porque el evento de libro es la evidencia confirmada disponible.
        </p>
      </Panel>
    )}
  </div>;
}
