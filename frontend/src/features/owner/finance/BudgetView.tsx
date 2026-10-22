import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { formatMoney } from '../../../demo/adapter';
import { computeFixedCostsSummary } from '../../../demo/expenseReportSelector';
import { saveFixedCosts, type FixedCostsConfig } from '../../../demo/fixedCostsStore';
import type { StaffProfile } from '../../staff/staffStore';
import { Button, Field, Notice, Panel, TableRegion } from '../../../shared/ui';
import { SimpleFinanceTable } from './FinanceTable';

const mxn = (minor: number) => `${formatMoney(minor)} MXN`;
type CostKey = keyof FixedCostsConfig;
const costFields: { key: CostKey; label: string }[] = [
  { key: 'rentMinor', label: 'Renta' },
  { key: 'aguaMinor', label: 'Agua' },
  { key: 'luzMinor', label: 'Luz' },
  { key: 'internetMinor', label: 'Internet / teléfono' },
  { key: 'basuraMinor', label: 'Basura' },
];

function toDraft(config: FixedCostsConfig): Record<CostKey, string> {
  return Object.fromEntries(costFields.map(({ key }) => [key, (config[key] / 100).toFixed(2)])) as Record<CostKey, string>;
}

function parseBudgetAmount(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const minor = whole * 100 + fraction;
  return Number.isSafeInteger(minor) ? minor : null;
}

interface BudgetViewProps { costs: FixedCostsConfig; staff: StaffProfile[]; }

