import { useEffect, useState } from 'react';
import { formatMoney } from '@/shared/formatters/money';
import { getPayrollHistory, type PayrollHistory } from '../../../api/payrollApi';
import type { AuthenticatedRequest } from '../../../api/membershipCheckoutApi';
import { Panel, TableRegion } from '../../../shared/ui';

const mxn = (minor: number) => `${formatMoney(minor)} MXN`;

interface Props { apiRequest: AuthenticatedRequest; range: { from: string; to: string }; branchId?: string }

/** Real payroll (F13 advances and payments) for the consolidated report; never reads demo or local stores. */
export function LivePayrollView({ apiRequest, range, branchId }: Props) {
  const [history, setHistory] = useState<PayrollHistory | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    getPayrollHistory(apiRequest, range.from, range.to, branchId)
      .then(response => { if (active) setHistory(response); })
      .catch(failure => { if (active) { setHistory(null); setError(failure instanceof Error ? failure.message : 'No se pudo cargar la nómina.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiRequest, range.from, range.to, branchId]);

  return <div className="finance-view finance-budget-view">
    <Panel>
      <p className="eyebrow">NÓMINA REGISTRADA</p>
      <h2>Pagos y anticipos de nómina</h2>
      <p className="muted">Egresos reales de nómina semanal del periodo; también aparecen como gastos generales, sin doble conteo.</p>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Cargando nómina…</p>}
    </Panel>
    {history && <>
      <section className="finance-kpis finance-budget-kpis" aria-label="Totales de nómina">
        <Panel className="finance-kpi"><span>Egreso de nómina</span><strong>{mxn(history.outflow_minor)}</strong></Panel>
        <Panel className="finance-kpi"><span>Anticipos</span><strong>{mxn(history.advances_minor)}</strong></Panel>
        <Panel className="finance-kpi"><span>Pagos semanales netos</span><strong>{mxn(history.paid_minor)}</strong></Panel>
      </section>
      <Panel>
        <h2>Historial semanal</h2>
        {history.weeks.length === 0 ? <p>No hay pagos ni anticipos de nómina en este periodo.</p> :
          <TableRegion label="Historial de nómina semanal">
            <table>
              <thead><tr><th>Semana</th><th>Sucursal</th><th>Colaborador</th><th className="numeric">Base</th>
                <th className="numeric">Anticipos</th><th className="numeric">Neto</th><th>Estado</th></tr></thead>
              <tbody>{history.weeks.flatMap(week => week.items.map(item => <tr key={`${week.week_start}-${week.branch_id}-${item.profile_id}`}>
                <td>{week.week_start}</td><td>{week.branch_name}</td><td>{item.full_name}</td>
                <td className="numeric">{mxn(item.base_minor)}</td><td className="numeric">{mxn(item.advances_minor)}</td>
                <td className="numeric">{mxn(item.net_minor)}</td>
                <td>{item.paid ? `Pagado (${item.paid.payment_method === 'cash' ? 'efectivo' : 'transferencia'})` : 'Pendiente'}</td>
              </tr>))}</tbody>
            </table>
          </TableRegion>}
      </Panel>
    </>}
  </div>;
}
