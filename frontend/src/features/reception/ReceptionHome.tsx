import { useEffect, useRef, useState } from 'react';
import type { PaymentMethod } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { memberStatus } from '../../demo/memberStatus';
import { expectedStock, recordMovement } from '../../demo/inventoryOperations';
import { cartQuote, registerCart } from '../../demo/salesOperations';
import { Button, EmptyState, Notice, PageHeader, Panel } from '../../shared/ui';
import AnimatedList from '../catalog/react-bits/AnimatedList';
import SwipeToast from '../catalog/react-bits/SwipeToast';
import { CurrentPurchaseCard } from './CurrentPurchaseCard';
import { AssignedMemberSummary } from './AssignedMemberSummary';
import { MermaModal } from './MermaModal';
import { GuantesModal } from './GuantesModal';
import { CasillerosModal } from './CasillerosModal';
import { SuplementosModal } from './SuplementosModal';
import { GastoModal } from './GastoModal';
import { ExtraModal } from './ExtraModal';
import { CashTenderCalculator } from '../payments/CashTenderCalculator';
import { ProductCard } from './ProductCard';
import { MobileDetailPanel } from '../../shared/MobileDetailPanel';

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

const memberFavoriteMethods: Record<string, PaymentMethod> = {
  'demo-001': 'card',
  'demo-002': 'transfer',
  'demo-active': 'cash',
  'demo-expired': 'cash',
  'demo-expiry': 'card',
  'demo-unknown': 'cash',
};

const shortcutIcons = {
  gasto: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  ),
  extra: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  ),
  guantes: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h8a4 4 0 0 1 4 4v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V7a4 4 0 0 1 2-3.46" />
      <path d="M18 9h1a3 3 0 0 1 3 3v1a3 3 0 0 1-3 3h-1" />
      <path d="M6 17v4h8v-4" />
    </svg>
  ),
  suplementos: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3h10v3H7z" />
      <path d="M5 6h14a1 1 0 0 1 1 1v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  ),
  casilleros: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <circle cx="7.5" cy="7.5" r="1" fill="currentColor" />
      <circle cx="16.5" cy="7.5" r="1" fill="currentColor" />
      <circle cx="7.5" cy="16.5" r="1" fill="currentColor" />
      <circle cx="16.5" cy="16.5" r="1" fill="currentColor" />
    </svg>
  ),
};

