import React, { useEffect, useRef, useState } from 'react';
import type { PaymentMethod, SupplementProduct } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { memberStatus } from '../../demo/memberStatus';
import { quoteSupplementCart, registerSupplementCart } from '../../demo/supplementOperations';
import { Button, Notice } from '../../shared/ui';
import AnimatedList from '../catalog/react-bits/AnimatedList';
import JellyRadio from '../catalog/react-bits/JellyRadio';
import SwipeToast from '../catalog/react-bits/SwipeToast';

export interface SuplementosModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export function SuplementosModal({ isOpen, onClose }: SuplementosModalProps) {
  const { state, transact } = useDemo();
  const supplements = state.supplements ?? [];

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [assignedMemberId, setAssignedMemberId] = useState<string | null>(null);
  const [tenderedAmount, setTenderedAmount] = useState<string>('');

  const [memberQuery, setMemberQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedMemberIndex, setSelectedMemberIndex] = useState(-1);
  const memberSearchContainerRef = useRef<HTMLDivElement>(null);
  const memberInputRef = useRef<HTMLInputElement>(null);

  const [toast, setToast] = useState<{
    open: boolean;
    title: string;
    description: string;
    type: 'success' | 'error' | 'warning';
  } | null>(null);

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

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

  useEffect(() => {
    if (isOpen) {
      setQuantities({});
      setAssignedMemberId(null);
      setTenderedAmount('');
      setToast(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const lines = Object.entries(quantities)
    .filter(([, scoops]) => scoops > 0)
    .map(([supplementId, scoops]) => ({ supplementId, scoops }));

  const quote = quoteSupplementCart(state, lines);
  const totalMinor = quote?.totalMinor ?? 0;

  const assignedMember = assignedMemberId
    ? state.members.find(m => m.id === assignedMemberId) ?? null
    : null;

  const tenderedMinor = parseMoney(tenderedAmount);
  const changeMinor =
    tenderedMinor !== null && quote ? tenderedMinor - quote.totalMinor : null;

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
            label: 'Otros socios activos',
            items: withoutAttendance.map(m => ({
              id: m.id,
              title: m.name,
              description: 'Socio activo',
              meta: m.phone || undefined,
              member: m,
            })),
          },
        ]
      : []),
  ];

  function handleAssignMember(memberId: string) {
    setAssignedMemberId(memberId);
    setIsSearchOpen(false);
    setMemberQuery('');
    setSelectedMemberIndex(-1);
  }

  function changeQuantity(supplementId: string, nextQty: number) {
    const sup = supplements.find(s => s.id === supplementId);
    const maxQty = sup ? sup.availableScoops : 0;
    const clamped = Math.max(0, Math.min(nextQty, maxQty));

    setQuantities(prev => ({
      ...prev,
      [supplementId]: clamped,
    }));
  }

  function handleConfirmSale() {
    if (!quote || !lines.length) return;
    const cartId = `sup-cart-${crypto.randomUUID()}`;

    const result = transact(current =>
      registerSupplementCart(current, {
        id: cartId,
        method,
        memberId: assignedMemberId,
        lines,
      })
    );

    if (result.status === 'confirmed' || result.status === 'pending') {
      const msg = `Venta de ${lines.reduce((acc, l) => acc + l.scoops, 0)} porción(es) de suplemento confirmada.`;
      setQuantities({});
      setTenderedAmount('');
      setToast({
        open: true,
        title: 'Cobro de suplementos confirmado',
        description: msg,
        type: 'success',
      });
    } else if (result.status === 'error') {
      setToast({
        open: true,
        title: 'Error en venta',
        description: result.message,
        type: 'error',
      });
    }
  }

