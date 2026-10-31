import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GloveItem, PaymentMethod } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney } from '../../demo/adapter';
import { memberStatus } from '../../demo/memberStatus';
import { rentGlove as demoRentGlove, returnGlove as demoReturnGlove } from '../../demo/gloveOperations';
import { Button, Notice } from '../../shared/ui';
import AnimatedList from '../catalog/react-bits/AnimatedList';
import SwipeToast from '../catalog/react-bits/SwipeToast';
import { CurrentPurchaseCard, type CheckoutPaymentBreakdown } from './CurrentPurchaseCard';
import type { AuthenticatedRequest } from '../../api/inventoryApi';
import {
  listRentalAssets,
  listRentals,
  rentGlove as apiRentGlove,
  returnGlove as apiReturnGlove,
  createRentalAsset,
  updateRentalAsset,
  type RentalAssetDTO,
  type RentalDTO,
  type TenderComponentInput,
} from '../../api/rentalsApi';

export interface GuantesModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiRequest?: AuthenticatedRequest;
  registerId?: string;
  branchId?: string;
  isAdmin?: boolean;
}

function useOptionalDemo() {
  try {
    return useDemo();
  } catch {
    return null;
  }
}

interface MemberSearchResult {
  id: string;
  full_name: string;
  phone: string;
}

