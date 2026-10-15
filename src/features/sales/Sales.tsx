import { useRef, useState } from 'react';
import { Link } from 'react-router';
import type { PaymentMethod, Role, VisitArea } from '../../domain/models';
import { rolePath } from '../../app/navigation';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney } from '../../demo/adapter';
import { activeShift, expectedStock } from '../../demo/inventoryOperations';
import { registerSale, saleQuote, visitAreas, visitPrice, type SaleRequest, type SaleResult } from '../../demo/salesOperations';
import { Button, EmptyState, Field, Notice, PageHeader, Panel } from '../../shared/ui';
import { NotebookNotice, paymentMethods } from '../members/Members';

export function Sales({ role }: { role: Role }) {
  const { state, transact } = useDemo();
  const [kind, setKind] = useState<'product' | 'visit'>('product');
  const [productId, setProductId] = useState(state.products[0]?.id ?? '');
  const [area, setArea] = useState<VisitArea>('GYM');
  const [quantity, setQuantity] = useState('1');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<SaleResult | null>(null);
  const [requestId, setRequestId] = useState(() => `sale-${crypto.randomUUID()}`);
  const locked = useRef(false);
  const request: SaleRequest = kind === 'product'
    ? { id: requestId, kind, productId, quantity: Number(quantity), method }
    : { id: requestId, kind, area, quantity: Number(quantity), method };
  const quote = saleQuote(state, request);
  const available = kind === 'visit' || Number(quantity) <= expectedStock(state, productId);

  if (result && result.status !== 'error') return <>
    <PageHeader eyebrow="VENTA · RESULTADO" title={result.status === 'confirmed' ? 'Venta registrada' : 'Venta pendiente de transferencia'} description={result.sale.description} />
    <Panel><div role="status"><Notice tone={result.status === 'confirmed' ? 'success' : 'warning'}>
      {result.status === 'confirmed' ? 'Venta registrada correctamente en el sistema.' : 'Transferencia registrada pendiente de validación en cuenta.'}
    </Notice></div><p className="mt-4">{result.sale.quantity} × {formatMoney(result.sale.unitPriceMinor)} = {formatMoney(result.sale.amountMinor)} MXN</p>
      <p>{paymentMethods[result.sale.method]} · {result.sale.id}</p>
      <div className="flow"><Button onClick={() => {
        setResult(null); setReviewing(false); locked.current = false; setRequestId(`sale-${crypto.randomUUID()}`);
      }}>Nueva venta</Button><Link to={rolePath(role, 'shifts')}>Ver turno</Link><Link to={rolePath(role, 'inventory')}>Ver inventario</Link></div>
    </Panel>
  </>;
  return <>
    <PageHeader eyebrow="VENTAS · PRODUCTOS Y VISITAS" title="Venta de productos y visitas" description="Revisa el cobro antes de registrar la operación." />
    {!activeShift(state) ? <Panel><EmptyState title="Se requiere un turno abierto"><Link to={rolePath(role, 'shifts')}>Abrir un turno</Link></EmptyState></Panel> : <div className="bento-grid">
      <Panel>{reviewing && quote ? <>
        <h2>Revisar venta</h2><p>{quote.description} · Cantidad: {request.quantity}</p><p>{paymentMethods[method]}</p>
        <p>Precio unitario: {formatMoney(quote.unitPriceMinor)} MXN</p><p className="text-3xl font-bold">Total {formatMoney(quote.amountMinor)} MXN</p>
        <p className="muted">Sin crédito aplicado.</p>
        <div className="flow"><Button disabled={locked.current} onClick={() => {
          if (locked.current) return;
          locked.current = true;
          const outcome = transact(current => registerSale(current, request));
          setResult(outcome);
          if (outcome.status === 'error') locked.current = false;
        }}>{method === 'transfer' ? 'Registrar venta pendiente' : 'Registrar venta'}</Button>
          <Button variant="secondary" disabled={locked.current} onClick={() => setReviewing(false)}>Volver a captura</Button></div>
      </> : <form onSubmit={event => { event.preventDefault(); if (quote && available) setReviewing(true); }}>
        <div className="field"><label htmlFor="sale-kind">Tipo de venta</label><select id="sale-kind" value={kind} onChange={event => setKind(event.target.value as 'product' | 'visit')}><option value="product">Producto</option><option value="visit">Visita</option></select></div>
        {kind === 'product' ? <div className="field"><label htmlFor="sale-product">Producto</label><select id="sale-product" value={productId} onChange={event => setProductId(event.target.value)}>{state.products.map(product => <option key={product.id} value={product.id}>{product.name} · {formatMoney(product.priceMinor)} MXN</option>)}</select><p className="muted mt-2">Existencia esperada: {expectedStock(state, productId)} unidades.</p></div>
          : <div className="field"><label htmlFor="visit-area">Área de visita</label><select id="visit-area" value={area} onChange={event => setArea(event.target.value as VisitArea)}>{Object.entries(visitAreas).map(([value, label]) => <option key={value} value={value}>{label} · {formatMoney(visitPrice(value as VisitArea))} MXN</option>)}</select></div>}
        <Field id="sale-quantity" label="Cantidad" type="number" min="1" step="1" required value={quantity} onChange={event => setQuantity(event.target.value)} />
        <div className="field"><label htmlFor="sale-method">Método de venta</label><select id="sale-method" value={method} onChange={event => setMethod(event.target.value as PaymentMethod)}>{Object.entries(paymentMethods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <p>Total: {quote ? `${formatMoney(quote.amountMinor)} MXN` : 'Revisa la cantidad'}</p>
        {!available && <Notice tone="error">Existencia insuficiente.</Notice>}<Button type="submit" disabled={!quote || !available}>Revisar venta</Button>
      </form>}{result?.status === 'error' && <div role="alert"><Notice tone="error">{result.message}</Notice></div>}</Panel>
      <Panel><h2>Información de venta</h2><p className="mt-2 font-medium">Tarifas de visita:</p><p className="mt-1">Visita individual (Gym o Box): $50.00 MXN. Pase combinado (Gym + Box): $100.00 MXN.</p><Notice tone="warning">Las transferencias quedan registradas en estado pendiente hasta confirmar su acreditación en cuenta.</Notice></Panel>
    </div>}
  </>;
}
