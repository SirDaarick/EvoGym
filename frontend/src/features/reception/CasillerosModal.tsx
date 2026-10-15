import React, { useEffect, useRef, useState } from 'react';
import type { LockerItem, LockerStatus, PaymentMethod } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { memberStatus } from '../../demo/memberStatus';
import { assignLocker, calculateNextMonthExpiry, evictLocker, releaseLocker, updateLockerStatus } from '../../demo/lockerOperations';
import { Button, Notice } from '../../shared/ui';
import AnimatedList from '../catalog/react-bits/AnimatedList';
import JellyRadio from '../catalog/react-bits/JellyRadio';
import SwipeToast from '../catalog/react-bits/SwipeToast';

export interface CasillerosModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const statusLabels: Record<LockerStatus, string> = {
  available: 'Disponible',
  assigned: 'Vendido',
  employee: 'Empleado',
  evicted: 'Desalojado',
  out_of_service: 'Fuera de servicio',
};

const statusBadgeClasses: Record<LockerStatus, string> = {
  available: 'casillero-badge-available',
  assigned: 'casillero-badge-assigned',
  employee: 'casillero-badge-employee',
  evicted: 'casillero-badge-evicted',
  out_of_service: 'casillero-badge-service',
};

export function CasillerosModal({ isOpen, onClose }: CasillerosModalProps) {
  const { state, transact } = useDemo();
  const lockers = state.lockers ?? [];

  const [selectedLockerId, setSelectedLockerId] = useState<string>('locker-01');
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
      setSelectedLockerId('locker-01');
      setAssignedMemberId(null);
      setTenderedAmount('');
      setToast(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedLocker: LockerItem | undefined =
    lockers.find(l => l.id === selectedLockerId) ?? lockers[0];

  const assignedMember = assignedMemberId
    ? state.members.find(m => m.id === assignedMemberId) ?? null
    : null;

  const rentedMember = selectedLocker?.assignedMemberId
    ? state.members.find(m => m.id === selectedLocker.assignedMemberId) ?? null
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
    tenderedMinor !== null && selectedLocker
      ? tenderedMinor - selectedLocker.monthlyPriceMinor
      : null;

  function handleConfirmAssignment() {
    if (!selectedLocker || !assignedMemberId) return;
    const rentalId = `locker-rental-${crypto.randomUUID()}`;
    const result = transact(current =>
      assignLocker(current, {
        id: rentalId,
        lockerId: selectedLocker.id,
        memberId: assignedMemberId,
        method,
      })
    );

    if (result.status === 'paid' || result.status === 'pending') {
      const memberName = assignedMember?.name ?? 'socio';
      const msg = `Casillero ${selectedLocker.code} asignado a ${memberName}.`;
      setAssignedMemberId(null);
      setTenderedAmount('');
      setToast({
        open: true,
        title: 'Casillero asignado',
        description: msg,
        type: 'success',
      });
    } else if (result.status === 'error') {
      setToast({
        open: true,
        title: 'Error de asignación',
        description: result.message,
        type: 'error',
      });
    }
  }

  function handleReleaseLocker() {
    if (!selectedLocker) return;
    const code = selectedLocker.code;
    const result = transact(current => releaseLocker(current, selectedLocker.id));

    if (result.status === 'released') {
      setToast({
        open: true,
        title: 'Casillero liberado',
        description: `Casillero ${code} disponible para asignación.`,
        type: 'success',
      });
    } else if (result.status === 'error') {
      setToast({
        open: true,
        title: 'Error al liberar',
        description: result.message,
        type: 'error',
      });
    }
  }

  function handleEvictLocker() {
    if (!selectedLocker) return;
    const code = selectedLocker.code;
    const result = transact(current => evictLocker(current, selectedLocker.id));

    if (result.status === 'evicted') {
      setToast({
        open: true,
        title: 'Casillero desalojado',
        description: `Casillero ${code} marcado como desalojado.`,
        type: 'warning',
      });
    } else if (result.status === 'error') {
      setToast({
        open: true,
        title: 'Error al desalojar',
        description: result.message,
        type: 'error',
      });
    }
  }

  function handleStatusChange(newStatus: LockerStatus) {
    if (!selectedLocker) return;
    const code = selectedLocker.code;
    const result = transact(current => updateLockerStatus(current, selectedLocker.id, newStatus));

    if (result.status === 'updated') {
      setToast({
        open: true,
        title: 'Estado actualizado',
        description: `Casillero ${code} cambiado a "${statusLabels[newStatus]}".`,
        type: 'success',
      });
    }
  }

  const projectedExpiry = calculateNextMonthExpiry(new Date());

  return (
    <div
      className="staff-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="casilleros-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="staff-modal-card casilleros-modal-card">
        {/* Header */}
        <div className="guantes-modal-header">
          <div className="guantes-modal-title-group">
            <h2 id="casilleros-modal-title">Casilleros</h2>
            <p className="muted">Control y asignación de los 42 casilleros mensuales del gimnasio</p>
          </div>
          <button
            type="button"
            className="guantes-close-btn"
            aria-label="Cerrar modal de casilleros"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Modal Main Body */}
        <div className="guantes-modal-body">
          {/* Left Grid: 42 Locker Cards */}
          <div className="casilleros-grid-container" role="group" aria-label="Casilleros del gimnasio">
            {lockers.map(locker => {
              const isSelected = selectedLocker?.id === locker.id;

              return (
                <button
                  key={locker.id}
                  type="button"
                  className={`casillero-card ${isSelected ? 'selected' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedLockerId(locker.id);
                  }}
                >
                  <div className="casillero-card-top">
                    <span className={`casillero-badge ${statusBadgeClasses[locker.status]}`}>
                      {statusLabels[locker.status]}
                    </span>
                  </div>
                  <strong className="casillero-card-number">{locker.code}</strong>
                  <span className="casillero-card-client">
                    {locker.status === 'available'
                      ? 'Disponible'
                      : locker.assignedMemberName || statusLabels[locker.status]}
                  </span>
                  <span className="casillero-card-price">
                    {locker.status === 'assigned' && locker.expiresAt
                      ? `Vence: ${new Date(locker.expiresAt).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}`
                      : `${formatMoney(locker.monthlyPriceMinor)}/mes`}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right Sidebar: 4 Bento Cards */}
          {selectedLocker && (
            <div className="guantes-sidebar-column">
              {/* Card 1: Asignar status */}
              <div className="guantes-bento-card">
                <h3>Asignar status</h3>
                <div className="casillero-status-pills">
                  {(['available', 'assigned', 'employee', 'evicted', 'out_of_service'] as LockerStatus[]).map(st => (
                    <button
                      key={st}
                      type="button"
                      className={`casillero-status-btn ${selectedLocker.status === st ? 'active' : ''}`}
                      onClick={() => handleStatusChange(st)}
                    >
                      {statusLabels[st]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Card 2: Asignar a cliente o cliente asignado */}
              <div className="guantes-bento-card">
                <h3>{selectedLocker.status === 'available' ? 'Asignar a cliente' : 'Cliente asignado'}</h3>

                {selectedLocker.status === 'available' ? (
                  <>
                    {!assignedMember ? (
                      <div className="cart-member-search" ref={memberSearchContainerRef}>
                        <div className="field">
                          <label htmlFor="casilleros-assign-member-input">Buscar socio activo</label>
                          <div className="cart-member-search-input-wrap">
                            <input
                              ref={memberInputRef}
                              id="casilleros-assign-member-input"
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

                        {isSearchOpen && (
                          <div className="cart-member-dropdown" onMouseDown={e => e.preventDefault()}>
                            {flatActiveMembers.length > 0 ? (
                              <AnimatedList
                                id="casillero-member-item"
                                listboxId="casillero-member-results"
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
                                maxHeight={200}
                              />
                            ) : (
                              <p className="cart-no-members-msg" role="status">
                                No hay socios activos coincidentes.
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
                          {assignedMember.phone && <span className="muted">Tel: {assignedMember.phone}</span>}
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
                      <span className="muted">Asignado a:</span>
                      <strong>{selectedLocker.assignedMemberName || rentedMember?.name || 'Sin asignar'}</strong>
                    </div>
                    {rentedMember?.phone && (
                      <div className="guantes-spec-row">
                        <span className="muted">Teléfono:</span>
                        <span>{rentedMember.phone}</span>
                      </div>
                    )}
                    {selectedLocker.assignedAt && (
                      <div className="guantes-spec-row">
                        <span className="muted">Asignado el:</span>
                        <span>{new Date(selectedLocker.assignedAt).toLocaleDateString('es-MX')}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Card 3: Costo o vencimiento del pago (1 mes) */}
              <div className="guantes-bento-card">
                <h3>Costo y vigencia (1 mes)</h3>
                <div className="guantes-spec-list">
                  <div className="guantes-spec-row">
                    <span className="muted">Casillero:</span>
                    <strong>{selectedLocker.code}</strong>
                  </div>
                  <div className="guantes-spec-row">
                    <span className="muted">Tarifa mensual:</span>
                    <strong>{formatMoney(selectedLocker.monthlyPriceMinor)} MXN</strong>
                  </div>
                  <div className="guantes-spec-row">
                    <span className="muted">Periodo:</span>
                    <span>1 mes calendario</span>
                  </div>
                  <div className="guantes-spec-row">
                    <span className="muted">Vencimiento:</span>
                    <strong>
                      {selectedLocker.expiresAt
                        ? new Date(selectedLocker.expiresAt).toLocaleDateString('es-MX', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })
                        : new Date(projectedExpiry).toLocaleDateString('es-MX', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Card 4: Pagado, liberado, desalojado o desasignar */}
              <div className="guantes-bento-card">
                <h3>{selectedLocker.status === 'available' ? 'Cobro y asignación' : 'Acciones de casillero'}</h3>

                {selectedLocker.status === 'available' ? (
                  <>
                    <div className="cart-payment-methods-box" style={{ margin: '0 0 10px' }}>
                      <span className="field-label">Método de cobro</span>
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
                          <label htmlFor="casillero-cash-tendered-input">Monto recibido</label>
                          <div className="cash-tender-input-row">
                            <input
                              id="casillero-cash-tendered-input"
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
                                setTenderedAmount((selectedLocker.monthlyPriceMinor / 100).toFixed(2));
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
                      onClick={handleConfirmAssignment}
                    >
                      Confirmar cobro y asignar
                    </Button>
                  </>
                ) : (
                  <div className="casillero-action-buttons">
                    {selectedLocker.status === 'assigned' && (
                      <div className="guantes-payment-summary" style={{ marginBottom: '10px' }}>
                        <span className="guantes-summary-label">Estado de renta:</span>
                        <strong>
                          {selectedLocker.paymentStatus === 'pending'
                            ? 'Transferencia pendiente'
                            : `Pagado (${selectedLocker.paymentMethod === 'card' ? 'Tarjeta' : selectedLocker.paymentMethod === 'transfer' ? 'Transferencia' : 'Efectivo'})`}
                        </strong>
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <Button variant="secondary" onClick={handleReleaseLocker}>
                        Liberar casillero
                      </Button>
                      {selectedLocker.status === 'assigned' && (
                        <Button variant="secondary" onClick={handleEvictLocker}>
                          Desalojar casillero
                        </Button>
                      )}
                    </div>
                  </div>
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
