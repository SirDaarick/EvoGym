import { useState } from 'react';
import { Link } from 'react-router';
import type { CashDenominationCount, Role, ShiftWindow } from '../../domain/models';
import { cashCountTotal, demoDenominations, parseCashQuantity } from '../../demo/cashDenominations';
import { OwnerQuestions } from '../demo/OwnerQuestions';
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
  const [countMode, setCountMode] = useState('manual');
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [opening, setOpening] = useState('');
  const [window, setWindow] = useState<ShiftWindow>('14:00–22:00');
  const [review, setReview] = useState<{ countMinor: number; expectedMinor: number; revision: number; denominations?: CashDenominationCount[] } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const selected = role === 'RECEPTION' ? state.currentShiftId : selectedId;
  const shift = state.shifts.find(item => item.id === selected)!;
  const current = state.shifts.find(item => item.id === state.currentShiftId)!;
  const summary = shiftSummary(state, selected);
  const cash = (value: number | undefined) => value === undefined ? 'Sin registrar' : `${formatMoney(value)} MXN`;
  const counts = demoDenominations.map(item => ({ valueMinor: item.valueMinor, quantity: parseCashQuantity(quantities[item.valueMinor] ?? '') ?? NaN }));
  const denominationTotal = cashCountTotal(counts);
  return <>
    <PageHeader eyebrow="TURNO · CONTROL MANUAL" title="Turno de trabajo" description="Fondo inicial, cobros confirmados y conteo de efectivo son conceptos separados." />
    {role === 'OWNER' && <div className="field"><label htmlFor="shift-selection">Turno a consultar</label><select id="shift-selection" value={selectedId} onChange={event => { setSelectedId(event.target.value); setReview(null); setCounted(''); setQuantities({}); }}>{state.shifts.map(item => <option key={item.id} value={item.id}>{item.id} · {item.window} · {item.status === 'open' ? 'Abierto' : 'Cerrado'}</option>)}</select></div>}
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
            : closeShift(currentState, review.countMinor, review.denominations));
          setError(result.status === 'error');
          setMessage(result.status === 'error' ? result.message : 'Cierre de demostración registrado.');
          setReview(null);
        }}>Confirmar cierre de demostración</Button><Button variant="secondary" onClick={() => setReview(null)}>Volver al conteo</Button></div>
      </> : <form noValidate onSubmit={event => {
        event.preventDefault();
        const minor = countMode === 'manual' ? parseMoney(counted) : denominationTotal;
        if (minor === null) { setError(true); setMessage(countMode === 'manual' ? 'Escribe un importe válido, con hasta dos decimales.' : 'Revisa las cantidades: solo enteros no negativos dentro del límite de la demo.'); return; }
        setReview({ countMinor: minor, expectedMinor: summary.expectedCashMinor, revision: state.revision,
          ...(countMode === 'denominations' ? { denominations: counts } : {}) });
        setMessage('');
      }}><div className="field"><label htmlFor="cash-count-mode">Forma de conteo</label><select id="cash-count-mode" value={countMode} onChange={event => { setCountMode(event.target.value); setReview(null); setMessage(''); }}><option value="manual">Total manual</option><option value="denominations">Billetes y monedas</option></select></div>
        {countMode === 'manual' ? <Field id="shift-counted" label="Efectivo contado (MXN)" inputMode="decimal" value={counted} onChange={event => { setCounted(event.target.value); setReview(null); }} /> : <>
          <Notice tone="warning">Catálogo ilustrativo MXN · Q-10 pendiente de confirmar. Cada casilla vacía cuenta como cero.</Notice>
          <div className="denomination-grid">{demoDenominations.map(item => {
            const quantity = parseCashQuantity(quantities[item.valueMinor] ?? '');
            const subtotal = quantity === null ? null : cashCountTotal([{ valueMinor: item.valueMinor, quantity }]);
            return <div className="denomination-row" key={item.valueMinor}>
              <Field id={`cash-${item.valueMinor}`} label={`${item.kind} ${formatMoney(item.valueMinor)} · cantidad`} inputMode="numeric" value={quantities[item.valueMinor] ?? ''} onChange={event => { setQuantities(previous => ({ ...previous, [item.valueMinor]: event.target.value })); setReview(null); }} error={subtotal === null ? 'Cantidad inválida' : undefined} />
              <p className="muted">Subtotal: {subtotal === null ? 'Revisar cantidad' : `${formatMoney(subtotal)} MXN`}</p>
            </div>;
          })}</div>
          <p className="product-price">Total contado: <output aria-label="Total por denominaciones" aria-live="polite">{denominationTotal === null ? 'Revisar cantidades' : `${formatMoney(denominationTotal)} MXN`}</output></p>
        </>}
        <Button type="submit">Revisar cierre</Button></form>
        : <><p className="muted">Reapertura y correcciones excepcionales no disponibles.</p>{shift.closedAt && <p>Cierre demo: {shift.closedAt}</p>}
          {shift.status === 'closed' && (shift.cashDenominations ? <TableRegion label="Conteo registrado"><table><caption>Desglose ilustrativo guardado al cerrar</caption><thead><tr><th scope="col">Valor MXN</th><th scope="col">Cantidad</th><th scope="col">Subtotal MXN</th></tr></thead><tbody>{shift.cashDenominations.filter(row => row.quantity > 0).map(row => <tr key={row.valueMinor}><td>{formatMoney(row.valueMinor)}</td><td>{row.quantity}</td><td>{formatMoney(row.valueMinor * row.quantity)}</td></tr>)}</tbody></table></TableRegion> : <p>Sin desglose por denominación registrado.</p>)}</>}
      <div role={error ? 'alert' : 'status'}>{message && <Notice tone={error ? 'error' : 'success'}>{message}</Notice>}</div>
      {current.status === 'closed' && <form className="mt-6" noValidate onSubmit={event => {
        event.preventDefault();
        const minor = parseMoney(opening);
        if (minor === null) { setError(true); setMessage('Revisa el fondo inicial; no se considera una venta.'); return; }
        const id = `shift-${crypto.randomUUID()}`;
        const result = transact(currentState => openShift(currentState, { id, window, openingCashMinor: minor }));
        setError(result.status === 'error');
        setMessage(result.status === 'error' ? result.message : 'Apertura de demostración registrada.');
        if (result.status === 'ok') { setSelectedId(id); setCounted(''); setQuantities({}); setOpening(''); }
      }}><h3>Abrir siguiente turno</h3><div className="field"><label htmlFor="shift-window">Horario</label><select id="shift-window" value={window} onChange={event => setWindow(event.target.value as ShiftWindow)}><option>06:00–14:00</option><option>14:00–22:00</option></select></div><Field id="shift-opening" label="Fondo inicial (MXN)" inputMode="decimal" value={opening} onChange={event => setOpening(event.target.value)} /><Button type="submit">Abrir turno de demostración</Button></form>}
    </Panel></div>
    <Panel className="mt-6"><h2>Cobros por categoría y método</h2><TableRegion label="Resumen del turno"><table><caption>MXN · transferencias pendientes excluidas de ingresos confirmados</caption><thead><tr><th scope="col">Categoría</th><th scope="col">Efectivo confirmado</th><th scope="col">Tarjeta confirmada</th><th scope="col">Transferencia pendiente</th></tr></thead><tbody>{summary.rows.map(row => <tr key={row.kind}><td>{{ membership: 'Membresías', product: 'Productos', visit: 'Visitas' }[row.kind]}</td><td>{formatMoney(row.cash)}</td><td>{formatMoney(row.card)}</td><td>{formatMoney(row.transferPending)}</td></tr>)}</tbody></table></TableRegion></Panel>
    <OwnerQuestions ids={['Q-10']} />
    <NotebookNotice /><div className="flow"><Link to={rolePath(role, 'sales')}>Registrar venta</Link><Link to={rolePath(role, 'inventory')}>Revisar conteo de inventario</Link></div>
  </>;
}
