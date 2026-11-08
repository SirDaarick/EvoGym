import { formatMoney } from '@/shared/formatters/money';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GloveItem } from '../../domain/models';
import { Button, FormField, Notice, useFieldErrors } from '../../shared/ui';
import AnimatedList from '../catalog/react-bits/AnimatedList';
import SwipeToast from '../catalog/react-bits/SwipeToast';
import { CurrentPurchaseCard, type CheckoutPaymentBreakdown } from './CurrentPurchaseCard';
import type { AuthenticatedRequest } from '../../api/inventoryApi';
import { getMember } from '../../api/membersApi';
import { depositMemberCredit } from '../../api/memberCreditApi';
import {
  listRentalAssets,
  listRentals,
  rentGlove as apiRentGlove,
  returnGlove as apiReturnGlove,
  createRentalAsset,
  updateRentalAsset,
  type RentalAssetDTO,
  type RentalDTO,
} from '../../api/rentalsApi';
import {
  DepositEndSection,
  buildEndBody,
  buildRentalTender,
  cardPendingMessage,
  collectRentalCard,
  depositNotice,
  type DepositEndErrors,
} from './rentalPayments';

/** Live-only: rentals are server-backed (no demo fallback). */
export interface GuantesModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiRequest: AuthenticatedRequest;
  branchId: string;
  registerId?: string;
  isAdmin?: boolean;
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

  // Live state
  const [liveAssets, setLiveAssets] = useState<RentalAssetDTO[]>([]);
  const [liveRentals, setLiveRentals] = useState<RentalDTO[]>([]);
  const [liveMembers, setLiveMembers] = useState<MemberSearchResult[]>([]);
  const [selectedLiveMember, setSelectedLiveMember] = useState<{ id: string; name: string; phone?: string } | null>(null);

  // Admin controls state
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [newCode, setNewCode] = useState('');
  const { errors: adminErrors, setErrors: setAdminErrors, clear: clearAdminError } = useFieldErrors();
  const [newColor, setNewColor] = useState('Rojo');
  const [newOunces, setNewOunces] = useState(12);
  const [newPricePesos, setNewPricePesos] = useState('25');
  const [editingPricePesos, setEditingPricePesos] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);
  const [newDepositPesos, setNewDepositPesos] = useState('0');
  const [editingDepositPesos, setEditingDepositPesos] = useState('');
  // Deposit refund inputs; null refund means "full held amount".
  const [depositRefundPesos, setDepositRefundPesos] = useState<string | null>(null);
  const [depositReason, setDepositReason] = useState('');
  const [depositErrors, setDepositErrors] = useState<DepositEndErrors>({});

  const [selectedGloveId, setSelectedGloveId] = useState<string>('glove-01');
  const [assignedMemberId, setAssignedMemberId] = useState<string | null>(null);

  // Saldo a favor of the selected member; unknown balance simply hides the tick.
  const [memberCreditMinor, setMemberCreditMinor] = useState(0);
  useEffect(() => {
    let active = true;
    setMemberCreditMinor(0);
    if (assignedMemberId) {
      getMember(apiRequest, assignedMemberId)
        .then(detail => { if (active && typeof detail?.credit_balance_minor === 'number') setMemberCreditMinor(detail.credit_balance_minor); })
        .catch(() => { /* non-fatal: no saldo a favor offered */ });
    }
    return () => { active = false; };
  }, [assignedMemberId, apiRequest]);

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
    if (isOpen) {
      void refreshLive();
    }
  }, [isOpen, refreshLive]);

  // Live member search
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, apiRequest, memberQuery]);

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

  // Build unified gloves array from the server catalog
  const gloves: GloveItem[] = liveAssets.map(asset => {
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
  });

  const selectedGlove: GloveItem | undefined =
    gloves.find(g => g.id === selectedGloveId) ??
    gloves.find(g => g.status === 'available') ??
    gloves[0];

  const selectedAsset = liveAssets.find(a => a.id === selectedGlove?.id);
  const selectedRental = liveRentals.find(r => r.id === selectedGlove?.rentalId);
  const depositMinor = selectedAsset?.deposit_minor ?? 0;
  const heldDeposit = selectedRental?.deposit_held_minor ?? 0;
  const refundPesosValue = depositRefundPesos ?? (heldDeposit / 100).toFixed(2);

  const assignedMember = selectedLiveMember;


  const flatActiveMembers = liveMembers.map(m => ({ id: m.id, name: m.full_name, phone: m.phone }));

  const memberGroups =
    liveMembers.length > 0
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
      : [];

  function handleAssignMember(memberId: string, memberObj?: { id: string; name: string; phone?: string }) {
    setAssignedMemberId(memberId);
    if (memberObj) {
      setSelectedLiveMember(memberObj);
    }
    setIsSearchOpen(false);
    setMemberQuery('');
    setSelectedMemberIndex(-1);
  }

  function selectGlove(id: string) {
    setSelectedGloveId(id);
    setDepositRefundPesos(null);
    setDepositReason('');
    setDepositErrors({});
  }

  async function handleConfirmRental(breakdown?: CheckoutPaymentBreakdown) {
    if (!selectedGlove || !assignedMemberId) return;

    if (!registerId) {
      setToast({
        open: true,
        title: 'Caja no seleccionada',
        description: 'Se requiere una caja con turno abierto para registrar la renta.',
        type: 'error',
      });
      return;
    }
    const tender = buildRentalTender(selectedGlove.priceMinor, breakdown);
    try {
      const rental = await apiRentGlove(
        apiRequest,
        {
          branch_id: branchId,
          asset_id: selectedGlove.id,
          member_id: assignedMemberId,
          register_id: registerId,
          components: tender.components,
          expected_total_minor: selectedGlove.priceMinor,
          accepted_shortfall_minor: tender.shortfallMinor,
          expected_deposit_minor: depositMinor,
          ...(tender.creditMinor > 0 ? { credit_minor: tender.creditMinor } : {}),
        },
        crypto.randomUUID()
      );
      let cardWarning: string | null = null;
      if (tender.cardMinor > 0) {
        try {
          const result = await collectRentalCard(apiRequest, rental, registerId, tender.cardMinor);
          if (!result.confirmed) cardWarning = cardPendingMessage(result.attempt, tender.cardMinor);
        } catch (err: any) {
          cardWarning = `${err.message || 'No se pudo iniciar el cobro con tarjeta.'} La renta quedó con saldo pendiente.`;
        }
      }
      // The rental is already recorded; a failed deposit must not look like a failed rental.
      const changeToCreditMinor = breakdown?.changeToCreditMinor ?? 0;
      if (changeToCreditMinor > 0) {
        try {
          await depositMemberCredit(apiRequest, registerId, { member_id: assignedMemberId, amount_minor: changeToCreditMinor }, crypto.randomUUID());
        } catch {
          const msg = 'La renta quedó registrada, pero no se pudo abonar el cambio como saldo a favor. Puedes agregarlo desde el perfil del socio.';
          cardWarning = cardWarning ? cardWarning + ' ' + msg : msg;
        }
      }
      await refreshLive();
      const memberName = assignedMember?.name ?? 'socio';
      setAssignedMemberId(null);
      setSelectedLiveMember(null);
      setToast(
        cardWarning
          ? { open: true, title: 'Renta registrada con saldo pendiente', description: cardWarning, type: 'warning' }
          : {
              open: true,
              title: 'Renta confirmada',
              description: `Guantes ${selectedGlove.code} rentados exitosamente a ${memberName}.`,
              type: 'success',
            }
      );
    } catch (err: any) {
      setToast({
        open: true,
        title: 'Error de renta',
        description: err.message || 'No se pudo registrar la renta.',
        type: 'error',
      });
    }
  }

  async function handleReturnGlove() {
    if (!selectedGlove || !selectedGlove.rentalId) return;
    const gloveCode = selectedGlove.code;
    const built = buildEndBody({
      heldMinor: heldDeposit,
      registerId,
      refundPesos: refundPesosValue,
      reason: depositReason,
    });
    if (built.errors) {
      setDepositErrors(built.errors);
      return;
    }
    setDepositErrors({});
    try {
      await apiReturnGlove(apiRequest, selectedGlove.rentalId, crypto.randomUUID(), built.body);
      await refreshLive();
      setDepositRefundPesos(null);
      setDepositReason('');
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
  }

  // Admin asset management handlers
  async function handleCreateAsset(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode.trim()) {
      setAdminErrors({ code: 'Escribe el código del guante.' });
      document.getElementById('new-glove-code')?.focus();
      return;
    }
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
        deposit_minor: Math.max(0, Math.round(parseFloat(newDepositPesos || '0') * 100) || 0),
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
    if (!selectedGlove) return;
    const priceMinor = Math.round(parseFloat(editingPricePesos || '0') * 100);
    if (!Number.isFinite(priceMinor) || priceMinor <= 0) {
      setAdminErrors({ price: 'Ingresa una tarifa válida mayor a $0.00.' });
      document.getElementById('edit-glove-price')?.focus();
      return;
    }
    clearAdminError('price');
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

  async function handleUpdateDeposit() {
    if (!selectedGlove) return;
    const value = Math.round(parseFloat(editingDepositPesos || '') * 100);
    if (!Number.isFinite(value) || value < 0) {
      setAdminErrors({ deposit: 'Ingresa un depósito válido (0 o mayor).' });
      document.getElementById('edit-glove-deposit')?.focus();
      return;
    }
    clearAdminError('deposit');
    setAdminSaving(true);
    try {
      await updateRentalAsset(apiRequest, selectedGlove.id, { deposit_minor: value });
      await refreshLive();
      setEditingDepositPesos('');
      setToast({
        open: true,
        title: 'Depósito actualizado',
        description: `El depósito de ${selectedGlove.code} ahora es ${formatMoney(value)} MXN.`,
        type: 'success',
      });
    } catch (err: any) {
      setToast({
        open: true,
        title: 'Error al actualizar depósito',
        description: err.message || 'No se pudo actualizar el depósito.',
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
            {isAdmin && (
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
                  onClick={() => selectGlove(glove.id)}
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
              {isAdminMode ? (
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
                    <div className="guantes-spec-row">
                      <span className="muted">Depósito actual:</span>
                      <strong>{formatMoney(depositMinor)} MXN</strong>
                    </div>
                  </div>

                  <div className="field" style={{ marginBottom: '12px' }}>
                    <label htmlFor="edit-glove-price">Nueva tarifa (MXN)</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        id="edit-glove-price"
                        aria-invalid={adminErrors.price ? true : undefined}
                        aria-describedby={adminErrors.price ? 'edit-glove-price-error' : undefined}
                        type="number"
                        step="0.50"
                        min="1"
                        placeholder="25.00"
                        value={editingPricePesos}
                        onChange={e => { setEditingPricePesos(e.target.value); clearAdminError('price'); }}
                      />
                      <Button
                        variant="secondary"
                        disabled={adminSaving}
                        onClick={handleUpdatePrice}
                      >
                        Actualizar
                      </Button>
                    </div>
                    {adminErrors.price && <p id="edit-glove-price-error" className="field-error">{adminErrors.price}</p>}
                  </div>

                  <div className="field" style={{ marginBottom: '12px' }}>
                    <label htmlFor="edit-glove-deposit">Nuevo depósito reembolsable (MXN)</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        id="edit-glove-deposit"
                        aria-invalid={adminErrors.deposit ? true : undefined}
                        aria-describedby="edit-glove-deposit-help"
                        type="number"
                        step="0.50"
                        min="0"
                        placeholder="0.00"
                        disabled={selectedGlove.status !== 'available'}
                        value={editingDepositPesos}
                        onChange={e => { setEditingDepositPesos(e.target.value); clearAdminError('deposit'); }}
                      />
                      <Button
                        variant="secondary"
                        disabled={adminSaving || selectedGlove.status !== 'available'}
                        onClick={handleUpdateDeposit}
                      >
                        Actualizar depósito
                      </Button>
                    </div>
                    <span id="edit-glove-deposit-help" className="muted" style={{ fontSize: '0.8rem' }}>
                      {selectedGlove.status === 'available'
                        ? 'Se cobra en efectivo al rentar y se devuelve al regresar los guantes.'
                        : 'Solo se edita con el activo libre (sin renta activa).'}
                    </span>
                    {adminErrors.deposit && <p className="field-error">{adminErrors.deposit}</p>}
                  </div>

                  <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--color-border)' }} />

                  <h4>Agregar nuevo par de guantes</h4>
                  <form noValidate onSubmit={handleCreateAsset} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <FormField label="Código" id="new-glove-code" error={adminErrors.code}>
                      <input
                        type="text"
                        placeholder="#13 o G-13"
                        value={newCode}
                        onChange={e => { setNewCode(e.target.value); clearAdminError('code'); }}
                        required
                      />
                    </FormField>
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
                    <div className="field">
                      <label htmlFor="new-glove-deposit">Depósito reembolsable (MXN)</label>
                      <input
                        id="new-glove-deposit"
                        type="number"
                        step="0.50"
                        min="0"
                        value={newDepositPesos}
                        onChange={e => setNewDepositPesos(e.target.value)}
                      />
                    </div>
                    <Button type="submit" disabled={adminSaving}>
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
                  useLiveCardIntent
                  statusMessage={depositNotice(depositMinor)}
                  statusType="warning"
                  allowCredit
                  assignedMember={assignedMember ? { id: assignedMember.id, name: assignedMember.name, phone: assignedMember.phone, creditMinor: memberCreditMinor } : null}
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
                      {depositMinor > 0 && (
                        <div className="guantes-spec-row">
                          <span className="muted">Depósito (efectivo):</span>
                          <strong>{formatMoney(depositMinor)} MXN</strong>
                        </div>
                      )}
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
                          {selectedGlove.assignedMemberName || 'Socio'}
                        </strong>
                      </div>
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

                  {selectedRental && heldDeposit > 0 && (
                    <DepositEndSection
                      idPrefix="glove"
                      rental={selectedRental}
                      refundPesos={refundPesosValue}
                      reason={depositReason}
                      errors={depositErrors}
                      onRefundChange={value => { setDepositRefundPesos(value); setDepositErrors({}); }}
                      onReasonChange={value => { setDepositReason(value); setDepositErrors({}); }}
                    />
                  )}

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
            tone={toast.type === 'error' ? 'error' : 'default'}
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
