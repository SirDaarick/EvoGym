import { useState } from 'react';
import { Link } from 'react-router';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney } from '../../demo/adapter';
import { defaultPeriod, ownerSummary, validPeriod } from '../../demo/ownerOperations';
import { EmptyState, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';
import { NotebookNotice } from '../members/Members';
import { PeriodFields } from './PeriodFields';

export function Overview() {
  const { state } = useDemo();
  const [period, setPeriod] = useState(() => defaultPeriod(state));
  const summary = validPeriod(period) ? ownerSummary(state, period) : null;
  return <>
    <PageHeader eyebrow="PROPIETARIO · VISIÓN DEL PERIODO" title="Resumen del negocio" description="Cobros confirmados y diferencias observadas para revisar; no es un estado de resultados." />
    <Panel><PeriodFields period={period} onChange={setPeriod} /></Panel>
    {summary && <div className="bento-grid mt-6">
      <Panel><h2>Cobros confirmados</h2><p className="text-3xl font-bold">{formatMoney(summary.confirmedMinor)} MXN</p><p className="muted">Sin fondo inicial ni transferencias pendientes. No representa utilidad.</p>
        <TableRegion label="Cobros por método"><table><caption>{period.from} a {period.to} · MXN</caption><thead><tr><th scope="col">Método</th><th scope="col">Confirmado</th></tr></thead><tbody><tr><td>Efectivo</td><td>{formatMoney(summary.cashMinor)}</td></tr><tr><td>Tarjeta</td><td>{formatMoney(summary.cardMinor)}</td></tr></tbody></table></TableRegion>
        {!summary.confirmedCount && <p className="muted mt-4">No hay cobros confirmados en este periodo; el cero corresponde a registros locales, no al negocio real.</p>}
        <div className="flow"><Link to="/owner/history">Consultar movimientos</Link></div>
      </Panel><Panel><h2>Transferencias pendientes</h2><p className="text-3xl font-bold">{formatMoney(summary.transferPendingMinor)} MXN</p><Notice tone="warning">No incluidas en los cobros confirmados. No validan pago, inventario ni acceso. La recepción y validación de transferencias siguen sin definir.</Notice></Panel>
      <Panel><h2>Diferencias de efectivo</h2>{summary.shiftDiscrepancies.length ? <TableRegion label="Diferencias de turnos"><table><caption>Turnos cerrados en el periodo · comparación manual pendiente</caption><thead><tr><th scope="col">Turno</th><th scope="col">Diferencia MXN</th></tr></thead><tbody>{summary.shiftDiscrepancies.map(shift => <tr key={shift.id}><td>{shift.id}<p className="muted">{shift.window}</p></td><td>{formatMoney(shift.cashDifferenceMinor!)}</td></tr>)}</tbody></table></TableRegion> : <EmptyState title="Sin diferencias registradas">Solo se evalúan cierres con conteo; un turno abierto no está conciliado.</EmptyState>}<Link to="/owner/shifts">Revisar turnos y conteos</Link></Panel>
      <Panel><h2>Diferencias de inventario</h2>{summary.countDiscrepancies.length ? <TableRegion label="Diferencias de conteos"><table><caption>Observaciones en el periodo; no correcciones de stock</caption><thead><tr><th scope="col">Producto / turno</th><th scope="col">Diferencia de unidades</th></tr></thead><tbody>{summary.countDiscrepancies.map(count => <tr key={count.id}><td>{state.products.find(product => product.id === count.productId)?.name}<p className="muted">{count.shiftId}</p></td><td>{count.variance}</td></tr>)}</tbody></table></TableRegion> : <EmptyState title="Sin diferencias observadas">No equivale a un inventario físico validado; revisa los conteos disponibles.</EmptyState>}<Link to="/owner/inventory">Revisar inventario</Link></Panel>
    </div>}<NotebookNotice />
  </>;
}
