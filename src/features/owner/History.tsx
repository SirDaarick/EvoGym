import { useState } from 'react';
import { Link } from 'react-router';
import type { PaymentMethod } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney } from '../../demo/adapter';
import { categoryLabels, defaultPeriod, ownerHistory, validPeriod, type HistoryFilter } from '../../demo/ownerOperations';
import { Badge, EmptyState, PageHeader, Panel, TableRegion } from '../../shared/ui';
import { NotebookNotice, paymentMethods } from '../members/Members';
import { PeriodFields } from './PeriodFields';

export function History() {
  const { state } = useDemo();
  const [filter, setFilter] = useState<HistoryFilter>(() => ({ ...defaultPeriod(state), category: 'all', method: 'all' }));
  const records = ownerHistory(state, filter);
  return <>
    <PageHeader eyebrow="PROPIETARIO · TRAZABILIDAD LOCAL" title="Historial de movimientos" description="Pagos, ventas, cantidades, conteos y turnos de demostración. Consulta de solo lectura." />
    <Panel><PeriodFields period={filter} onChange={period => setFilter({ ...filter, ...period })} />
      <div className="grid gap-4 sm:grid-cols-2"><div className="field"><label htmlFor="history-category">Categoría</label><select id="history-category" value={filter.category} onChange={event => setFilter({ ...filter, category: event.target.value as HistoryFilter['category'] })}><option value="all">Todas las categorías</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="field"><label htmlFor="history-method">Método</label><select id="history-method" value={filter.method} onChange={event => setFilter({ ...filter, method: event.target.value as PaymentMethod | 'all' })}><option value="all">Todos / no aplica</option>{Object.entries(paymentMethods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
      <p className="muted">Filtrar por método muestra solo operaciones de pago. Reposición, merma, conteo y turnos no tienen método ni importe de venta.</p>
    </Panel>
    {validPeriod(filter) && <Panel className="mt-6">{records.length ? <TableRegion label="Historial global de demostración"><table><caption>{records.length} registros · referencias locales, no comprobantes ni folios físicos</caption><thead><tr><th scope="col">Fecha / categoría</th><th scope="col">Registro y referencia</th><th scope="col">Turno</th><th scope="col">Importe MXN</th><th scope="col">Método / estado</th></tr></thead><tbody>{records.map(record => <tr key={`${record.category}-${record.id}`}><td><time dateTime={record.recordedAt}>{new Date(record.recordedAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</time><p className="muted">{categoryLabels[record.category]}</p></td><td>{record.description}<p className="muted break-words">{record.id}</p><details><summary>Ver detalle</summary><p className="mt-2">{record.detail}</p>{record.memberId && <Link to={`/owner/members/${record.memberId}`}>Ver socio</Link>}</details></td><td>{record.shiftId}</td><td>{record.amountMinor === null ? 'No aplica' : formatMoney(record.amountMinor)}</td><td>{record.method ? paymentMethods[record.method] : 'No aplica'}<div className="mt-2"><Badge tone={record.method === 'transfer' ? 'warning' : 'neutral'}>{record.status}</Badge></div></td></tr>)}</tbody></table></TableRegion> : <EmptyState title="Sin movimientos para estos filtros">No hay registros locales coincidentes. Cambia el periodo, categoría o método.</EmptyState>}</Panel>}
    <NotebookNotice /><div className="flow"><Link to="/owner/shifts">Consultar resumen por turno</Link></div>
  </>;
}
