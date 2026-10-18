import type { FinanceDateRange, FinanceProjection } from '../../../demo/financeReportSelector';
import { isValidFinanceRange } from '../../../demo/financeReportSelector';
import { Button, Field, Notice, PageHeader, Panel } from '../../../shared/ui';
import type { FinanceTab } from './types';

const labels: Record<FinanceTab, string> = {
  balance: 'Balance',
  cobros: 'Cobros',
  gastos: 'Gastos',
  presupuesto: 'Presupuesto',
};

interface FinanceToolbarProps {
  range: FinanceDateRange;
  projection: FinanceProjection;
  onRangeChange: (key: keyof FinanceDateRange, value: string) => void;
  active: FinanceTab;
  printDetail: string;
}

export function FinanceToolbar({ range, projection, onRangeChange, active, printDetail }: FinanceToolbarProps) {
  const rangeValid = isValidFinanceRange(range);
  const generatedAt = new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
  });

  return <>
    <PageHeader
      eyebrow="OPERACIÓN"
      title="Finanzas"
      description="Movimientos registrados para el periodo seleccionado."
      action={
        <Button variant="secondary" onClick={() => window.print()}>
          Exportar / imprimir
        </Button>
      }
    />
    <Panel className="finance-period">
      <div className="finance-period-heading">
        <div>
          <h2>Periodo del informe</h2>
          <p className="muted">Fechas locales de Ciudad de México · máximo 366 días.</p>
        </div>
        {!rangeValid && <span className="finance-period-status">Corrige el rango</span>}
      </div>
      <div className="finance-date-fields">
        <Field
          id="finance-from"
          label="Desde"
          type="date"
          value={range.from}
          aria-invalid={!rangeValid}
          onChange={event => onRangeChange('from', event.target.value)}
        />
        <Field
          id="finance-to"
          label="Hasta"
          type="date"
          value={range.to}
          aria-invalid={!rangeValid}
          onChange={event => onRangeChange('to', event.target.value)}
        />
      </div>
      {!rangeValid && (
        <div role="status">
          <Notice tone="error">Revisa las fechas y la duración del rango.</Notice>
        </div>
      )}
    </Panel>
    <div className="finance-print-meta" aria-hidden="true">
      <span>
        Vista impresa: {labels[active]} · {range.from} a {range.to} · MXN · America/Mexico_City
      </span>
      <span>
        {printDetail} · {projection.rows.length} filas válidas · {generatedAt}
      </span>
    </div>
  </>;
}
