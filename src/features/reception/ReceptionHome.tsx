import { useRef, useState } from 'react';
import { Link } from 'react-router';
import type { PaymentMethod } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney } from '../../demo/adapter';
import { expectedStock } from '../../demo/inventoryOperations';
import { cartQuote, registerCart } from '../../demo/salesOperations';
import { Button, EmptyState, Notice, PageHeader, Panel } from '../../shared/ui';
import { NotebookNotice, paymentMethods } from '../members/Members';
import { OwnerQuestions } from '../demo/OwnerQuestions';

export function ReceptionHome() {
  const { state, transact } = useDemo();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [review, setReview] = useState<{ id: string; revision: number; totalMinor: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const cartId = useRef<string | null>(null);
  const lines = Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity }));
  const quote = cartQuote(state, lines);
  function changeQuantity(productId: string, quantity: number) {
    if (pending || !Number.isSafeInteger(quantity) || quantity < 0) return;
    setQuantities(previous => ({ ...previous, [productId]: quantity }));
    setReview(null); cartId.current = null; setMessage('');
  }
  return <>
    <PageHeader eyebrow="RECEPCIÓN · INICIO" title="Inicio de recepción" description="Socios y ventas, a un paso." />
    <div className="flow reception-shortcuts">
      <Link className="button button-secondary" to="/reception/members">Buscar socio</Link>
      <Link to="/reception/sales">Registrar venta</Link><Link to="/reception/shifts">Revisar turno</Link>
    </div>
    <div className="reception-checkout"><Panel><h2>Productos de demostración</h2>
      <p className="muted">Selecciona productos y ajusta las cantidades antes de revisar el cobro.</p>
      {state.products.length ? <div className="product-grid">{state.products.map(product => <article className={`product-card ${quantities[product.id] ? 'product-selected' : ''}`} key={product.id}>
        <Button variant="secondary" className="product-select" aria-label={`Seleccionar ${product.name}`} aria-pressed={Boolean(quantities[product.id])} disabled={pending}
          onClick={() => changeQuantity(product.id, (quantities[product.id] ?? 0) + 1)}>
          <svg viewBox="0 0 100 100" className="product-placeholder" aria-hidden="true"><rect x="32" y="12" width="36" height="76" rx="10" fill="currentColor" /><rect x="38" y="40" width="24" height="26" rx="4" fill="white" /></svg>
          <span>{product.name}</span><span className="product-price">{formatMoney(product.priceMinor)} MXN</span>
        </Button>
        <p className="muted">Disponibles en demo: {expectedStock(state, product.id)}</p>
        {Boolean(quantities[product.id]) && <div className="quantity-controls">
          <Button variant="secondary" aria-label={`Disminuir ${product.name}`} disabled={pending} onClick={() => changeQuantity(product.id, quantities[product.id] - 1)}>−</Button>
          <output aria-label={`Cantidad de ${product.name}`}>{quantities[product.id]}</output>
          <Button variant="secondary" aria-label={`Aumentar ${product.name}`} disabled={pending} onClick={() => changeQuantity(product.id, quantities[product.id] + 1)}>+</Button>
          <Button variant="secondary" aria-label={`Quitar ${product.name}`} disabled={pending} onClick={() => changeQuantity(product.id, 0)}>Quitar</Button>
        </div>}
      </article>)}</div> : <EmptyState title="Sin productos">Revisa el inventario de demostración.</EmptyState>}
      <Notice>Imágenes pendientes · Los productos, precios y existencias son ilustrativos.</Notice>
      <OwnerQuestions ids={['Q-12']} />
    </Panel><Panel><h2>Compra actual</h2>
      {!lines.length ? <p>Sin productos seleccionados.</p> : <ul className="cart-lines">{quote?.lines.map(line => <li key={line.productId}>{line.quantity} × {line.description}<strong>{formatMoney(line.amountMinor)}</strong></li>)}</ul>}
      <p className="product-price">Total: <output aria-label="Total de compra">{quote ? `${formatMoney(quote.totalMinor)} MXN` : lines.length ? 'Revisar cantidades' : '$0.00 MXN'}</output></p>
      <div className="field"><label htmlFor="cart-method">Método de cobro</label><select id="cart-method" value={method} disabled={pending} onChange={event => { setMethod(event.target.value as PaymentMethod); setReview(null); cartId.current = null; }}>{Object.entries(paymentMethods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {review ? <>
        <h3>Revisar compra · {formatMoney(review.totalMinor)} MXN</h3>
        <Notice tone="warning">Confirma solo después de recibir el pago. Esta demo no procesa pagos reales ni calcula cambio.</Notice>
        <div className="flow"><Button onClick={() => {
          const result = transact(current => current.revision !== review.revision
            ? { state: current, result: { status: 'error' as const, message: 'Los registros cambiaron. Revisa la compra de nuevo.' } }
            : registerCart(current, { id: review.id, method, lines }));
          setError(result.status === 'error'); setReview(null);
          if (result.status === 'error') setMessage(result.message);
          else if (result.status === 'pending') { setPending(true); setMessage('Transferencia pendiente: compra conservada, sin cobro confirmado ni descuento de inventario.'); }
          else { setMessage('Cobro confirmado en la demo. Compra completa registrada; lista para la siguiente compra.'); setQuantities({}); cartId.current = null; }
        }}>{method === 'transfer' ? 'Registrar compra pendiente' : 'Confirmar cobro de demostración'}</Button>
          <Button variant="secondary" onClick={() => setReview(null)}>Volver a la compra</Button></div>
      </> : !pending && <Button disabled={!quote} onClick={() => { if (quote) { cartId.current ??= `cart-${crypto.randomUUID()}`; setReview({ id: cartId.current, revision: state.revision, totalMinor: quote.totalMinor }); setMessage(''); } }}>Revisar cobro</Button>}
      <div role={error ? 'alert' : 'status'} aria-label="Resultado de compra">{message && <Notice tone={error ? 'error' : pending ? 'warning' : 'success'}>{message}</Notice>}</div>
      {pending && <Notice tone="warning">Q-15 · Compra agrupada solo para esta demo. Confirmación de transferencias aún no disponible; no vuelvas a cobrarla.</Notice>}
      <Notice>Q-14 pendiente · El carrito se pierde al salir de Inicio, cambiar perfil o restablecer la demo. Las operaciones ya registradas siguen en memoria hasta restablecer.</Notice>
      <OwnerQuestions ids={['Q-11', 'Q-14', 'Q-15']} />
    </Panel></div>
    <NotebookNotice />
  </>;
}
