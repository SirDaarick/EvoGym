import { useState } from 'react';
import { Link } from 'react-router';
import type { Role, ShiftWindow } from '../../domain/models';
import { rolePath } from '../../app/navigation';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { closeShift, openShift, shiftSummary } from '../../demo/shiftOperations';
import { Button, Field, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';
import { NotebookNotice } from '../members/Members';

export function Shifts({ role }: { role: Role }) {
  const { state, transact } = useDemo();
  const [selectedId, setSelectedId] = useState(state.currentShiftId);
  const [counted, setCounted] = useState('');
  const [opening, setOpening] = useState('');
  const [window, setWindow] = useState<ShiftWindow>('14:00–22:00');
  const [review, setReview] = useState<{ countMinor: number; expectedMinor: number; revision: number } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const selected = role === 'RECEPTION' ? state.currentShiftId : selectedId;
  const shift = state.shifts.find(item => item.id === selected)!;
  const current = state.shifts.find(item => item.id === state.currentShiftId)!;
  const summary = shiftSummary(state, selected);
  const cash = (value: number | undefined) => value === undefined ? 'Sin registrar' : `${formatMoney(value)} MXN`;
  return <>
    <PageHeader eyebrow="TURNO · CONTROL MANUAL" title="Turno de trabajo" description="Fondo inicial, cobros confirmados y conteo de efectivo son conceptos separados." />
    {role === 'OWNER' && <div className="field"><label htmlFor="shift-selection">Turno a consultar</label><select id="shift-selection" value={selectedId} onChange={event => { setSelectedId(event.target.value); setReview(null); setCounted(''); }}>{state.shifts.map(item => <option key={item.id} value={item.id}>{item.id} · {item.window} · {item.status === 'open' ? 'Abierto' : 'Cerrado'}</option>)}</select></div>}
    <div className="bento-grid"><Panel><h2>{shift.status === 'open' ? 'Turno abierto' : 'Turno cerrado'}</h2><p>{shift.id} · {shift.window}</p><p className="muted">Apertura demo: {shift.openedAt}. Los horarios no controlan acceso ni asignación de personal.</p>
      <dl className="grid gap-3"><div><dt>Fondo inicial · no es ingreso</dt><dd className="font-bold">{cash(shift.openingCashMinor)}</dd></div><div><dt>Cobros confirmados · sin fondo inicial</dt><dd className="font-bold">{cash(summary.confirmedMinor)}</dd></div><div><dt>Efectivo esperado · fondo + cobros en efectivo</dt><dd className="font-bold">{cash(shift.status === 'closed' ? shift.expectedCashAtCloseMinor : summary.expectedCashMinor)}</dd></div>
        <div><dt>Efectivo contado</dt><dd>{cash(shift.countedCashMinor)}</dd></div><div><dt>Diferencia de efectivo</dt><dd>{cash(shift.cashDifferenceMinor)}</dd></div></dl>
      <Notice>Tarjeta no entra al efectivo esperado. Transferencias pendientes no entran a los cobros confirmados.</Notice>
    </Panel><Panel><h2>{shift.status === 'open' && selected === state.currentShiftId ? 'Cerrar turno actual' : 'Cierre y continuidad'}</h2>
      {shift.status === 'open' && selected === state.currentShiftId ? review ? <>
        <h3>Revisar cierre</h3><p className="mt-4">Esperado: {cash(review.expectedMinor)}</p><p>Contado: {cash(review.countMinor)}</p><p>Diferencia: {cash(review.countMinor - review.expectedMinor)}</p>
        <Notice tone="warning">El cierre conserva la diferencia; no corrige efectivo ni inventario. Compara libreta y Excel manualmente antes de continuar.</Notice>
        <div className="flow"><Button onClick={() => {
          const result = transact(currentState => currentState.revision !== review.revision
            ? { state: currentState, result: { status: 'error' as const, message: 'Los registros cambiaron. Revisa el cierre de nuevo.' } }
            : closeShift(currentState, review.countMinor));
          setError(result.status === 'error');
          setMessage(result.status === 'error' ? result.message : 'Cierre de demostración registrado.');
          setReview(null);
        }}>Confirmar cierre de demostración</Button><Button variant="secondary" onClick={() => setReview(null)}>Volver al conteo</Button></div>
      </> : <form noValidate onSubmit={event => {
        event.preventDefault();
        const minor = parseMoney(counted);
        if (minor === null) { setError(true); setMessage('Escribe un importe válido, con hasta dos decimales.'); return; }
        setReview({ countMinor: minor, expectedMinor: summary.expectedCashMinor, revision: state.revision });
        setMessage('');
      }}><Field id="shift-counted" label="Efectivo contado (MXN)" inputMode="decimal" value={counted} onChange={event => setCounted(event.target.value)} /><Button type="submit">Revisar cierre</Button></form>
        : <><p className="muted">Reapertura y correcciones excepcionales no disponibles.</p>{shift.closedAt && <p>Cierre demo: {shift.closedAt}</p>}</>}
      <div role={error ? 'alert' : 'status'}>{message && <Notice tone={error ? 'error' : 'success'}>{message}</Notice>}</div>
      {current.status === 'closed' && <form className="mt-6" noValidate onSubmit={event => {
        event.preventDefault();
        const minor = parseMoney(opening);
        if (minor === null) { setError(true); setMessage('Revisa el fondo inicial; no se considera una venta.'); return; }
        const id = `shift-${crypto.randomUUID()}`;
        const result = transact(currentState => openShift(currentState, { id, window, openingCashMinor: minor }));
        setError(result.status === 'error');
        setMessage(result.status === 'error' ? result.message : 'Apertura de demostración registrada.');
        if (result.status === 'ok') { setSelectedId(id); setCounted(''); setOpening(''); }
      }}><h3>Abrir siguiente turno</h3><div className="field"><label htmlFor="shift-window">Horario</label><select id="shift-window" value={window} onChange={event => setWindow(event.target.value as ShiftWindow)}><option>06:00–14:00</option><option>14:00–22:00</option></select></div><Field id="shift-opening" label="Fondo inicial (MXN)" inputMode="decimal" value={opening} onChange={event => setOpening(event.target.value)} /><Button type="submit">Abrir turno de demostración</Button></form>}
    </Panel></div>
    <Panel className="mt-6"><h2>Cobros por categoría y método</h2><TableRegion label="Resumen del turno"><table><caption>MXN · transferencias pendientes excluidas de ingresos confirmados</caption><thead><tr><th scope="col">Categoría</th><th scope="col">Efectivo confirmado</th><th scope="col">Tarjeta confirmada</th><th scope="col">Transferencia pendiente</th></tr></thead><tbody>{summary.rows.map(row => <tr key={row.kind}><td>{{ membership: 'Membresías', product: 'Productos', visit: 'Visitas' }[row.kind]}</td><td>{formatMoney(row.cash)}</td><td>{formatMoney(row.card)}</td><td>{formatMoney(row.transferPending)}</td></tr>)}</tbody></table></TableRegion></Panel>
    <NotebookNotice /><div className="flow"><Link to={rolePath(role, 'sales')}>Registrar venta</Link><Link to={rolePath(role, 'inventory')}>Revisar conteo de inventario</Link></div>
  </>;
}