export function GuantesModal({
  isOpen,
  onClose,
  apiRequest,
  registerId,
  branchId,
  isAdmin = false,
}: GuantesModalProps) {
  const isLive = Boolean(apiRequest && branchId);
  const demo = useOptionalDemo();

  // Live state
  const [liveAssets, setLiveAssets] = useState<RentalAssetDTO[]>([]);
  const [liveRentals, setLiveRentals] = useState<RentalDTO[]>([]);
  const [liveMembers, setLiveMembers] = useState<MemberSearchResult[]>([]);
  const [selectedLiveMember, setSelectedLiveMember] = useState<{ id: string; name: string; phone?: string } | null>(null);

  // Admin controls state
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newColor, setNewColor] = useState('Rojo');
  const [newOunces, setNewOunces] = useState(12);
  const [newPricePesos, setNewPricePesos] = useState('25');
  const [editingPricePesos, setEditingPricePesos] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);

  const [selectedGloveId, setSelectedGloveId] = useState<string>('glove-01');
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

  // Theme observer for JellyRadio & AnimatedList light/dark mode adaptation
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    const currentTheme = document.documentElement.dataset.theme;
    return currentTheme ? currentTheme === 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  });

  const refreshLive = useCallback(async () => {
    if (!apiRequest || !branchId) return;
    try {
      const [assetsPage, rentalsPage] = await Promise.all([
        listRentalAssets(apiRequest, branchId, 'glove', 0, 100),
        listRentals(apiRequest, branchId, { status: 'active', kind: 'glove' }),
      ]);
      setLiveAssets(assetsPage.items);
      setLiveRentals(rentalsPage.items);
      if (assetsPage.items.length > 0) {
        setSelectedGloveId(current => {
          if (assetsPage.items.some(a => a.id === current)) return current;
          return assetsPage.items[0].id;
        });
      }
    } catch {
      // In live mode, error handling retained
    }
  }, [apiRequest, branchId]);

  useEffect(() => {
    if (isOpen && isLive) {
      void refreshLive();
    }
  }, [isOpen, isLive, refreshLive]);

  // Live member search
  useEffect(() => {
    if (!isOpen || !isLive || !apiRequest) return;
    const q = memberQuery.trim();
    if (q.length < 2) {
      setLiveMembers([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ page: '1', limit: '20', search: q });
        const res = await apiRequest(`/api/v1/members?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as { items?: MemberSearchResult[] };
        if (active && Array.isArray(data.items)) {
          setLiveMembers(data.items);
        }
      } catch {
        if (active) setLiveMembers([]);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isOpen, isLive, apiRequest, memberQuery]);

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
      setAssignedMemberId(null);
      setSelectedLiveMember(null);
      setToast(null);
      setIsAdminMode(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Build unified gloves array
  const gloves: GloveItem[] = isLive
    ? liveAssets.map(asset => {
        const activeRental = liveRentals.find(r => r.asset_id === asset.id && r.status === 'active');
        return {
          id: asset.id,
          code: asset.code,
          color: asset.color || 'Negro',
          ounces: asset.ounces || 12,
          priceMinor: asset.price_minor,
          status: activeRental ? 'rented' : 'available',
          assignedMemberId: activeRental?.member_id ?? null,
          assignedMemberName: activeRental?.member_name ?? null,
          assignedAt: activeRental?.created_at ?? null,
          rentalId: activeRental?.id ?? null,
          paymentStatus: activeRental && activeRental.outstanding_minor > 0 ? 'pending' : 'paid',
          paymentMethod: 'cash',
        };
      })
    : (demo?.state.gloves ?? []);

  const selectedGlove: GloveItem | undefined =
    gloves.find(g => g.id === selectedGloveId) ?? gloves[0];

  const assignedMember = isLive
    ? selectedLiveMember
    : assignedMemberId && demo
    ? demo.state.members.find(m => m.id === assignedMemberId) ?? null
    : null;

  const rentedMember = !isLive && selectedGlove?.assignedMemberId && demo
    ? demo.state.members.find(m => m.id === selectedGlove.assignedMemberId) ?? null
    : null;

  // Demo active members filter
  const demoActiveMembers = (!isLive && demo)
    ? demo.state.members.filter(m => memberStatus(m, demo.state.demoClock).status === 'active')
    : [];

  const hasOpenAttendance = (memberId: string) =>
    demo?.state.attendance.some(a => a.memberId === memberId && !a.observedCheckOut && !a.autoClosedAt) ?? false;

  const hasAnyAttendance = (memberId: string) =>
    demo?.state.attendance.some(a => a.memberId === memberId) ?? false;

  const q = memberQuery.trim().toLowerCase();
  const matchingMembers = demoActiveMembers.filter(m => {
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

  const flatActiveMembers = isLive
    ? liveMembers.map(m => ({ id: m.id, name: m.full_name, phone: m.phone }))
    : [...withAttendance, ...withoutAttendance];

  const memberGroups = isLive
    ? (liveMembers.length > 0
        ? [
            {
              label: 'Socios encontrados',
              items: liveMembers.map(m => ({
                id: m.id,
                title: m.full_name,
                description: 'Socio del gimnasio',
                meta: m.phone || undefined,
                member: { id: m.id, name: m.full_name, phone: m.phone },
              })),
            },
          ]
        : [])
    : [
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

  function handleAssignMember(memberId: string, memberObj?: { id: string; name: string; phone?: string }) {
    setAssignedMemberId(memberId);
    if (isLive && memberObj) {
      setSelectedLiveMember(memberObj);
    }
    setIsSearchOpen(false);
    setMemberQuery('');
    setSelectedMemberIndex(-1);
  }

  async function handleConfirmRental(breakdown?: CheckoutPaymentBreakdown, forcePending?: boolean) {
    if (!selectedGlove || !assignedMemberId) return;

    if (isLive) {
      if (!apiRequest || !branchId || !registerId) {
        setToast({
          open: true,
          title: 'Caja no seleccionada',
          description: 'Se requiere una caja con turno abierto para registrar la renta.',
          type: 'error',
        });
        return;
      }
      const components: TenderComponentInput[] = [];
      if (breakdown) {
        if (breakdown.mode === 'single') {
          const amount = selectedGlove.priceMinor - (breakdown.shortfallMinor ?? 0);
          if (amount > 0) {
            components.push({ method: breakdown.method as any, amount_minor: amount });
          }
        } else {
          if ((breakdown.mixedAmount1Minor ?? 0) > 0 && breakdown.mixedMethod1) {
            components.push({ method: breakdown.mixedMethod1 as any, amount_minor: breakdown.mixedAmount1Minor! });
          }
          if ((breakdown.mixedAmount2Minor ?? 0) > 0 && breakdown.mixedMethod2) {
            components.push({ method: breakdown.mixedMethod2 as any, amount_minor: breakdown.mixedAmount2Minor! });
          }
        }
      } else {
        components.push({ method: 'cash', amount_minor: selectedGlove.priceMinor });
      }

      const shortfall = breakdown?.shortfallMinor ?? 0;
      try {
        await apiRentGlove(
          apiRequest,
          {
            branch_id: branchId,
            asset_id: selectedGlove.id,
            member_id: assignedMemberId,
            register_id: registerId,
            components,
            expected_total_minor: selectedGlove.priceMinor,
            accepted_shortfall_minor: shortfall,
          },
          crypto.randomUUID()
        );
        await refreshLive();
        const memberName = assignedMember?.name ?? 'socio';
        setAssignedMemberId(null);
        setSelectedLiveMember(null);
        setToast({
          open: true,
          title: 'Renta confirmada',
          description: `Guantes ${selectedGlove.code} rentados exitosamente a ${memberName}.`,
          type: 'success',
        });
      } catch (err: any) {
        setToast({
          open: true,
          title: 'Error de renta',
          description: err.message || 'No se pudo registrar la renta.',
          type: 'error',
        });
      }
      return;
    }

    // Demo transaction
    if (!demo) return;
    const paymentMethodToUse: PaymentMethod = breakdown
      ? (breakdown.mode === 'mixed' ? (breakdown.mixedMethod1 ?? 'cash') : breakdown.method)
      : 'cash';
    const shortfall = breakdown?.shortfallMinor ?? 0;

    const rentalId = `rental-${crypto.randomUUID()}`;
    const result = demo.transact(current => {
      const rentalTx = demoRentGlove(current, {
        id: rentalId,
        gloveId: selectedGlove.id,
        memberId: assignedMemberId,
        method: paymentMethodToUse,
      });
      if (rentalTx.result.status === 'error') return rentalTx;
      if (shortfall > 0 && forcePending) {
        return {
          ...rentalTx,
          state: {
            ...rentalTx.state,
            members: rentalTx.state.members.map(m =>
              m.id === assignedMemberId ? { ...m, creditMinor: m.creditMinor - shortfall } : m
            ),
          },
        };
      }
      return rentalTx;
    });

    if (result.status === 'paid' || result.status === 'pending') {
      const memberName = assignedMember?.name ?? 'socio';
      const success = `Guantes ${selectedGlove.code} rentados exitosamente a ${memberName}.`;
      setAssignedMemberId(null);
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

  async function handleReturnGlove() {
    if (!selectedGlove) return;
    const gloveCode = selectedGlove.code;

    if (isLive) {
      if (!apiRequest || !selectedGlove.rentalId) return;
      try {
        await apiReturnGlove(apiRequest, selectedGlove.rentalId, crypto.randomUUID());
        await refreshLive();
        setToast({
          open: true,
          title: 'Guantes devueltos',
          description: `Guantes ${gloveCode} devueltos y ahora disponibles para renta.`,
          type: 'success',
        });
      } catch (err: any) {
        setToast({
          open: true,
          title: 'Error al devolver',
          description: err.message || 'No se pudo procesar la devolución.',
          type: 'error',
        });
      }
      return;
    }

    if (!demo) return;
    const result = demo.transact(current => demoReturnGlove(current, selectedGlove.id));

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

  // Admin asset management handlers
  async function handleCreateAsset(e: React.FormEvent) {
    e.preventDefault();
    if (!apiRequest || !branchId || !newCode.trim()) return;
    setAdminSaving(true);
    try {
      const priceMinor = Math.round(parseFloat(newPricePesos || '0') * 100);
      await createRentalAsset(apiRequest, {
        branch_id: branchId,
        kind: 'glove',
        code: newCode.trim(),
        color: newColor.trim() || 'Negro',
        ounces: Number(newOunces) || 12,
        price_minor: priceMinor,
      });
      await refreshLive();
      setNewCode('');
      setToast({
        open: true,
        title: 'Guante registrado',
        description: `Se agregó el par de guantes ${newCode.trim()} al inventario.`,
        type: 'success',
      });
    } catch (err: any) {
      setToast({
        open: true,
        title: 'Error al crear',
        description: err.message || 'No se pudo crear el activo.',
        type: 'error',
      });
    } finally {
      setAdminSaving(false);
    }
  }

  async function handleUpdatePrice() {
    if (!apiRequest || !selectedGlove) return;
    const priceMinor = Math.round(parseFloat(editingPricePesos || '0') * 100);
    if (priceMinor <= 0) return;
    setAdminSaving(true);
    try {
      await updateRentalAsset(apiRequest, selectedGlove.id, { price_minor: priceMinor });
      await refreshLive();
      setEditingPricePesos('');
      setToast({
        open: true,
        title: 'Tarifa actualizada',
        description: `La tarifa de ${selectedGlove.code} se actualizó a $${(priceMinor / 100).toFixed(2)} MXN.`,
        type: 'success',
      });
    } catch (err: any) {
      setToast({
        open: true,
        title: 'Error al actualizar',
        description: err.message || 'No se pudo actualizar la tarifa.',
        type: 'error',
      });
    } finally {
      setAdminSaving(false);
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isAdmin && isLive && (
              <Button
                variant="secondary"
                className="button-sm"
                onClick={() => setIsAdminMode(prev => !prev)}
              >
                {isAdminMode ? 'Volver a renta' : '⚙️ Gestionar activos'}
              </Button>
            )}
            <button
              type="button"
              className="guantes-close-btn"
              aria-label="Cerrar modal de guantes"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Main Body */}
        <div className="guantes-modal-body">
          {/* Left Grid: Glove Cards */}
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

          {/* Right Sidebar */}
          {selectedGlove && (
            <div className="guantes-sidebar-column">
              {isAdminMode && isLive ? (
                /* Admin Panel */
                <div className="guantes-bento-card">
                  <h3>Administración de activo</h3>
                  <div className="guantes-spec-list" style={{ marginBottom: '16px' }}>
                    <div className="guantes-spec-row">
                      <span className="muted">Código:</span>
                      <strong>{selectedGlove.code}</strong>
                    </div>
                    <div className="guantes-spec-row">
                      <span className="muted">Tarifa actual:</span>
                      <strong>{formatMoney(selectedGlove.priceMinor)} MXN</strong>
                    </div>
                  </div>

                  <div className="field" style={{ marginBottom: '12px' }}>
                    <label htmlFor="edit-glove-price">Nueva tarifa (MXN)</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        id="edit-glove-price"
                        type="number"
                        step="0.50"
                        min="1"
                        placeholder="25.00"
                        value={editingPricePesos}
                        onChange={e => setEditingPricePesos(e.target.value)}
                      />
                      <Button
                        variant="secondary"
                        disabled={adminSaving || !editingPricePesos}
                        onClick={handleUpdatePrice}
                      >
                        Actualizar
                      </Button>
                    </div>
                  </div>

                  <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--color-border)' }} />

                  <h4>Agregar nuevo par de guantes</h4>
                  <form onSubmit={handleCreateAsset} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div className="field">
                      <label htmlFor="new-glove-code">Código</label>
                      <input
                        id="new-glove-code"
                        type="text"
                        placeholder="#13 o G-13"
                        value={newCode}
                        onChange={e => setNewCode(e.target.value)}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="new-glove-color">Color</label>
                      <input
                        id="new-glove-color"
                        type="text"
                        placeholder="Rojo / Negro / Azul"
                        value={newColor}
                        onChange={e => setNewColor(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="new-glove-ounces">Onzas</label>
                      <input
                        id="new-glove-ounces"
                        type="number"
                        min="8"
                        max="20"
                        value={newOunces}
                        onChange={e => setNewOunces(parseInt(e.target.value, 10))}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="new-glove-price">Tarifa por uso (MXN)</label>
                      <input
                        id="new-glove-price"
                        type="number"
                        step="0.50"
                        min="1"
                        value={newPricePesos}
                        onChange={e => setNewPricePesos(e.target.value)}
                      />
                    </div>
                    <Button type="submit" disabled={adminSaving || !newCode.trim()}>
                      Guardar nuevo activo
                    </Button>
                  </form>
                </div>
              ) : selectedGlove.status === 'available' ? (
                <CurrentPurchaseCard
                  className="current-purchase-card--modal"
                  title={`Guantes ${selectedGlove.code}`}
                  totalMinor={selectedGlove.priceMinor}
                  step1Title="Guante"
                  step2Title="Cobro"
                  confirmActionLabel="Confirmar cobro y entregar"
                  step1ActionLabel={`Proceder al cobro · ${formatMoney(selectedGlove.priceMinor)} MXN →`}
                  step1ActionDisabled={!assignedMemberId}
                  assignedMember={assignedMember ? { id: assignedMember.id, name: assignedMember.name, phone: assignedMember.phone } : null}
                  onAssignMemberClick={() => setIsSearchOpen(true)}
                  onConfirmPayment={handleConfirmRental}
                >
                  {/* Step 1: Member Assignment */}
                  <div className="modal-cart-section">
                    <h3 className="modal-cart-section-title">Asignar a socio</h3>
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
                                    const m = flatActiveMembers[selectedMemberIndex];
                                    handleAssignMember(m.id, m);
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
                                  if (m) handleAssignMember(m.id, m);
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
                            setSelectedLiveMember(null);
                            setMemberQuery('');
                          }}
                        >
                          Desasignar
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Step 1: Glove Specs */}
                  <div className="modal-cart-section" style={{ marginTop: '8px' }}>
                    <h3 className="modal-cart-section-title">Especificación de los guantes</h3>
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
                        <span className="guante-badge guante-badge-available">Disponible</span>
                      </div>
                      <div className="guantes-spec-row">
                        <span className="muted">Tarifa:</span>
                        <strong>{formatMoney(selectedGlove.priceMinor)} MXN</strong>
                      </div>
                    </div>
                  </div>
                </CurrentPurchaseCard>
              ) : (
                /* Rented Glove Details and Return */
                <>
                  <div className="guantes-bento-card">
                    <h3>Socio asignado</h3>
                    <div className="guantes-assigned-details">
                      <div className="guantes-spec-row">
                        <span className="muted">Asignado a:</span>
                        <strong>
                          {selectedGlove.assignedMemberName || rentedMember?.name || 'Socio'}
                        </strong>
                      </div>
                      {rentedMember?.phone && (
                        <div className="guantes-spec-row">
                          <span className="muted">Teléfono:</span>
                          <span>{rentedMember.phone}</span>
                        </div>
                      )}
                      {selectedGlove.assignedAt && (
                        <div className="guantes-spec-row">
                          <span className="muted">Prestado el:</span>
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
                  </div>

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
                        <strong>En uso</strong>
                      </div>
                      <div className="guantes-spec-row">
                        <span className="muted">Tarifa:</span>
                        <strong>{formatMoney(selectedGlove.priceMinor)} MXN</strong>
                      </div>
                    </div>
                  </div>

                  <div className="guantes-bento-card">
                    <h3>Devolución</h3>
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

                    <Button variant="primary" onClick={() => void handleReturnGlove()}>
                      Marcar como devuelto
                    </Button>
                  </div>
                </>
              )}
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
