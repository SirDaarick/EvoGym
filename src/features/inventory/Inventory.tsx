import { useRef, useState } from 'react';
import type { Role } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { activeShift, currentShiftStockBreakdown, recordCount, recordMovement, stockBreakdown } from '../../demo/inventoryOperations';
import { Button, Field, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';
import { NotebookNotice } from '../members/Members';

export function Inventory({ role }: { role: Role }) {
  const { state, transact } = useDemo();
  const [productId, setProductId] = useState(state.products[0]?.id ?? '');
  const [kind, setKind] = useState<'restock' | 'waste' | 'count'>('count');
  const [quantity, setQuantity] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const locked = useRef(false);
  const counts = state.counts.filter(item => role === 'OWNER' || item.shiftId === state.currentShiftId);
  const movements = state.stockMovements.filter(item => role === 'OWNER' || item.shiftId === state.currentShiftId);
  return <>
    <PageHeader eyebrow="INVENTARIO · DEMOSTRACIÓN" title="Inventario y conteo físico" description="Existencia esperada y conteo observado se conservan por separado." />
    <Panel><TableRegion label="Inventario ilustrativo"><table><caption>Cantidades ilustrativas; no stock confirmado por el propietario. {role === 'RECEPTION' ? 'Desglose del turno actual solamente.' : 'Desglose acumulado de todos los turnos.'}</caption><thead><tr><th scope="col">Producto</th><th scope="col">{role === 'RECEPTION' ? 'Existencia recibida' : 'Inicial'}</th><th scope="col">{role === 'RECEPTION' ? 'Reposición del turno' : 'Reposición'}</th><th scope="col">{role === 'RECEPTION' ? 'Vendido en el turno' : 'Vendido'}</th><th scope="col">{role === 'RECEPTION' ? 'Merma del turno' : 'Merma'}</th><th scope="col">Esperado</th></tr></thead><tbody>{state.products.map(product => {
      const stock = role === 'RECEPTION' ? currentShiftStockBreakdown(state, product.id) : stockBreakdown(state, product.id);
      return <tr key={product.id}><td>{product.name}</td><td>{stock.opening}</td><td>+{stock.restocked}</td><td>−{stock.sold}</td><td>−{stock.waste}</td><td className="font-bold">{stock.expected}</td></tr>;
    })}</tbody></table></TableRegion><p className="muted mt-4">{role === 'RECEPTION' ? 'Existencia recibida = saldo esperado acumulado antes del turno actual, no un conteo físico. Esperado = existencia recibida + reposición del turno − vendido en el turno − merma del turno.' : 'Esperado = inicial + reposiciones − vendido − merma.'} Un conteo no cambia esta fórmula ni corrige existencias.</p></Panel>
    <div className="bento-grid mt-6"><Panel><h2>Registrar cantidad de demostración</h2>
      <form noValidate onSubmit={event => {
        event.preventDefault();
        if (locked.current) return;
        locked.current = true;
        const request = { id: `stock-${crypto.randomUUID()}`, productId, quantity: quantity.trim() ? Number(quantity) : NaN };
        const result = transact(current => kind === 'count' ? recordCount(current, request) : recordMovement(current, { ...request, kind }));
        setError(result.status === 'error');
        if (result.status === 'error') locked.current = false;
        else setRecorded(true);
        setMessage(result.status === 'error' ? result.message : kind === 'count' ? 'Conteo observado registrado; existencias sin corrección.' : 'Movimiento de cantidad registrado. No es un gasto.');
      }}>
        <div className="field"><label htmlFor="stock-product">Producto</label><select id="stock-product" value={productId} onChange={event => setProductId(event.target.value)}>{state.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></div>
        <div className="field"><label htmlFor="stock-kind">Tipo de registro</label><select id="stock-kind" value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="count">Conteo físico</option><option value="restock">Reposición</option><option value="waste">Merma</option></select></div>
        <Field id="stock-quantity" label="Unidades" type="number" min={kind === 'count' ? 0 : 1} step="1" value={quantity} onChange={event => setQuantity(event.target.value)} />
        <Button type="submit" disabled={!activeShift(state) || recorded}>Registrar cantidad</Button>
        {recorded && <div className="flow"><Button variant="secondary" onClick={() => {
          locked.current = false; setRecorded(false); setQuantity(''); setMessage('');
        }}>Nuevo registro de cantidad</Button></div>}
        {!activeShift(state) && <p className="muted">Abre un turno para registrar cantidades.</p>}
      </form><div role={error ? 'alert' : 'status'}>{message && <Notice tone={error ? 'error' : 'success'}>{message}</Notice>}</div>
      <Notice>Corrección excepcional de stock no disponible: permisos y trazabilidad pendientes.</Notice>
    </Panel><Panel><h2>Conteos y diferencias observadas</h2>
      {counts.length ? <TableRegion label="Conteos físicos"><table><caption>Valores al momento del conteo, no inventario actual</caption><thead><tr><th scope="col">Producto</th><th scope="col">Esperado entonces</th><th scope="col">Contado</th><th scope="col">Diferencia</th></tr></thead><tbody>{counts.map(count => <tr key={count.id}><td>{state.products.find(product => product.id === count.productId)?.name}<p className="muted">{count.shiftId}</p></td><td>{count.expectedAtCount}</td><td>{count.quantity}</td><td>{count.variance > 0 ? '+' : ''}{count.variance}</td></tr>)}</tbody></table></TableRegion> : <p className="muted">Sin conteos físicos registrados en esta vista.</p>}
    </Panel></div>
    <Panel className="mt-6"><h2>Movimientos de cantidad</h2>{movements.length ? <TableRegion label="Movimientos de inventario"><table><caption>{role === 'OWNER' ? 'Todos los turnos demo' : 'Solo el turno actual demo'}</caption><thead><tr><th scope="col">Tipo</th><th scope="col">Unidades</th><th scope="col">Referencia local</th></tr></thead><tbody>{movements.map(movement => <tr key={movement.id}><td>{{ restock: 'Reposición', sale: 'Venta', waste: 'Merma' }[movement.kind]}</td><td>{movement.quantity}</td><td>{movement.id}</td></tr>)}</tbody></table></TableRegion> : <p className="muted">Sin movimientos registrados en esta vista.</p>}</Panel><NotebookNotice />
  </>;
}