export function BudgetView({ costs, staff }: BudgetViewProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<CostKey, string>>(() => toDraft(costs));
  const [budgetError, setBudgetError] = useState('');
  const summary = computeFixedCostsSummary(costs, staff);

  const breakdownRows = useMemo(() => [
    { concept: 'Renta', amount: mxn(costs.rentMinor), isTotal: false },
    { concept: 'Agua', amount: mxn(costs.aguaMinor), isTotal: false },
    { concept: 'Luz', amount: mxn(costs.luzMinor), isTotal: false },
    { concept: 'Internet / teléfono', amount: mxn(costs.internetMinor), isTotal: false },
    { concept: 'Basura', amount: mxn(costs.basuraMinor), isTotal: false },
    { concept: 'Personal activo', amount: mxn(summary.payrollMinor), isTotal: false },
    { concept: 'Total mensual de referencia', amount: mxn(summary.totalFixedMonthlyMinor), isTotal: true },
  ], [costs, summary.payrollMinor, summary.totalFixedMonthlyMinor]);

  const breakdownColumns = useMemo<ColumnDef<{ concept: string; amount: string; isTotal: boolean }, unknown>[]>(() => [
    {
      accessorKey: 'concept',
      header: 'Concepto',
      cell: info => {
        const item = info.row.original;
        return item.isTotal ? <strong>{item.concept}</strong> : item.concept;
      },
    },
    {
      accessorKey: 'amount',
      header: 'Importe mensual (MXN)',
      cell: info => {
        const item = info.row.original;
        return (
          <span className="numeric">
            {item.isTotal ? <strong>{item.amount}</strong> : item.amount}
          </span>
        );
      },
    },
  ], []);

  useEffect(() => {
    setDraft(toDraft(costs));
    setBudgetError('');
  }, [costs, editing]);

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(costFields.map(({ key }) => [key, parseBudgetAmount(draft[key])])) as Record<CostKey, number | null>;
    if (Object.values(values).some(value => value === null)) {
      setBudgetError('Escribe un importe válido en pesos y, opcionalmente, hasta dos centavos. Un campo vacío no equivale a cero.');
      return;
    }
    const next = saveFixedCosts(values as FixedCostsConfig);
    setDraft(toDraft(next));
    setBudgetError('');
    setEditing(false);
  }

  return <div className="finance-view finance-budget-view">
    <Panel className="finance-budget-intro">
      <div>
        <p className="eyebrow">SUPUESTOS CONFIGURADOS</p>
        <h2>Costos fijos mensuales</h2>
        <p>
          Estos importes son configuración de presupuesto: <strong>no son pagos realizados</strong>,
          no se restan del balance y no constituyen un resultado histórico, punto de equilibrio ni pronóstico.
        </p>
      </div>
      <div className="finance-budget-actions">
        <Button variant="secondary" onClick={() => setEditing(value => !value)}>
          {editing ? 'Cancelar ajustes' : 'Ajustar costos fijos'}
        </Button>
        <Link className="button button-secondary" to="/owner/staff">
          Gestionar equipo y sueldos
        </Link>
      </div>
    </Panel>

    <section className="finance-kpis finance-budget-kpis" aria-label="Presupuesto mensual configurado">
      <Panel className="finance-kpi">
        <span>Renta mensual</span>
        <strong>{mxn(summary.rentMinor)}</strong>
      </Panel>
      <Panel className="finance-kpi">
        <span>Servicios mensuales</span>
        <strong>{mxn(summary.servicesMinor)}</strong>
        <small>Agua, luz, internet/teléfono y basura</small>
      </Panel>
      <Panel className="finance-kpi">
        <span>Nómina mensual estimada</span>
        <strong>{mxn(summary.payrollMinor)}</strong>
        <small>Personal activo configurado</small>
      </Panel>
    </section>

    <Panel>
      <h2>Desglose mensual configurado</h2>
      <div className="finance-constrained-table">
        <SimpleFinanceTable
          label="Desglose mensual configurado"
          rows={breakdownRows}
          columns={breakdownColumns}
        />
      </div>
    </Panel>

    {editing && (
      <Panel>
        <h2>Ajustar supuestos mensuales</h2>
        <form className="finance-budget-form" noValidate onSubmit={save}>
          {costFields.map(({ key, label }) => (
            <Field
              key={key}
              id={`budget-${key}`}
              label={`${label} (MXN/mes)`}
              type="text"
              inputMode="decimal"
              value={draft[key]}
              onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))}
            />
          ))}
          {budgetError && (
            <div className="finance-budget-error" role="alert">
              <Notice tone="error">{budgetError}</Notice>
            </div>
          )}
          <div className="finance-budget-submit">
            <button className="button button-primary" type="submit">Guardar costos</button>
          </div>
        </form>
      </Panel>
    )}

    <Panel>
      <div className="finance-section-heading">
        <div>
          <p className="eyebrow">NÓMINA CONFIGURADA</p>
          <h2>Personal activo</h2>
          <p className="muted">Estimación configurada del personal; no confirma pagos de nómina.</p>
        </div>
      </div>
      {summary.staffPayroll.length ? (
        <TableRegion label="Nómina mensual estimada">
          <table>
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Rol</th>
                <th>Turno</th>
                <th className="numeric">Mensual estimado (MXN)</th>
              </tr>
            </thead>
            <tbody>
              {summary.staffPayroll.map(person => {
                const profile = staff.find(item => item.id === person.id);
                const role = profile?.role === 'RECEPTION'
                  ? 'Recepción'
                  : person.roleDescription ?? '—';
                return (
                  <tr key={person.id}>
                    <td>{person.name}</td>
                    <td>{role}</td>
                    <td>{profile?.shift ?? '—'}</td>
                    <td className="numeric">{mxn(person.monthlySalaryMinor)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableRegion>
      ) : (
        <p>No hay personal activo con salario mensual configurado.</p>
      )}
    </Panel>

    <div className="finance-print-only">
      <p>Presupuesto mensual configurado · No son pagos realizados ni historial de gasto.</p>
      <table>
        <thead><tr><th>Rubro</th><th>Importe MXN</th></tr></thead>
        <tbody>
          {costFields.map(({ key, label }) => (
            <tr key={key}><td>{label}</td><td>{mxn(costs[key])}</td></tr>
          ))}
          <tr><td>Nómina configurada</td><td>{mxn(summary.payrollMinor)}</td></tr>
        </tbody>
      </table>
      <p>Total mensual configurado: {mxn(summary.totalFixedMonthlyMinor)}</p>
    </div>
  </div>;
}
