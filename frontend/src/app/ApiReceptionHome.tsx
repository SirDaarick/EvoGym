import { useEffect, useRef, useState } from 'react';
import { listBranchInventory, listBranches, type AuthenticatedRequest, type BranchItem, type StockItem } from '../api/inventoryApi';
import { listCashRegisters, type CashRegisterDTO } from '../api/shiftsApi';
import {
  ProductSaleError,
  submitCashProductSale,
  submitCardProductSale,
  resolveCashProductSale,
  getPendingProductSale,
  prepareProductSale,
  createCardIntent,
  getCardIntentStatus,
  cancelCardIntent,
  type ProductSaleInput,
} from '../api/productSalesApi';
import { CurrentPurchaseCard, type CheckoutPaymentBreakdown } from '../features/reception/CurrentPurchaseCard';
import { ProductCard } from '../features/reception/ProductCard';
import { shortcutIcons } from '../features/reception/ReceptionHome';
import { formatMoney } from '../demo/adapter';
import { MobileDetailPanel } from '../shared/MobileDetailPanel';
import { Button, EmptyState, PageHeader, Panel } from '../shared/ui';
import { DevolucionesModal } from '../features/reception/DevolucionesModal';
import { GuantesModal } from '../features/reception/GuantesModal';
import { CasillerosModal } from '../features/reception/CasillerosModal';

type Intent = { key: string; registerId: string; payload: ProductSaleInput };
type Member = { id: string; full_name: string; phone: string };

