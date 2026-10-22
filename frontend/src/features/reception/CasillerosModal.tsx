import React, { useEffect, useRef, useState } from 'react';
import type { LockerItem, LockerStatus, PaymentMethod } from '../../domain/models';
import type { GimiAlert } from '../../domain/gimi';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { memberStatus } from '../../demo/memberStatus';
import { assignLocker, calculateNextMonthExpiry, releaseLocker, renewLocker } from '../../demo/lockerOperations';
import { getStoredAlerts, saveStoredAlerts } from '../gimi/gimiStore';
import { Button, Notice } from '../../shared/ui';
import AnimatedList from '../catalog/react-bits/AnimatedList';
import SwipeToast from '../catalog/react-bits/SwipeToast';
import { CurrentPurchaseCard, type CheckoutPaymentBreakdown } from './CurrentPurchaseCard';

export interface CasillerosModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export type EffectiveLockerStatus = 'available' | 'assigned' | 'expired' | 'evict' | 'employee' | 'out_of_service';

export function getLockerEffectiveStatus(locker: LockerItem, nowIso: string) {
  if (locker.status === 'out_of_service') {
    return { status: 'out_of_service' as const, label: 'Fuera de servicio', badgeClass: 'casillero-badge-service' };
  }
  if (locker.status === 'employee') {
    return { status: 'employee' as const, label: 'Empleado', badgeClass: 'casillero-badge-employee' };
  }
  if (locker.status === 'evicted') {
    return { status: 'evict' as const, label: 'Desalojar', badgeClass: 'casillero-badge-evicted' };
  }
  if (locker.status === 'available' || (!locker.assignedMemberId && !locker.expiresAt)) {
    return { status: 'available' as const, label: 'Disponible', badgeClass: 'casillero-badge-available' };
  }

  // Active assignment: calculate 1 month and overdue
  const nowMs = new Date(nowIso).getTime();
  const expiryMs = locker.expiresAt ? new Date(locker.expiresAt).getTime() : nowMs;

  if (nowMs <= expiryMs) {
    return { status: 'assigned' as const, label: 'Ocupado', badgeClass: 'casillero-badge-assigned' };
  }

  const overdueDays = Math.max(1, Math.floor((nowMs - expiryMs) / (1000 * 60 * 60 * 24)));
  if (overdueDays <= 14) {
    return {
      status: 'expired' as const,
      label: 'Vencido',
      badgeClass: 'casillero-badge-expired',
      overdueDays,
    };
  }

  return {
    status: 'evict' as const,
    label: 'Desalojar',
    badgeClass: 'casillero-badge-evicted',
    overdueDays,
  };
}