  return (
    <div
      className="staff-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="suplementos-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="staff-modal-card suplementos-modal-card">
        {/* Header */}
        <div className="guantes-modal-header">
          <div className="guantes-modal-title-group">
            <h2 id="suplementos-modal-title">Suplementos</h2>
            <p className="muted">Venta de suplementos por porción (scoop)</p>
          </div>
          <button
            type="button"
            className="guantes-close-btn"
            aria-label="Cerrar modal de suplementos"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Modal Main Body */}
        <div className="guantes-modal-body">
          {/* Left: Supplement Grid */}
          <div className="suplementos-grid-container" role="group" aria-label="Catálogo de suplementos">
            {supplements.map(sup => {
              const qty = quantities[sup.id] || 0;
              const hasStock = sup.availableScoops > 0;

              const labelSuffix = sup.flavor ? ` (${sup.flavor})` : '';

              return (
                <div
                  key={sup.id}
                  className={`product-clay-card ${qty > 0 ? 'product-selected' : ''}`}
                    >
                      <div className="product-card-top">
                        <span
                          className={`product-stock-badge ${
                            sup.availableScoops <= 5 ? 'stock-low' : ''
                          }`}
                        >
                          {hasStock ? `${sup.availableScoops} scoops` : 'Agotado'}
                        </span>
                      </div>

                      <div className="product-card-middle">
                        <strong>{sup.name}</strong>
                        {sup.flavor && <span className="muted" style={{ fontSize: '12px' }}>{sup.flavor}</span>}
                        <span className="product-card-price">{formatMoney(sup.scoopPriceMinor)} / scoop</span>
                      </div>

                      <div className="suplemento-qty-controls">
                        <button
                          type="button"
                          className="qty-btn"
                          aria-label={`Disminuir ${sup.name}${labelSuffix}`}
                          disabled={qty <= 0}
                          onClick={() => changeQuantity(sup.id, qty - 1)}
                        >
                          −
                        </button>
                        <span className="suplemento-qty-val" aria-label={`Cantidad de ${sup.name}${labelSuffix}`}>
                          {qty}
                        </span>
                        <button
                          type="button"
                          className="qty-btn"
                          aria-label={`Aumentar ${sup.name}${labelSuffix}`}
                          disabled={qty >= sup.availableScoops}
                          onClick={() => changeQuantity(sup.id, qty + 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
            })}
          </div>

          {/* Right: Cart Panel */}
          <div className="guantes-sidebar-column">
            <div className="guantes-bento-card">
              <h3>Carrito de suplementos</h3>

              {/* Asignar socio */}
              {!assignedMember ? (
                <div className="cart-member-search" ref={memberSearchContainerRef}>
                  <div className="field">
                    <label htmlFor="sup-assign-member-input">Asignar cliente</label>
                    <div className="cart-member-search-input-wrap">
                      <input
                        ref={memberInputRef}
                        id="sup-assign-member-input"
                        type="text"
                        role="combobox"
                        aria-label="Asignar cliente"
                        aria-expanded={isSearchOpen}
                        aria-autocomplete="list"
                        autoComplete="off"
                        placeholder="Buscar socio activo..."
                        value={memberQuery}
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
                          id="sup-member-item"
                          listboxId="sup-member-results"
                          tabIndex={-1}
                          groups={memberGroups}
                          selectedIndex={selectedMemberIndex}
                          onSelectedIndexChange={setSelectedMemberIndex}
                          onItemSelect={(_item, index) => {
                            const m = flatActiveMembers[index];
                            if (m) handleAssignMember(m.id);
                          }}
                          theme={dark ? 'dark' : 'light'}
                          accentColor="#FC6C06"
                          frame={false}
                          loop={false}
                          animation="pop"
                          width="100%"
                          maxHeight={180}
                        />
                      ) : (
                        <p className="cart-no-members-msg" role="status">
                          Sin socios activos coincidentes.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="guantes-quick-members">
                    <span className="guantes-quick-label">Sugeridos:</span>
                    <div className="guantes-quick-chips">
                      {flatActiveMembers.slice(0, 3).map(m => (
                        <button
                          key={m.id}
                          type="button"
                          className="guantes-quick-chip"
                          onClick={() => handleAssignMember(m.id)}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="assigned-member-card">
                  <div className="assigned-member-info">
                    <span className="assigned-member-tag">Socio asignado:</span>
                    <strong>{assignedMember.name}</strong>
                  </div>
                  <Button
                    variant="secondary"
                    className="button-sm"
                    aria-label="Desasignar socio"
                    onClick={() => {
                      setAssignedMemberId(null);
                      setMemberQuery('');
                    }}
                  >
                    Desasignar
                  </Button>
                </div>
              )}

              {/* Método de pago */}
              <div className="cart-payment-methods-box" style={{ margin: '10px 0' }}>
                <span className="field-label">Método de pago</span>
                <div className="cart-jelly-method-wrap">
                  <JellyRadio
                    items={[
                      { value: 'cash', label: 'Efectivo' },
                      { value: 'card', label: 'Tarjeta' },
                      { value: 'transfer', label: 'Transferencia' },
                    ]}
                    value={method}
                    onChange={val => setMethod(val as PaymentMethod)}
                    size="sm"
                    radius={10}
                    swell={0}
                    barge={0}
                    shrink={0}
                    chipColor={dark ? '#26232E' : '#EFEFED'}
                    activeColor="#FC6C06"
                    textColor={dark ? '#D1D0D5' : '#3F3F46'}
                    activeTextColor="#FFFFFF"
                    ariaLabel="Método de pago"
                  />
                </div>
              </div>

              {/* Cash tender / change */}
              {method === 'cash' && (
                <div className="cash-tender-card" style={{ margin: '0 0 10px' }}>
                  <div className="field">
                    <label htmlFor="sup-cash-tendered-input">Monto recibido</label>
                    <div className="cash-tender-input-row">
                      <input
                        id="sup-cash-tendered-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={tenderedAmount}
                        onChange={e => setTenderedAmount(e.target.value)}
                      />
                      <Button
                        variant="secondary"
                        className="button-sm"
                        disabled={!quote}
                        onClick={() => {
                          if (quote) {
                            setTenderedAmount((quote.totalMinor / 100).toFixed(2));
                          }
                        }}
                      >
                        Pago exacto
                      </Button>
                    </div>
                  </div>
                  <div className="cash-change-result">
                    <span>Cambio a devolver:</span>
                    <strong>
                      {changeMinor !== null && changeMinor >= 0
                        ? `${formatMoney(changeMinor)} MXN`
                        : changeMinor !== null
                        ? 'Monto insuficiente'
                        : '$0.00 MXN'}
                    </strong>
                  </div>
                </div>
              )}

              {method === 'transfer' && (
                <Notice tone="warning">
                  T03: La transferencia queda pendiente hasta verificar el comprobante bancario en caja.
                </Notice>
              )}

              {/* Items in cart */}
              <div className="cart-items-section" style={{ margin: '10px 0' }}>
                {!lines.length ? (
                  <p className="cart-empty-msg">Sin suplementos en el carrito.</p>
                ) : (
                  <ul className="cart-lines">
                    {quote?.lines.map(line => (
                      <li key={line.supplementId} className="cart-line-row">
                        <div className="cart-line-details">
                          <span>{line.scoops} × {line.name}</span>
                          <span className="cart-line-unit muted">{formatMoney(line.unitPriceMinor)} c/u</span>
                        </div>
                        <div className="cart-line-actions">
                          <button
                            type="button"
                            className="qty-btn"
                            aria-label={`Disminuir ${line.name}`}
                            onClick={() => changeQuantity(line.supplementId, line.scoops - 1)}
                          >
                            −
                          </button>
                          <button
                            type="button"
                            className="qty-btn"
                            aria-label={`Aumentar ${line.name}`}
                            onClick={() => changeQuantity(line.supplementId, line.scoops + 1)}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            className="qty-btn qty-btn-remove"
                            aria-label={`Quitar ${line.name}`}
                            onClick={() => changeQuantity(line.supplementId, 0)}
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

              {/* Total & Action */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                <span className="field-label" style={{ fontSize: '15px' }}>Total a cobrar:</span>
                <strong style={{ fontSize: '18px', color: 'var(--color-primary)' }}>
                  {formatMoney(totalMinor)} MXN
                </strong>
              </div>

              <Button
                variant="primary"
                disabled={!lines.length || (method === 'cash' && changeMinor !== null && changeMinor < 0)}
                onClick={handleConfirmSale}
                style={{ marginTop: '12px' }}
              >
                Confirmar cobro de suplementos
              </Button>
            </div>
          </div>
        </div>
      </div>

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
    </div>
  );
}