export function ReceptionHome() {
  const { state, transact } = useDemo();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [assignedMemberId, setAssignedMemberId] = useState<string | null>(null);
  const [tenderedAmount, setTenderedAmount] = useState<string>('');
  const [isMermaOpen, setIsMermaOpen] = useState(false);
  const [isGuantesOpen, setIsGuantesOpen] = useState(false);
  const [isCasillerosOpen, setIsCasillerosOpen] = useState(false);
  const [isSuplementosOpen, setIsSuplementosOpen] = useState(false);
  const [isGastoOpen, setIsGastoOpen] = useState(false);
  const [isExtraOpen, setIsExtraOpen] = useState(false);
  const [review, setReview] = useState<{ id: string; revision: number; totalMinor: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [toast, setToast] = useState<{
    open: boolean;
    title: string;
    description: string;
    type: 'success' | 'error' | 'warning';
  } | null>(null);

  // Theme observer for JellyRadio & AnimatedList light/dark mode adaptation
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    const currentTheme = document.documentElement.dataset.theme;
    return currentTheme ? currentTheme === 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  });

  useEffect(() => {
    function syncTheme() {
      const currentTheme = document.documentElement.dataset.theme;
      if (currentTheme) {
        setDark(currentTheme === 'dark');
      } else {
        setDark(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
      }
    }
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // Member search in cart
  const memberSearchContainerRef = useRef<HTMLDivElement>(null);
  const memberInputRef = useRef<HTMLInputElement>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedMemberIndex, setSelectedMemberIndex] = useState(-1);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent | PointerEvent) {
      if (memberSearchContainerRef.current && !memberSearchContainerRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false);
      }
    }
    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, []);

  const cartId = useRef<string | null>(null);

  const lines = Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([productId, quantity]) => ({ productId, quantity }));

  const quote = cartQuote(state, lines);
  const totalMinor = quote?.totalMinor ?? 0;

  const assignedMember = assignedMemberId
    ? state.members.find(m => m.id === assignedMemberId) ?? null
    : null;

  const tenderedMinor = parseMoney(tenderedAmount);
  // Active members only, prioritizing attendance
  const activeMembers = state.members.filter(m => {
    return memberStatus(m, state.demoClock).status === 'active';
  });

  const hasOpenAttendance = (memberId: string) =>
    state.attendance.some(a => a.memberId === memberId && !a.observedCheckOut && !a.autoClosedAt);

  const hasAnyAttendance = (memberId: string) =>
    state.attendance.some(a => a.memberId === memberId);

  const q = memberQuery.trim().toLowerCase();
  const matchingMembers = activeMembers.filter(m => {
    if (!q) return true;
    return m.name.toLowerCase().includes(q) || (m.phone && m.phone.toLowerCase().includes(q));
  });

  const withAttendance = matchingMembers
    .filter(m => hasOpenAttendance(m.id) || hasAnyAttendance(m.id))
    .sort((a, b) => {
      const aOpen = hasOpenAttendance(a.id) ? 1 : 0;
      const bOpen = hasOpenAttendance(b.id) ? 1 : 0;
      if (aOpen !== bOpen) return bOpen - aOpen;
      return a.name.localeCompare(b.name);
    });

  const withoutAttendance = matchingMembers
    .filter(m => !hasOpenAttendance(m.id) && !hasAnyAttendance(m.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const flatActiveMembers = [...withAttendance, ...withoutAttendance];

  const memberGroups = [
    ...(withAttendance.length > 0
      ? [
          {
            label: 'Con asistencia',
            items: withAttendance.map(m => ({
              id: m.id,
              title: m.name,
              description: hasOpenAttendance(m.id)
                ? '🟢 En el gimnasio · Activo'
                : '⏱ Con asistencia · Activo',
              meta: m.phone || undefined,
              member: m,
            })),
          },
        ]
      : []),
    ...(withoutAttendance.length > 0
      ? [
          {
            label: 'Socios activos',
            items: withoutAttendance.map(m => ({
              id: m.id,
              title: m.name,
              description: 'Activo',
              meta: m.phone || undefined,
              member: m,
            })),
          },
        ]
      : []),
  ];

  function changeQuantity(productId: string, quantity: number) {
    if (pending || !Number.isSafeInteger(quantity) || quantity < 0) return;
    setQuantities(previous => ({ ...previous, [productId]: quantity }));
    setReview(null);
    cartId.current = null;
    setMessage('');
  }

  function handleAssignMember(selectedId: string) {
    if (!selectedId) {
      setAssignedMemberId(null);
      return;
    }
    setAssignedMemberId(selectedId);
    setIsSearchOpen(false);
    setMemberQuery('');
    setSelectedMemberIndex(-1);
    const member = state.members.find(m => m.id === selectedId);
    if (member) {
      const fav =
        (member as { favoritePaymentMethod?: PaymentMethod }).favoritePaymentMethod ??
        memberFavoriteMethods[member.id] ??
        'cash';
      setMethod(fav);
      setReview(null);
      cartId.current = null;
    }
  }

  function handleWasteMovement(productId: string, quantity: number, _reason: string) {
    const result = transact(current =>
      recordMovement(current, {
        id: `waste-${crypto.randomUUID()}`,
        productId,
        kind: 'waste',
        quantity,
      })
    );
    if (result.status === 'ok') {
      const prodName = state.products.find(p => p.id === productId)?.name ?? 'producto';
      const successMsg = `Merma registrada: ${quantity} unidad(es) de ${prodName} descontada(s) del inventario.`;
      setMessage(successMsg);
      setError(false);
      setToast({
        open: true,
        type: 'success',
        title: 'Merma registrada',
        description: successMsg,
      });
    }
    return result;
  }

  return (
    <>
      <PageHeader
        eyebrow="RECEPCIÓN · INICIO"
        title="Inicio de recepción"
        description="Socios y ventas, a un paso."
      />

      <div className="reception-checkout">
        {/* Left Column: Shortcuts + Product Catalog (Bounded to products width) */}
        <div className="reception-products-column">
          {/* Top shortcuts bar */}
          <div className="reception-shortcuts-container">
            <div className="reception-clay-actions" role="group" aria-label="Acciones operativas rápidas">
              <Button
                variant="secondary"
                className="shortcut-clay-btn"
                onClick={() => setIsGastoOpen(true)}
              >
                {shortcutIcons.gasto}
                <span>Gasto</span>
              </Button>
              <Button
                variant="secondary"
                className="shortcut-clay-btn"
                onClick={() => setIsExtraOpen(true)}
              >
                {shortcutIcons.extra}
                <span>Extra</span>
              </Button>
              <Button
                variant="secondary"
                className="shortcut-clay-btn"
                onClick={() => setIsGuantesOpen(true)}
              >
                {shortcutIcons.guantes}
                <span>Guantes</span>
              </Button>
              <Button
                variant="secondary"
                className="shortcut-clay-btn"
                onClick={() => setIsSuplementosOpen(true)}
              >
                {shortcutIcons.suplementos}
                <span>Suplementos</span>
              </Button>
              <Button
                variant="secondary"
                className="shortcut-clay-btn"
                onClick={() => setIsCasillerosOpen(true)}
              >
                {shortcutIcons.casilleros}
                <span>Casilleros</span>
              </Button>
            </div>
          </div>

          {/* Product Catalog Grid */}
          <Panel className="product-catalog-panel">
            <div className="product-catalog-header-row">
              <div>
                <h2>Productos disponibles</h2>
                <p className="muted">Selecciona productos y ajusta las cantidades antes de revisar el cobro.</p>
              </div>
              <Button
                variant="secondary"
                className="catalog-merma-header-btn"
                aria-label="Merma"
                disabled={pending}
                onClick={() => setIsMermaOpen(true)}
                title="Registrar merma o pérdida de producto"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                <span>Merma</span>
              </Button>
            </div>

            {state.products.length ? (
              <div className="product-grid">
                {state.products.map(product => {
                  const stock = expectedStock(state, product.id);
                  const currentQty = quantities[product.id] ?? 0;
                  return <ProductCard key={product.id} product={product} stock={stock} quantity={currentQty} disabled={pending} onQuantityChange={quantity => changeQuantity(product.id, quantity)} />;
                })}
              </div>
            ) : (
              <EmptyState title="Sin productos">Revisa el inventario.</EmptyState>
            )}
          </Panel>
        </div>

        {/* Right Column: Cart Panel ("Carrito") */}
        <MobileDetailPanel title="Compra actual" triggerLabel="Ver compra actual" className="reception-current-purchase-slot">
        <CurrentPurchaseCard
          totalMinor={totalMinor}
          paymentMethod={method}
          disabled={pending}
          onPaymentMethodChange={nextMethod => {
            setMethod(nextMethod);
            setReview(null);
            cartId.current = null;
          }}
          headerContent={<>
            {/* Primary Action Button right at top */}
            {review ? (
              <div className="checkout-review-section top-review">
                <h3>Revisar cobro · {formatMoney(review.totalMinor)} MXN</h3>

                {method === 'cash' && (
                  <Notice tone="warning">
                    Confirma solo después de recibir el pago.
                    {tenderedMinor !== null && tenderedMinor >= review.totalMinor ? (
                      <>
                        <br />
                        Efectivo recibido: <strong>{formatMoney(tenderedMinor)} MXN</strong> · Cambio: <strong>{formatMoney(tenderedMinor - review.totalMinor)} MXN</strong>.
                      </>
                    ) : (
                      <> El registro local no procesa pagos ni calcula cambio bancario.</>
                    )}
                  </Notice>
                )}

                {method === 'card' && (
                  <Notice tone="warning">
                    <strong>Cobro en terminal bancaria:</strong> {formatMoney(review.totalMinor)} MXN.
                    <br />
                    <span style={{ fontSize: '12px' }}>
                      Fórmula de comisión Clip/banco: <code>Precio - (Precio × 0.0406)</code> · Comisión estimada (4.06%): {formatMoney(Math.round(review.totalMinor * 0.0406))} MXN · Neto: {formatMoney(review.totalMinor - Math.round(review.totalMinor * 0.0406))} MXN.
                    </span>
                  </Notice>
                )}

                {method === 'transfer' && (
                  <Notice tone="warning">
                    <strong>Control de seguridad de transferencia (T03):</strong> Verifica que el comprobante recibido coincida exactamente con {formatMoney(review.totalMinor)} MXN. La compra se registrará con estado <em>pendiente</em> sin cobro confirmado ni descuento de inventario.
                  </Notice>
                )}

                <div className="flow">
                  <Button
                    className="confirm-checkout-btn"
                    disabled={pending}
                    onClick={() => {
                      const result = transact(current =>
                        current.revision !== review.revision
                          ? {
                              state: current,
                              result: {
                                status: 'error' as const,
                                message: 'Los registros cambiaron. Revisa la compra de nuevo.',
                              },
                            }
                          : registerCart(current, { id: review.id, method, lines })
                      );
                      setError(result.status === 'error');
                      setReview(null);
                      if (result.status === 'error') {
                        setMessage(result.message);
                        setToast({
                          open: true,
                          type: 'error',
                          title: 'Error en compra',
                          description: result.message,
                        });
                      } else if (result.status === 'pending') {
                        setPending(true);
                        const pendingMsg =
                          'Transferencia pendiente: compra conservada, sin cobro confirmado ni descuento de inventario.';
                        setMessage(pendingMsg);
                        setToast({
                          open: true,
                          type: 'warning',
                          title: 'Transferencia pendiente',
                          description: pendingMsg,
                        });
                      } else {
                        const successMsg =
                          'Cobro registrado. Compra completa registrada; lista para la siguiente compra.';
                        setMessage(successMsg);
                        setQuantities({});
                        setTenderedAmount('');
                        cartId.current = null;
                        setToast({
                          open: true,
                          type: 'success',
                          title: 'Cobro confirmado',
                          description: successMsg,
                        });
                      }
                    }}
                  >
                    {method === 'transfer' ? 'Registrar compra pendiente' : 'Registrar cobro'}
                  </Button>
                  <Button variant="secondary" onClick={() => setReview(null)}>
                    Volver a la compra
                  </Button>
                </div>
              </div>
            ) : (
              !pending && (
                <Button
                  className="cart-primary-action-btn"
                  disabled={!quote}
                  onClick={() => {
                    if (quote) {
                      cartId.current ??= `cart-${crypto.randomUUID()}`;
                      setReview({
                        id: cartId.current,
                        revision: state.revision,
                        totalMinor: quote.totalMinor,
                      });
                      setMessage('');
                    }
                  }}
                >
                  Revisar cobro
                </Button>
              )
            )}

            {/* Outcome notification element */}
            <div role={error ? 'alert' : 'status'} aria-label="Resultado de compra">
              {message && (
                <Notice tone={error ? 'error' : pending ? 'warning' : 'success'}>
                  {message}
                </Notice>
              )}
            </div>
          </>}
          memberAssignment={<>
          {/* Member assignment search */}
          <div className={`cart-member-section ${isSearchOpen ? 'is-dropdown-open' : ''}`}>
            {!assignedMember ? (
              <div className="cart-member-search" ref={memberSearchContainerRef}>
                <div className="field">
                  <label htmlFor="assign-member-input">Asignar socio</label>
                  <div className="cart-member-search-input-wrap">
                    <input
                      ref={memberInputRef}
                      id="assign-member-input"
                      type="text"
                      role="combobox"
                      aria-label="Asignar socio"
                      aria-expanded={isSearchOpen}
                      aria-autocomplete="list"
                      autoComplete="off"
                      placeholder="Buscar socio activo..."
                      value={memberQuery}
                      disabled={pending}
                      onFocus={() => setIsSearchOpen(true)}
                      onChange={e => {
                        setMemberQuery(e.target.value);
                        setIsSearchOpen(true);
                        setSelectedMemberIndex(-1);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Escape') {
                          setIsSearchOpen(false);
                        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          setIsSearchOpen(true);
                          const count = flatActiveMembers.length;
                          if (count > 0) {
                            const next =
                              selectedMemberIndex < 0
                                ? e.key === 'ArrowDown' ? 0 : count - 1
                                : (selectedMemberIndex + (e.key === 'ArrowDown' ? 1 : -1) + count) % count;
                            setSelectedMemberIndex(next);
                          }
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          if (selectedMemberIndex >= 0 && selectedMemberIndex < flatActiveMembers.length) {
                            handleAssignMember(flatActiveMembers[selectedMemberIndex].id);
                          }
                        }
                      }}
                    />
                    {memberQuery && (
                      <button
                        type="button"
                        className="cart-search-clear-btn"
                        aria-label="Limpiar búsqueda"
                        onClick={() => {
                          setMemberQuery('');
                          memberInputRef.current?.focus();
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                {isSearchOpen && (
                  <div className="cart-member-dropdown" onMouseDown={e => e.preventDefault()}>
                    {flatActiveMembers.length > 0 ? (
                      <AnimatedList
                        id="cart-member-item"
                        listboxId="cart-member-results"
                        tabIndex={-1}
                        groups={memberGroups}
                        selectedIndex={selectedMemberIndex}
                        onSelectedIndexChange={setSelectedMemberIndex}
                        onItemSelect={(_item, index) => {
                          const member = flatActiveMembers[index];
                          if (member) handleAssignMember(member.id);
                        }}
                        theme={dark ? 'dark' : 'light'}
                        accentColor="#FC6C06"
                        frame={false}
                        loop={false}
                        animation="pop"
                        width="100%"
                        maxHeight={260}
                      />
                    ) : (
                      <p className="cart-no-members-msg" role="status">
                        No hay socios activos que coincidan.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="assigned-member-card">
                <AssignedMemberSummary name={assignedMember.name} phone={assignedMember.phone}>
                  {assignedMember.creditMinor > 0 && (
                    <span className="member-credit-pill">
                      Saldo a favor: {formatMoney(assignedMember.creditMinor)} MXN
                    </span>
                  )}
                </AssignedMemberSummary>
                <Button
                  variant="secondary"
                  className="button-sm"
                  aria-label="Desasignar socio"
                  disabled={pending}
                  onClick={() => {
                    setAssignedMemberId(null);
                    setMemberQuery('');
                  }}
                >
                  Desasignar
                </Button>
              </div>
            )}
          </div>
          </>}
        >

          {/* Cash Tender & Change */}
          {method === 'cash' && <CashTenderCalculator totalMinor={totalMinor} value={tenderedAmount} onChange={setTenderedAmount} disabled={pending} />}

          {/* Cart products list */}
          <div className="cart-items-section">
            {!lines.length ? (
              <p className="cart-empty-msg">Sin productos seleccionados.</p>
            ) : (
              <ul className="cart-lines">
                {quote?.lines.map(line => (
                  <li key={line.productId} className="cart-line-row">
                    <div className="cart-line-details">
                      <span>{line.quantity} × {line.description}</span>
                      <span className="cart-line-unit muted">{formatMoney(line.unitPriceMinor)} c/u</span>
                    </div>
                    <div className="cart-line-actions">
                      <button
                        type="button"
                        className="qty-btn"
                        aria-label={`Disminuir ${line.description} en carrito`}
                        disabled={pending}
                        onClick={() => changeQuantity(line.productId, line.quantity - 1)}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="qty-btn"
                        aria-label={`Aumentar ${line.description} en carrito`}
                        disabled={pending}
                        onClick={() => changeQuantity(line.productId, line.quantity + 1)}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="qty-btn qty-btn-remove"
                        aria-label={`Quitar ${line.description} de carrito`}
                        title="Quitar"
                        disabled={pending}
                        onClick={() => changeQuantity(line.productId, 0)}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                    <strong>{formatMoney(line.amountMinor)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CurrentPurchaseCard>
        </MobileDetailPanel>
      </div>

      {/* Merma Modal Dialog */}
      <MermaModal
        isOpen={isMermaOpen}
        onClose={() => setIsMermaOpen(false)}
        products={state.products}
        state={state}
        onConfirmWaste={handleWasteMovement}
      />

      {/* Guantes Modal Dialog */}
      <GuantesModal
        isOpen={isGuantesOpen}
        onClose={() => setIsGuantesOpen(false)}
      />

      {/* Casilleros Modal Dialog */}
      <CasillerosModal
        isOpen={isCasillerosOpen}
        onClose={() => setIsCasillerosOpen(false)}
      />

      {/* Suplementos Modal Dialog */}
      <SuplementosModal
        isOpen={isSuplementosOpen}
        onClose={() => setIsSuplementosOpen(false)}
      />

      {/* Gasto Modal Dialog */}
      <GastoModal
        isOpen={isGastoOpen}
        onClose={() => setIsGastoOpen(false)}
      />

      {/* Extra Modal Dialog */}
      <ExtraModal
        isOpen={isExtraOpen}
        onClose={() => setIsExtraOpen(false)}
      />

      {/* SwipeToast interactive notification */}
      {toast && (
        <div className="reception-toast-wrapper">
          <SwipeToast
            open={toast.open}
            title={toast.title}
            description={toast.description}
            duration={3200}
            fuse={toast.type === 'error' ? 'none' : 'bottom'}
            closeButton
            closeLabel="Cerrar notificación"
            background="var(--color-surface)"
            color="var(--color-ink)"
            fuseColor={
              toast.type === 'error'
                ? 'var(--catalog-field-error, #A32222)'
                : 'var(--color-primary)'
            }
            onClose={() => setToast(null)}
          />
        </div>
      )}
    </>
  );
}
