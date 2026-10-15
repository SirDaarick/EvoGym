import React, { useEffect, useRef, useState } from 'react';
import type { GloveItem, PaymentMethod } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { memberStatus } from '../../demo/memberStatus';
import { rentGlove, returnGlove } from '../../demo/gloveOperations';
import { Button, Notice } from '../../shared/ui';
import AnimatedList from '../catalog/react-bits/AnimatedList';
import JellyRadio from '../catalog/react-bits/JellyRadio';
import SwipeToast from '../catalog/react-bits/SwipeToast';

export interface GuantesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GuantesModal({ isOpen, onClose }: GuantesModalProps) {
  const { state, transact } = useDemo();
  const gloves = state.gloves ?? [];

  const [selectedGloveId, setSelectedGloveId] = useState<string>('glove-01');
  const [assignedMemberId, setAssignedMemberId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
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

  // Handle escape key
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

  // Handle outside click for member search combobox
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

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setSelectedGloveId('glove-01');
      setAssignedMemberId(null);
      setTenderedAmount('');
      setToast(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedGlove: GloveItem | undefined =
    gloves.find(g => g.id === selectedGloveId) ?? gloves[0];

  const assignedMember = assignedMemberId
    ? state.members.find(m => m.id === assignedMemberId) ?? null
    : null;

  const rentedMember = selectedGlove?.assignedMemberId
    ? state.members.find(m => m.id === selectedGlove.assignedMemberId) ?? null
    : null;

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

  const tenderedMinor = parseMoney(tenderedAmount);
  const changeMinor =
    tenderedMinor !== null && selectedGlove
      ? tenderedMinor - selectedGlove.priceMinor
      : null;

  function handleConfirmRental() {
    if (!selectedGlove || !assignedMemberId) return;
    const rentalId = `rental-${crypto.randomUUID()}`;
    const result = transact(current =>
      rentGlove(current, {
        id: rentalId,
        gloveId: selectedGlove.id,
        memberId: assignedMemberId,
        method,
      })
    );

    if (result.status === 'paid' || result.status === 'pending') {
      const memberName = assignedMember?.name ?? 'socio';
      const success = `Guantes ${selectedGlove.code} rentados exitosamente a ${memberName}.`;
      setAssignedMemberId(null);
      setTenderedAmount('');
      setToast({
        open: true,
        title: 'Renta confirmada',
        description: success,
        type: 'success',
      });
    } else if (result.status === 'error') {
      setToast({
        open: true,
        title: 'Error de renta',
        description: result.message,
        type: 'error',
      });
    }
  }

  function handleReturnGlove() {
    if (!selectedGlove) return;
    const gloveCode = selectedGlove.code;
    const result = transact(current => returnGlove(current, selectedGlove.id));

    if (result.status === 'returned') {
      const success = `Guantes ${gloveCode} devueltos y ahora disponibles para renta.`;
      setToast({
        open: true,
        title: 'Guantes devueltos',
        description: success,
        type: 'success',
      });
    } else if (result.status === 'error') {
      setToast({
        open: true,
        title: 'Error al devolver',
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
      aria-labelledby="guantes-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="staff-modal-card guantes-modal-card">
        {/* Header */}
        <div className="guantes-modal-header">
          <div className="guantes-modal-title-group">
            <h2 id="guantes-modal-title">Guantes</h2>
            <p className="muted">Control de préstamo y renta de guantes de entrenamiento</p>
          </div>
          <button
            type="button"
            className="guantes-close-btn"
            aria-label="Cerrar modal de guantes"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Modal Main Body */}
        <div className="guantes-modal-body">
          {/* Left Grid: 12 Glove Cards */}
          <div className="guantes-grid-container" role="group" aria-label="Catálogo de guantes de entrenamiento">
            {gloves.map(glove => {
              const isSelected = selectedGlove?.id === glove.id;
              const isAvailable = glove.status === 'available';

              return (
                <button
                  key={glove.id}
                  type="button"
                  className={`guante-card ${isSelected ? 'selected' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedGloveId(glove.id);
                  }}
                >
                  <div className="guante-card-header">
                    <span
                      className={`guante-badge ${
                        isAvailable ? 'guante-badge-available' : 'guante-badge-rented'
                      }`}
                    >
                      {isAvailable ? 'Disponible' : 'En uso'}
                    </span>
                  </div>
                  <strong className="guante-card-title">
                    {glove.code} · {glove.color} · {glove.ounces} oz
                  </strong>
                  <span className="guante-card-client">
                    {isAvailable ? 'Disponible' : glove.assignedMemberName || 'Prestado'}
                  </span>
                  <span className="guante-card-price">{formatMoney(glove.priceMinor)} MXN</span>
                </button>
              );
            })}
          </div>

          {/* Right Sidebar: 3 Bento Cards */}
          {selectedGlove && (
            <div className="guantes-sidebar-column">
              {/* Card 1: Asignar a socio / Socio asignado */}
              <div className="guantes-bento-card">
                <h3>{selectedGlove.status === 'available' ? 'Asignar a socio' : 'Socio asignado'}</h3>

                {selectedGlove.status === 'available' ? (
                  <>
                    {!assignedMember ? (
                      <div className="cart-member-search" ref={memberSearchContainerRef}>
                        <div className="field">
                          <label htmlFor="guantes-assign-member-input">Buscar socio activo</label>
                          <div className="cart-member-search-input-wrap">
                            <input
                              ref={memberInputRef}
                              id="guantes-assign-member-input"
                              type="text"
                              role="combobox"
                              aria-label="Buscar socio activo"
                              aria-expanded={isSearchOpen}
                              aria-autocomplete="list"
                              autoComplete="off"
                              placeholder="Buscar por nombre o teléfono..."
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

                        {/* Dropdown list */}
                        {isSearchOpen && (
                          <div className="cart-member-dropdown" onMouseDown={e => e.preventDefault()}>
                            {flatActiveMembers.length > 0 ? (
                              <AnimatedList
                                id="guantes-member-item"
                                listboxId="guantes-member-results"
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
                                maxHeight={220}
                              />
                            ) : (
                              <p className="cart-no-members-msg" role="status">
                                No hay socios activos que coincidan.
                              </p>
                            )}
                          </div>
                        )}

                        {/* Quick member suggestions chips */}
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
                          {assignedMember.phone && (
                            <span className="muted">Tel: {assignedMember.phone}</span>
                          )}
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
                  </>
                ) : (
                  <div className="guantes-assigned-details">
                    <div className="guantes-spec-row">
                      <span className="muted">Socio:</span>
                      <strong>{selectedGlove.assignedMemberName || rentedMember?.name || 'No especificado'}</strong>
                    </div>
                    {rentedMember?.phone && (
                      <div className="guantes-spec-row">
                        <span className="muted">Teléfono:</span>
                        <span>{rentedMember.phone}</span>
                      </div>
                    )}
                    {selectedGlove.assignedAt && (
                      <div className="guantes-spec-row">
                        <span className="muted">Hora de préstamo:</span>
                        <span>
                          {new Date(selectedGlove.assignedAt).toLocaleTimeString('es-MX', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    )}
                    <div className="guantes-spec-row">
                      <span className="muted">Estado:</span>
                      <span className="guante-badge guante-badge-rented">En uso · Rentado</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Card 2: Especificación de los guantes */}
              <div className="guantes-bento-card">
                <h3>Especificación de los guantes</h3>
                <div className="guantes-spec-list">
                  <div className="guantes-spec-row">
                    <span className="muted">Código:</span>
                    <strong>{selectedGlove.code}</strong>
                  </div>
                  <div className="guantes-spec-row">
                    <span className="muted">Color:</span>
                    <strong>{selectedGlove.color}</strong>
                  </div>
                  <div className="guantes-spec-row">
                    <span className="muted">Onzas:</span>
                    <strong>{selectedGlove.ounces} oz</strong>
                  </div>
                  <div className="guantes-spec-row">
                    <span className="muted">Estado:</span>
                    <strong>{selectedGlove.status === 'available' ? 'Disponible' : 'En uso'}</strong>
                  </div>
                  <div className="guantes-spec-row">
                    <span className="muted">Tarifa:</span>
                    <strong>{formatMoney(selectedGlove.priceMinor)} MXN</strong>
                  </div>
                </div>
              </div>

              {/* Card 3: Cobro y entrega / Devolución */}
              <div className="guantes-bento-card">
                <h3>{selectedGlove.status === 'available' ? 'Cobro y entrega' : 'Devolución'}</h3>

                {selectedGlove.status === 'available' ? (
                  <>
                    <div className="cart-payment-methods-box" style={{ margin: '0 0 10px' }}>
                      <span className="field-label" id="guantes-payment-method-label">
                        Método de cobro
                      </span>
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
                          ariaLabel="Método de cobro"
                        />
                      </div>
                    </div>

                    {method === 'cash' && (
                      <div className="cash-tender-card" style={{ margin: '0 0 10px' }}>
                        <div className="field">
                          <label htmlFor="guantes-cash-tendered-input">Monto recibido</label>
                          <div className="cash-tender-input-row">
                            <input
                              id="guantes-cash-tendered-input"
                              type="text"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={tenderedAmount}
                              onChange={e => setTenderedAmount(e.target.value)}
                            />
                            <Button
                              variant="secondary"
                              className="button-sm"
                              onClick={() => {
                                setTenderedAmount((selectedGlove.priceMinor / 100).toFixed(2));
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

                    <Button
                      variant="primary"
                      disabled={!assignedMemberId || (method === 'cash' && changeMinor !== null && changeMinor < 0)}
                      onClick={handleConfirmRental}
                    >
                      Confirmar cobro y entregar
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="guantes-payment-summary">
                      <span className="guantes-summary-label">Resumen de cobro:</span>
                      <strong>
                        {selectedGlove.paymentStatus === 'pending'
                          ? `Transferencia pendiente · ${formatMoney(selectedGlove.priceMinor)} MXN`
                          : `Pagado: ${
                              selectedGlove.paymentMethod === 'card'
                                ? 'Tarjeta'
                                : selectedGlove.paymentMethod === 'transfer'
                                ? 'Transferencia'
                                : 'Efectivo'
                            } · ${formatMoney(selectedGlove.priceMinor)} MXN`}
                      </strong>
                    </div>

                    <Button
                      variant="primary"
                      onClick={handleReturnGlove}
                    >
                      Marcar como devuelto
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
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
