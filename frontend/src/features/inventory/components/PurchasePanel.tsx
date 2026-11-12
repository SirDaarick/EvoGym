import { useEffect, useRef, useState } from 'react';
import { createInventoryPurchase, InventoryApiError, type AuthenticatedRequest, type InventoryPurchaseInput } from '../../../api/inventoryApi';
import { listCashRegisters, type CashRegisterDTO } from '../../../api/shiftsApi';
import { formatMoney, parseMoney } from '../../../shared/formatters/money';

interface PurchaseProduct { id: string; name: string; quantity: number }
interface PendingPurchase { key: string; payload: InventoryPurchaseInput }
interface Props { request: AuthenticatedRequest; branchId: string; products: PurchaseProduct[]; onQuantityChange?: (productId: string, quantity: number) => void; onSuccess: () => void }

function readPending(key: string): { pending: PendingPurchase | null; error: boolean } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { pending: null, error: false };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('key' in value) || typeof value.key !== 'string' ||
        !('payload' in value) || !value.payload || typeof value.payload !== 'object' ||
        !('items' in value.payload) || !Array.isArray(value.payload.items)) return { pending: null, error: true };
    return { pending: value as PendingPurchase, error: false };
  } catch {
    return { pending: null, error: true };
  }
}

export function PurchasePanel({ request, branchId, products, onQuantityChange, onSuccess }: Props) {
  const storageKey = `evogym:inventory-purchase:${branchId}`;
  const [initial] = useState(() => readPending(storageKey));
  const [pending, setPending] = useState<PendingPurchase | null>(initial.pending);
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [payFromDrawer, setPayFromDrawer] = useState(false);
  const [registerId, setRegisterId] = useState('');
  const [registers, setRegisters] = useState<CashRegisterDTO[]>([]);
  const [error, setError] = useState(initial.error ? 'No se puede recuperar la compra pendiente.' : '');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!payFromDrawer) return;
    let active = true;
    listCashRegisters(request).then(items => {
      if (active) setRegisters(items.filter(item => item.branch_id === branchId && item.status === 'active' && item.has_open_shift));
    }).catch(() => { if (active) setError('No se pudieron cargar las cajas.'); });
    return () => { active = false; };
  }, [payFromDrawer, request, branchId]);

  async function send(intent: PendingPurchase) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await createInventoryPurchase(request, branchId, intent.payload, intent.key);
      localStorage.removeItem(storageKey);
      setPending(null);
      setCosts({});
      setQuantities({});
      onSuccess();
    } catch (reason) {
      const data = reason instanceof InventoryApiError ? reason.data : null;
      const code = data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'code' in data.error ? data.error.code : null;
      if (code === 'inventory_purchase_rejected') {
        try { localStorage.removeItem(storageKey); setPending(null); } catch { /* Retain the intent if storage is unavailable. */ }
        setError('No se registró la compra: verifica que la caja esté abierta y tenga efectivo suficiente.');
      } else {
        setError('No se pudo confirmar la compra. Reintenta la compra pendiente antes de registrar otra.');
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function submit() {
    if (pending || busy || initial.error || !branchId || !products.length) return;
    const items = products.map(product => ({
      product_id: product.id,
      quantity: quantities[product.id] ?? product.quantity,
      cost_minor: parseMoney(costs[product.id] ?? ''),
    }));
    if (items.some(item => item.cost_minor === null || item.cost_minor <= 0 || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) ||
        !Number.isSafeInteger(items.reduce((sum, item) => sum + (item.cost_minor ?? 0), 0)) || (payFromDrawer && !registerId)) {
      setError('Revisa las cantidades, los costos y la caja seleccionada.');
      return;
    }
    const intent: PendingPurchase = {
      key: crypto.randomUUID(),
      payload: { items: items.map(item => ({ ...item, cost_minor: item.cost_minor! })), pay_from_drawer: payFromDrawer,
                 ...(payFromDrawer ? { register_id: registerId } : {}) },
    };
    try { localStorage.setItem(storageKey, JSON.stringify(intent)); } catch { setError('No se puede guardar la compra para recuperarla.'); return; }
    setPending(intent);
    void send(intent);
  }

  const total = products.reduce((sum, product) => sum + (parseMoney(costs[product.id] ?? '') ?? 0), 0);
  return <section aria-labelledby="purchase-heading">
    <h3 id="purchase-heading">Compra actual</h3>
    {!products.length && !pending && <p>Selecciona productos y cantidades en el inventario.</p>}
    <fieldset disabled={busy || Boolean(pending) || initial.error}>
      {products.map(product => {
        const qty = quantities[product.id] ?? product.quantity;
        const costMinor = parseMoney(costs[product.id] ?? '');
        const unitCostMinor = costMinor !== null && qty > 0 ? Math.round(costMinor / qty) : null;
        return <div className="field" key={product.id}>
          <label htmlFor={`purchase-quantity-${product.id}`}>Cantidad de compra de {product.name}</label>
          <input id={`purchase-quantity-${product.id}`} type="number" min="1" value={qty || ''}
            onChange={event => {
              const val = Number.parseInt(event.target.value, 10);
              const next = Number.isSafeInteger(val) && val >= 0 ? val : 0;
              setQuantities(previous => ({ ...previous, [product.id]: next }));
              onQuantityChange?.(product.id, next);
            }} />
          <label htmlFor={`purchase-cost-${product.id}`}>Costo total de {product.name}</label>
          <input id={`purchase-cost-${product.id}`} inputMode="decimal" value={costs[product.id] ?? ''}
            onChange={event => setCosts(previous => ({ ...previous, [product.id]: event.target.value }))} />
          <span>Cantidad: {qty}</span>
          <span className="unit-cost-reference">Costo unitario de referencia: {unitCostMinor !== null ? formatMoney(unitCostMinor) : '—'}</span>
        </div>;
      })}
      <p>Total: {formatMoney(total)}</p>
      <label><input type="checkbox" checked={payFromDrawer} onChange={event => setPayFromDrawer(event.target.checked)} />Pagar con dinero de caja</label>
      {payFromDrawer && <label>Caja<select value={registerId} onChange={event => setRegisterId(event.target.value)}>
        <option value="">Selecciona una caja</option>
        {registers.map(register => <option key={register.id} value={register.id}>{register.name}</option>)}
      </select></label>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {pending ? <button type="button" disabled={busy} onClick={() => void send(pending)}>Reintentar compra pendiente</button>
      : <button type="button" disabled={busy || initial.error || !products.length} onClick={submit}>Confirmar compra</button>}
  </section>;
}