export function ApiReceptionHome({ request, actorId }: { request: AuthenticatedRequest; actorId: string }) {
  const storageKey = `evogym:product-sale:${actorId}`;
  const [intent, setIntent] = useState<Intent | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey) || 'null') as Intent | null; }
    catch { return null; }
  });
  const [intentLoaded, setIntentLoaded] = useState(false);
  const [registers, setRegisters] = useState<CashRegisterDTO[]>([]);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [registerId, setRegisterId] = useState(() => intent?.registerId ?? '');
  const [stock, setStock] = useState<StockItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [member, setMember] = useState<Member | null>(null);
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [recoveredMemberName, setRecoveredMemberName] = useState('');
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [isDevolucionesOpen, setIsDevolucionesOpen] = useState(false);
  const [isGuantesOpen, setIsGuantesOpen] = useState(false);
  const [isCasillerosOpen, setIsCasillerosOpen] = useState(false);
  const [activeCardIntentId, setActiveCardIntentId] = useState<string | null>(null);
  const currentBranchId = registers.find(register => register.id === registerId)?.branch_id;

  useEffect(() => {
    let active = true;
    getPendingProductSale(request).then(saved => {
      if (!active) return;
      setIntent(current => current ?? saved);
      if (saved) setRegisterId(current => current || saved.registerId);
      setIntentLoaded(true);
    }).catch(() => { if (active) { setError(true); setMessage('No se pudo consultar la compra pendiente. Recarga la página.'); } });
    return () => { active = false; };
  }, [request, actorId]);

  useEffect(() => {
    let active = true;
    setRecoveredMemberName('');
    const id = intent?.payload.member_id;
    if (!id) return;
    request(`/api/v1/members/${encodeURIComponent(id)}`).then(async response => {
      if (!response.ok) return;
      const data = await response.json() as { full_name?: unknown };
      if (active && typeof data.full_name === 'string') setRecoveredMemberName(data.full_name);
    }).catch(() => {});
    return () => { active = false; };
  }, [intent, request]);

  useEffect(() => {
    let active = true;
    Promise.all([listBranches(request), listCashRegisters(request)]).then(([b, r]) => {
      if (!active) return;
      setBranches(b);
      setRegisters(r);
      if (!registerId) {
        const open = r.filter(register => register.has_open_shift);
        if (open.length === 1) setRegisterId(open[0].id);
        else if (r.length === 1) setRegisterId(r[0].id);
      }
    }).catch(() => { if (active) { setError(true); setMessage('No se pudieron consultar las cajas y sucursales.'); } });
    return () => { active = false; };
  }, [request, registerId]);

  useEffect(() => {
    let active = true;
    if (!registerId) { setStock([]); return; }
    const branch = registers.find(register => register.id === registerId)?.branch_id;
    if (!branch) return;
    async function load() {
      const items: StockItem[] = [];
      do {
        const page = await listBranchInventory(request, branch!, items.length, 100);
        items.push(...page.items);
        if (items.length >= page.total || page.items.length === 0) break;
      } while (true);
      if (active) setStock(items.filter(item => item.is_active && item.initialized));
    }
    load().catch(() => { if (active) { setError(true); setMessage('No se pudo cargar el inventario.'); } });
    return () => { active = false; };
  }, [registerId, registers, request, revision]);

  useEffect(() => {
    let active = true;
    if (query.trim().length < 2 || member) { setMembers([]); return; }
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ page: '1', limit: '20', search: query.trim() });
        const response = await request(`/api/v1/members?${params}`);
        if (!response.ok) throw new Error();
        const data = await response.json() as { items: Member[] };
        if (active) setMembers(data.items);
      } catch { if (active) setMembers([]); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, member, request]);

  const selected = stock.filter(item => (quantities[item.product_id] ?? 0) > 0);
  const total = intent?.payload.expected_total_minor ?? selected.reduce((sum, item) => sum + item.price_minor * quantities[item.product_id], 0);
  const locked = !intentLoaded || pending || intent !== null;
  function changeQuantity(id: string, value: number) {
    const maximum = stock.find(item => item.product_id === id)?.quantity ?? 0;
    setQuantities(current => ({ ...current, [id]: Math.max(0, Math.min(value, maximum)) }));
  }

  async function refreshResolvedIntent(): Promise<boolean> {
    const saved = await getPendingProductSale(request);
    if (saved) {
      sessionStorage.setItem(storageKey, JSON.stringify(saved));
      setIntent(saved); setRegisterId(saved.registerId);
      return true;
    }
    sessionStorage.removeItem(storageKey); setIntent(null);
    return false;
  }

  async function cancelCurrentCardIntent() {
    if (!activeCardIntentId || !registerId) return;
    try {
      await cancelCardIntent(request, registerId, activeCardIntentId);
      if (intent) {
        await resolveCashProductSale(request, registerId, intent.payload, intent.key);
      }
      sessionStorage.removeItem(storageKey);
      setActiveCardIntentId(null);
      setIntent(null);
      setPending(false);
      setError(false);
      setMessage('Cobro en terminal cancelado.');
    } catch {
      setError(true);
      setMessage('No se pudo cancelar el cobro en la terminal.');
    }
  }

  async function submit(breakdown?: CheckoutPaymentBreakdown) {
    if (!intentLoaded || submitting.current || intent || (!intent && (!registerId || !selected.length))) return;
    if (breakdown && (breakdown.mode !== 'single' || (breakdown.method !== 'cash' && breakdown.method !== 'card') || breakdown.shortfallMinor > 0)) return;
    if (!Number.isSafeInteger(total)) { setError(true); setMessage('El total excede el límite seguro de esta pantalla.'); return; }
    const submitted = intent ?? { key: crypto.randomUUID(), registerId, payload: {
      member_id: member?.id ?? null,
      items: selected.map(item => ({ product_id: item.product_id, quantity: quantities[item.product_id] })),
      expected_total_minor: total,
    } };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(submitted));
    } catch {
      setError(true); setMessage('No se puede guardar el intento de cobro para recuperarlo.'); return;
    }
    submitting.current = true;
    setIntent(submitted); setPending(true); setError(false);

    const isCard = breakdown?.method === 'card';

    if (isCard) {
      setMessage('Conectando con la terminal Point...');
      try {
        await prepareProductSale(request, submitted);
        const externalRef = `cart-${submitted.key.slice(0, 8)}`;
        const cardIntent = await createCardIntent(request, submitted.registerId, total, externalRef);
        setActiveCardIntentId(cardIntent.payment_intent_id);
        setMessage(`Esperando tarjeta en la terminal Point (${cardIntent.device_id})...`);

        let intentStatus = await getCardIntentStatus(request, submitted.registerId, cardIntent.payment_intent_id);
        let retries = 0;
        while (
          intentStatus.status !== 'PROCESSED' &&
          intentStatus.status !== 'CANCELED' &&
          intentStatus.status !== 'ABANDONED' &&
          retries < 30
        ) {
          await new Promise(r => setTimeout(r, 600));
          intentStatus = await getCardIntentStatus(request, submitted.registerId, cardIntent.payment_intent_id);
          retries++;
        }

        if (intentStatus.status !== 'PROCESSED') {
          throw new Error('El cobro no fue aprobado en la terminal Point.');
        }

        setMessage('Pago aprobado en terminal. Registrando compra...');
        await submitCardProductSale(
          request,
          submitted.registerId,
          { ...submitted.payload, card_intent_id: cardIntent.payment_intent_id },
          submitted.key
        );
        await resolveCashProductSale(request, submitted.registerId, submitted.payload, submitted.key);
        setActiveCardIntentId(null);
        const morePending = await refreshResolvedIntent();
        setQuantities({});
        setMember(null);
        setQuery('');
        setStep(1);
        setRevision(value => value + 1);
        setMessage(morePending ? 'Hay otra compra pendiente de confirmar.' : 'Compra con tarjeta registrada.');
      } catch (failure) {
        setActiveCardIntentId(null);
        if (!(failure instanceof ProductSaleError)) {
          try {
            const saved = await getPendingProductSale(request);
            if (saved && saved.key !== submitted.key) {
              sessionStorage.setItem(storageKey, JSON.stringify(saved));
              setIntent(saved);
              setRegisterId(saved.registerId);
            }
          } catch {
            /* Keep original intent */
          }
        }
        if (!intent && failure instanceof ProductSaleError && failure.definitelyRejected) {
          try {
            await resolveCashProductSale(request, submitted.registerId, submitted.payload, submitted.key);
            await refreshResolvedIntent();
          } catch {
            setError(true);
            setMessage('No se pudo confirmar el resultado. Verifica la compra antes de hacer otra.');
            return;
          }
          setStep(1);
          setRevision(value => value + 1);
          setError(true);
          setMessage(
            failure.firstShiftRequired
              ? 'Abre el primer turno de esta caja antes de registrar una venta.'
              : 'La compra fue rechazada. Revisa los productos, el precio y el turno antes de volver a intentar.'
          );
        } else {
          setError(true);
          setMessage(
            failure instanceof Error ? failure.message : 'No se pudo confirmar el cobro con tarjeta.'
          );
        }
      } finally {
        submitting.current = false;
        setPending(false);
      }
      return;
    }

    setMessage('Registrando compra…');
    try {
      await prepareProductSale(request, submitted);
      await submitCashProductSale(request, submitted.registerId, submitted.payload, submitted.key);
      await resolveCashProductSale(request, submitted.registerId, submitted.payload, submitted.key);
      const morePending = await refreshResolvedIntent();
      setQuantities({}); setMember(null); setQuery('');
      setStep(1); setRevision(value => value + 1); setMessage(morePending ? 'Hay otra compra pendiente de confirmar.' : 'Compra registrada.');
    } catch (failure) {
      if (!(failure instanceof ProductSaleError)) {
        try { const saved = await getPendingProductSale(request); if (saved && saved.key !== submitted.key) { sessionStorage.setItem(storageKey, JSON.stringify(saved)); setIntent(saved); setRegisterId(saved.registerId); } } catch { /* Keep the original intent frozen. */ }
      }
      if (!intent && failure instanceof ProductSaleError && failure.definitelyRejected) {
        try { await resolveCashProductSale(request, submitted.registerId, submitted.payload, submitted.key); await refreshResolvedIntent(); }
        catch { setError(true); setMessage('No se pudo confirmar el resultado. Verifica la compra antes de hacer otra.'); return; }
        setStep(1); setRevision(value => value + 1);
        setError(true); setMessage(failure.firstShiftRequired ? 'Abre el primer turno de esta caja antes de registrar una venta.' : 'La compra fue rechazada. Revisa los productos, el precio y el turno antes de volver a intentar.');
      } else {
        setError(true); setMessage('No se pudo confirmar el resultado. Verifica la compra antes de hacer otra.');
      }
    } finally { submitting.current = false; setPending(false); }
  }

  async function resolveIntent() {
    if (!intent || submitting.current) return;
    submitting.current = true; setPending(true); setError(false);
    try {
      const status = await resolveCashProductSale(request, intent.registerId, intent.payload, intent.key);
      const morePending = await refreshResolvedIntent();
      setQuantities({}); setMember(null); setQuery('');
      setStep(1); setRevision(value => value + 1);
      setMessage(morePending ? 'Hay otra compra pendiente de confirmar.' : status === 'completed' ? 'Compra registrada.' : 'La compra no se registró y fue cancelada.');
    } catch {
      setError(true); setMessage('No se pudo confirmar el resultado. Intenta resolver la compra nuevamente.');
    } finally { submitting.current = false; setPending(false); }
  }

  return <>
    <PageHeader eyebrow="RECEPCIÓN · INICIO" title="Inicio de recepción" description="Socios y ventas, a un paso." />
    <div className="reception-checkout">
      <div className="reception-products-column">
        <div className="reception-shortcuts-container"><div className="reception-clay-actions" role="group" aria-label="Acciones operativas rápidas">
          {([['gasto', 'Gasto'], ['extra', 'Extra'], ['guantes', 'Guantes'], ['suplementos', 'Suplementos'], ['casilleros', 'Casilleros']] as const).map(([key, label]) => {
            const isGuantes = key === 'guantes';
            const isCasilleros = key === 'casilleros';
            const isAvailable = (isGuantes || isCasilleros) && Boolean(registerId && currentBranchId);
            return (
              <Button
                key={key}
                variant="secondary"
                className="shortcut-clay-btn"
                disabled={!isAvailable && (isGuantes || isCasilleros ? !registerId : true)}
                title={isGuantes || isCasilleros ? (registerId ? `Abrir ${label}` : 'Selecciona una caja primero') : 'Aún no disponible'}
                onClick={() => {
                  if (isGuantes) setIsGuantesOpen(true);
                  if (isCasilleros) setIsCasillerosOpen(true);
                }}
              >
                {shortcutIcons[key]}
                <span>{label}</span>
              </Button>
            );
          })}
        </div></div>
        <Panel className="product-catalog-panel">
          <div className="product-catalog-header-row"><div><h2>Productos disponibles</h2><p className="muted">Selecciona productos y ajusta las cantidades antes de revisar el cobro.</p></div>
            <div className="catalog-header-actions"><Button variant="secondary" disabled={!registerId || locked} onClick={() => setIsDevolucionesOpen(true)}>Devoluciones</Button><Button variant="secondary" disabled title="Aún no disponible">Merma</Button></div>
          </div>
          <div className="field"><label htmlFor="product-sale-register">Caja</label><select id="product-sale-register" value={registerId} disabled={locked || registers.length === 1} onChange={event => { setRegisterId(event.target.value); setQuantities({}); setStep(1); }}>
            <option value="">Selecciona una caja</option>{registers.map(register => <option key={register.id} value={register.id}>{branches.find(branch => branch.id === register.branch_id)?.name ?? register.branch_id} · {register.name} · {register.code}</option>)}
          </select></div>
          {stock.length ? <div className="product-grid">{stock.map(item => <ProductCard key={item.product_id}
            product={{ id: item.product_id, name: item.name, priceMinor: item.price_minor }} stock={item.quantity ?? 0}
            quantity={quantities[item.product_id] ?? 0} disabled={locked} onQuantityChange={quantity => changeQuantity(item.product_id, quantity)} />)}</div>
            : <EmptyState title="Sin productos">Selecciona una caja y revisa el inventario.</EmptyState>}
        </Panel>
      </div>
      <MobileDetailPanel title="Compra actual" triggerLabel="Ver compra actual" className="reception-current-purchase-slot">
        <CurrentPurchaseCard totalMinor={total} disabled={locked} step={step} onStepChange={setStep}
          useLiveCardIntent
          step1ActionDisabled={!selected.length || !registerId || locked} onConfirmPayment={value => void submit(value)}
          statusMessage={message} statusType={error ? 'error' : pending ? 'warning' : 'success'}
          assignedMember={member ? { id: member.id, name: member.full_name, phone: member.phone } : null}
          memberAssignment={<div className="cart-member-section"><div className="field"><label htmlFor="product-sale-member">Asignar socio</label>
            <input id="product-sale-member" value={member?.full_name ?? query} disabled={locked || !!member} onChange={event => setQuery(event.target.value)} />
            {member && <Button variant="secondary" disabled={locked} onClick={() => { setMember(null); setQuery(''); }}>Desasignar</Button>}
            {members.map(item => <button type="button" key={item.id} onClick={() => { setMember(item); setMembers([]); }}>{item.full_name}</button>)}
          </div></div>}>
          <div className="cart-items-section">{intent ? <><p>Compra pendiente de confirmar. Socio: {intent.payload.member_id ? recoveredMemberName || intent.payload.member_id : 'Sin asignar'}</p><ul className="cart-lines">{intent.payload.items.map(item => <li className="cart-line-row" key={item.product_id}>{item.quantity} × {stock.find(product => product.product_id === item.product_id)?.name ?? item.product_id}</li>)}</ul></> : selected.length ? <ul className="cart-lines">{selected.map(item => <li className="cart-line-row" key={item.product_id}>
            <span>{quantities[item.product_id]} × {item.name}</span><strong>{formatMoney(item.price_minor * quantities[item.product_id])} MXN</strong>
            <button type="button" disabled={locked} onClick={() => changeQuantity(item.product_id, 0)}>Quitar</button>
          </li>)}</ul> : <p className="cart-empty-msg">Sin productos seleccionados.</p>}</div>
        </CurrentPurchaseCard>
        {activeCardIntentId && (
          <div style={{ marginTop: '8px' }}>
            <Button variant="secondary" onClick={() => void cancelCurrentCardIntent()}>
              Cancelar cobro en terminal
            </Button>
          </div>
        )}
        {intent && !activeCardIntentId && <div><p role="status">La compra está pendiente de confirmación. Al resolverla se recupera la venta registrada o se cancela el intento si no se registró.</p>
          <Button disabled={pending} onClick={() => void resolveIntent()}>Resolver compra pendiente</Button></div>}
      </MobileDetailPanel>
    </div>
    {registerId && (
      <DevolucionesModal
        isOpen={isDevolucionesOpen}
        onClose={() => setIsDevolucionesOpen(false)}
        apiRequest={request}
        registerId={registerId}
        initialMemberId={member?.id}
        onSuccess={({ message: returnMsg }) => {
          setRevision(v => v + 1);
          setMessage(returnMsg);
          setError(false);
        }}
      />
    )}
  </>;
}