export function CasillerosModal({ isOpen, onClose }: CasillerosModalProps) {
  const { state, transact } = useDemo();
  const lockers = state.lockers ?? [];

  const [selectedLockerId, setSelectedLockerId] = useState<string>('locker-01');
  const [assignedMemberId, setAssignedMemberId] = useState<string | null>(null);

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

  function handleConfirmAssignment(breakdown?: CheckoutPaymentBreakdown, forcePending?: boolean) {
    if (!selectedLocker || !assignedMemberId) return;
    const paymentMethodToUse: PaymentMethod = breakdown
      ? (breakdown.mode === 'mixed' ? (breakdown.mixedMethod1 ?? 'cash') : breakdown.method)
      : 'cash';
    const shortfall = breakdown?.shortfallMinor ?? 0;

    const rentalId = `locker-rental-${crypto.randomUUID()}`;
    const result = transact(current => {
      const assignTx = assignLocker(current, {
        id: rentalId,
        lockerId: selectedLocker.id,
        memberId: assignedMemberId,
        method: paymentMethodToUse,
      });
      if (assignTx.result.status === 'error') return assignTx;
      if (shortfall > 0 && forcePending) {
        return {
          ...assignTx,
          state: {
            ...assignTx.state,
            members: assignTx.state.members.map(m =>
              m.id === assignedMemberId ? { ...m, creditMinor: m.creditMinor - shortfall } : m
            ),
          },
        };
      }
      return assignTx;
    });

    if (result.status === 'paid' || result.status === 'pending') {
      const memberName = assignedMember?.name ?? 'socio';
      const msg = `Casillero ${selectedLocker.code} asignado a ${memberName}.`;
      setAssignedMemberId(null);
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

  function handleCancelLocker() {
    if (!selectedLocker) return;
    const code = selectedLocker.code;
    const memberName = selectedLocker.assignedMemberName || rentedMember?.name || 'Socio';

    const result = transact(current => releaseLocker(current, selectedLocker.id));

    if (result.status === 'released') {
      const adminAlert: GimiAlert = {
        id: `alert-cancel-locker-${Date.now()}`,
        conversationId: 'casilleros',
        clientName: memberName,
        channel: 'web',
        type: 'churn_risk',
        severity: 'medium',
        message: `Cancelación anticipada: Casillero ${code} liberado de ${memberName}. Casillero reactivado como disponible.`,
        timestamp: state.demoClock || new Date().toISOString(),
        status: 'pending',
      };
      saveStoredAlerts([adminAlert, ...getStoredAlerts()]);

      setToast({
        open: true,
        title: 'Casillero cancelado y liberado',
        description: `Casillero ${code} ahora está disponible. Se notificó la cancelación a administración.`,
        type: 'warning',
      });
    } else if (result.status === 'error') {
      setToast({
        open: true,
        title: 'Error al cancelar',
        description: result.message,
        type: 'error',
      });
    }
  }

  function handleRenewLocker() {
    if (!selectedLocker) return;
    const code = selectedLocker.code;
    const result = transact(current => renewLocker(current, selectedLocker.id));

    if (result.status === 'updated') {
      const newExpiry = result.locker.expiresAt
        ? new Date(result.locker.expiresAt).toLocaleDateString('es-MX', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : '1 mes';
      setToast({
        open: true,
        title: 'Mensualidad renovada',
        description: `Casillero ${code} extendido por 1 mes (vigente hasta: ${newExpiry}).`,
        type: 'success',
      });
    } else if (result.status === 'error') {
      setToast({
        open: true,
        title: 'Error al renovar',
        description: result.message,
        type: 'error',
      });
    }
  }

  function handleEvictAndReleaseLocker() {
    if (!selectedLocker) return;
    const code = selectedLocker.code;
    const result = transact(current => releaseLocker(current, selectedLocker.id));

    if (result.status === 'released') {
      setToast({
        open: true,
        title: 'Casillero desalojado',
        description: `Casillero ${code} desalojado con éxito y puesto como disponible.`,
        type: 'success',
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
              const eff = getLockerEffectiveStatus(locker, state.demoClock);

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
                    <span className={`casillero-badge ${eff.badgeClass}`}>
                      {eff.label}
                    </span>
                  </div>
                  <strong className="casillero-card-number">{locker.code}</strong>
                  <span className="casillero-card-client">
                    {eff.status === 'available'
                      ? 'Disponible'
                      : eff.status === 'assigned'
                      ? locker.assignedMemberName || 'Ocupado'
                      : eff.status === 'expired'
                      ? `${locker.assignedMemberName || 'Socio'} (Vencido)`
                      : eff.status === 'evict'
                      ? `${locker.assignedMemberName ? `${locker.assignedMemberName} (Desalojar)` : 'Desalojar'}`
                      : locker.assignedMemberName || eff.label}
                  </span>
                  <span className="casillero-card-price">
                    {locker.expiresAt && (eff.status === 'assigned' || eff.status === 'expired')
                      ? `Vence: ${new Date(locker.expiresAt).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}`
                      : eff.status === 'evict'
                      ? 'Desalojo requerido'
                      : `${formatMoney(locker.monthlyPriceMinor)}/mes`}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right Sidebar: Dynamic Status & Management */}
          {selectedLocker && (() => {
            const effSelected = getLockerEffectiveStatus(selectedLocker, state.demoClock);

            return (
              <div className="guantes-sidebar-column">
                {effSelected.status === 'available' ? (
                  <CurrentPurchaseCard
                    className="current-purchase-card--modal"
                    title={`Casillero ${selectedLocker.code}`}
                    totalMinor={selectedLocker.monthlyPriceMinor}
                    step1Title="Casillero"
                    step2Title="Cobro"
                    confirmActionLabel="Confirmar cobro y asignar"
                    step1ActionLabel={`Proceder al cobro · ${formatMoney(selectedLocker.monthlyPriceMinor)} MXN →`}
                    step1ActionDisabled={!assignedMemberId}
                    assignedMember={assignedMember ? { id: assignedMember.id, name: assignedMember.name, phone: assignedMember.phone } : null}
                    onAssignMemberClick={() => setIsSearchOpen(true)}
                    onConfirmPayment={handleConfirmAssignment}
                  >
                    {/* Step 1: Member Assignment */}
                    <div className="modal-cart-section">
                      <h3 className="modal-cart-section-title">Asignar a cliente</h3>
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
                    </div>

                    {/* Step 1: Costo y vigencia (1 mes) */}
                    <div className="modal-cart-section" style={{ marginTop: '8px' }}>
                      <h3 className="modal-cart-section-title">Costo y vigencia (1 mes)</h3>
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
                  </CurrentPurchaseCard>
                ) : (
                  <>
                    <div className="guantes-bento-card">
                      <h3>{effSelected.status === 'evict' ? 'Casillero por desalojar' : 'Cliente asignado'}</h3>
                      <div className="guantes-assigned-details">
                        <div className="guantes-spec-row">
                          <span className="muted">Estado:</span>
                          <span className={`casillero-badge ${effSelected.badgeClass}`}>
                            {effSelected.label}
                          </span>
                        </div>
                        <div className="guantes-spec-row">
                          <span className="muted">{effSelected.status === 'evict' ? 'Último socio:' : 'Asignado a:'}</span>
                          <strong>{selectedLocker.assignedMemberName || rentedMember?.name || 'Staff EvoGym'}</strong>
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
                    </div>

                    <div className="guantes-bento-card">
                      <h3>Vigencia y estado</h3>
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
                          <span className="muted">Vencimiento:</span>
                          <strong>
                            {selectedLocker.expiresAt
                              ? new Date(selectedLocker.expiresAt).toLocaleDateString('es-MX', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                })
                              : 'Vencimiento no programado'}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div className="guantes-bento-card">
                      <h3>Acciones de casillero</h3>
                      <div className="casillero-action-buttons">
                        {effSelected.status === 'assigned' && (
                          <>
                            <div className="guantes-payment-summary" style={{ marginBottom: '10px' }}>
                              <span className="guantes-summary-label">Estado de suscripción:</span>
                              <strong>
                                {selectedLocker.paymentStatus === 'pending'
                                  ? 'Transferencia pendiente'
                                  : `Ocupado · Pagado (${selectedLocker.paymentMethod === 'card' ? 'Tarjeta' : selectedLocker.paymentMethod === 'transfer' ? 'Transferencia' : 'Efectivo'})`}
                              </strong>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <Button variant="secondary" onClick={handleRenewLocker}>
                                Renovar mensualidad (+1 mes)
                              </Button>
                              <Button variant="secondary" onClick={handleCancelLocker}>
                                Cancelar asignación (Liberar)
                              </Button>
                            </div>
                          </>
                        )}

                        {effSelected.status === 'expired' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <Notice tone="warning">
                              Suscripción vencida hace {effSelected.overdueDays} día(s). En período de gracia (hasta 14 días para renovar antes de desalojo).
                            </Notice>
                            <Button onClick={handleRenewLocker}>
                              Renovar casillero (+1 mes)
                            </Button>
                            <Button variant="secondary" onClick={handleEvictAndReleaseLocker}>
                              Desalojar casillero
                            </Button>
                          </div>
                        )}

                        {effSelected.status === 'evict' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <Notice tone="error">
                              Casillero con más de 2 semanas vencido sin renovar ({effSelected.overdueDays ?? 15} días de atraso). Requiere desalojo inmediato para liberar el espacio.
                            </Notice>
                            <Button onClick={handleEvictAndReleaseLocker}>
                              Desalojar casillero
                            </Button>
                          </div>
                        )}

                        {(effSelected.status === 'employee' || effSelected.status === 'out_of_service') && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <Button variant="secondary" onClick={handleReleaseLocker}>
                              Liberar casillero
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
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
