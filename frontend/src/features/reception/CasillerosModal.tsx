import { formatMoney } from '@/shared/formatters/money';
import { calculateNextMonthExpiry } from '@/domain/lockers';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LockerItem, LockerStatus } from '../../domain/models';
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
  assignLocker as apiAssignLocker,
  renewLocker as apiRenewLocker,
  releaseLocker as apiReleaseLocker,
  previewLockerCancellation,
  confirmLockerCancellation,
  createRentalAsset,
  updateRentalAsset,
  type RentalAssetDTO,
  type RentalDTO,
  type CancellationPreviewDTO,
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
export interface CasillerosModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiRequest: AuthenticatedRequest;
  registerId?: string;
  branchId: string;
  isAdmin?: boolean;
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

interface MemberSearchResult {
  id: string;
  full_name: string;
  phone: string;
}

export function CasillerosModal({
  isOpen,
  onClose,
  apiRequest,
  registerId,
  branchId,
  isAdmin = false,
}: CasillerosModalProps) {

  // Live state
  const [liveAssets, setLiveAssets] = useState<RentalAssetDTO[]>([]);
  const [liveRentals, setLiveRentals] = useState<RentalDTO[]>([]);
  const [liveMembers, setLiveMembers] = useState<MemberSearchResult[]>([]);
  const [selectedLiveMember, setSelectedLiveMember] = useState<{ id: string; name: string; phone?: string } | null>(null);

  // Cancellation modal state
  const [isCancellationOpen, setIsCancellationOpen] = useState(false);
  const [cancellationPreview, setCancellationPreview] = useState<CancellationPreviewDTO | null>(null);
  const [cancellationRefundPesos, setCancellationRefundPesos] = useState('');
  const [cancellationMethod, setCancellationMethod] = useState<'cash' | 'card'>('cash');
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancellingSubmitting, setCancellingSubmitting] = useState(false);

  // Admin controls state
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newNumber, setNewNumber] = useState(43);
  const [newPricePesos, setNewPricePesos] = useState('180');
  const [editingPricePesos, setEditingPricePesos] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);
  const [newDepositPesos, setNewDepositPesos] = useState('0');
  const [editingDepositPesos, setEditingDepositPesos] = useState('');
  // Deposit refund inputs; null refund means "full held amount".
  const [depositRefundPesos, setDepositRefundPesos] = useState<string | null>(null);
  const [depositReason, setDepositReason] = useState('');
  const [depositErrors, setDepositErrors] = useState<DepositEndErrors>({});
  const { errors: fieldErrors, setErrors: setFieldErrors, clear: clearFieldError } = useFieldErrors();

  const [selectedLockerId, setSelectedLockerId] = useState<string>('locker-01');
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

  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    const currentTheme = document.documentElement.dataset.theme;
    return currentTheme ? currentTheme === 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  });

  const refreshLive = useCallback(async () => {
    try {
      const [assetsPage, rentalsPage] = await Promise.all([
        listRentalAssets(apiRequest, branchId, 'locker', 0, 100),
        listRentals(apiRequest, branchId, { status: 'active', kind: 'locker' }),
      ]);
      setLiveAssets(assetsPage.items);
      setLiveRentals(rentalsPage.items);
      if (assetsPage.items.length > 0) {
        setSelectedLockerId(current => {
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

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (isCancellationOpen) {
          setIsCancellationOpen(false);
        } else {
          onClose();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isCancellationOpen, onClose]);

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
      setAssignedMemberId(null);
      setSelectedLiveMember(null);
      setToast(null);
      setIsAdminMode(false);
      setIsCancellationOpen(false);
      setCancellationPreview(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Build unified lockers array from the server catalog
  const lockers: LockerItem[] = liveAssets.map((asset, index) => {
    const activeRental = liveRentals.find(r => r.asset_id === asset.id && r.status === 'active');
    const lockerStatus: LockerStatus = activeRental
      ? 'assigned'
      : asset.status === 'employee'
      ? 'employee'
      : asset.status === 'out_of_service'
      ? 'out_of_service'
      : 'available';
    return {
      id: asset.id,
      number: asset.locker_number ?? (index + 1),
      code: asset.code,
      status: lockerStatus,
      monthlyPriceMinor: asset.price_minor,
      assignedMemberId: activeRental?.member_id ?? null,
      assignedMemberName: activeRental?.member_name ?? null,
      assignedAt: activeRental?.created_at ?? null,
      expiresAt: activeRental?.ends_on ? `${activeRental.ends_on}T23:59:59.000Z` : null,
      rentalId: activeRental?.id ?? null,
      paymentStatus: activeRental && activeRental.outstanding_minor > 0 ? 'pending' : 'paid',
      paymentMethod: 'cash',
    };
  });

  const selectedLocker: LockerItem | undefined =
    lockers.find(l => l.id === selectedLockerId) ??
    lockers.find(l => l.status === 'available') ??
    lockers[0];

  const selectedAsset = liveAssets.find(a => a.id === selectedLocker?.id);
  const selectedRental = liveRentals.find(r => r.id === selectedLocker?.rentalId);
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

  function selectLocker(id: string) {
    setSelectedLockerId(id);
    setDepositRefundPesos(null);
    setDepositReason('');
    setDepositErrors({});
  }

  async function handleConfirmAssignment(breakdown?: CheckoutPaymentBreakdown) {
    if (!selectedLocker || !assignedMemberId) return;

    if (!registerId) {
      setToast({
        open: true,
        title: 'Caja no seleccionada',
        description: 'Se requiere una caja con turno abierto para asignar el casillero.',
        type: 'error',
      });
      return;
    }
    const tender = buildRentalTender(selectedLocker.monthlyPriceMinor, breakdown);
    try {
      const rental = await apiAssignLocker(
        apiRequest,
        {
          branch_id: branchId,
          asset_id: selectedLocker.id,
          member_id: assignedMemberId,
          register_id: registerId,
          components: tender.components,
          expected_total_minor: selectedLocker.monthlyPriceMinor,
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
          cardWarning = `${err.message || 'No se pudo iniciar el cobro con tarjeta.'} El casillero quedó con saldo pendiente.`;
        }
      }
      // The rental is already recorded; a failed deposit must not look like a failed rental.
      const changeToCreditMinor = breakdown?.changeToCreditMinor ?? 0;
      if (changeToCreditMinor > 0) {
        try {
          await depositMemberCredit(apiRequest, registerId, { member_id: assignedMemberId, amount_minor: changeToCreditMinor }, crypto.randomUUID());
        } catch {
          const msg = 'El casillero quedó registrado, pero no se pudo abonar el cambio como saldo a favor. Puedes agregarlo desde el perfil del socio.';
          cardWarning = cardWarning ? cardWarning + ' ' + msg : msg;
        }
      }
      await refreshLive();
      const memberName = assignedMember?.name ?? 'socio';
      setAssignedMemberId(null);
      setSelectedLiveMember(null);
      setToast(
        cardWarning
          ? { open: true, title: 'Casillero asignado con saldo pendiente', description: cardWarning, type: 'warning' }
          : {
              open: true,
              title: 'Casillero asignado',
              description: `Casillero ${selectedLocker.code} asignado a ${memberName}.`,
              type: 'success',
            }
      );
    } catch (err: any) {
      setToast({
        open: true,
        title: 'Error de asignación',
        description: err.message || 'No se pudo asignar el casillero.',
        type: 'error',
      });
    }
  }

  async function handleReleaseLocker(title = 'Casillero liberado') {
    if (!selectedLocker || !selectedLocker.rentalId) return;
    const code = selectedLocker.code;
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
      await apiReleaseLocker(apiRequest, selectedLocker.rentalId, crypto.randomUUID(), built.body);
      await refreshLive();
      setDepositRefundPesos(null);
      setDepositReason('');
      setToast({
        open: true,
        title,
        description: `Casillero ${code} disponible para asignación.`,
        type: 'success',
      });
    } catch (err: any) {
      setToast({
        open: true,
        title: 'Error al liberar',
        description: err.message || 'No se pudo liberar el casillero.',
        type: 'error',
      });
    }
  }

  async function handleOpenCancellation() {
    if (!selectedLocker || !selectedLocker.rentalId) return;
    try {
      const preview = await previewLockerCancellation(apiRequest, selectedLocker.rentalId);
      setCancellationPreview(preview);
      setCancellationRefundPesos((preview.suggested_refund_minor / 100).toFixed(2));
      setCancellationMethod('cash');
      setCancellationReason('');
      setIsCancellationOpen(true);
    } catch (err: any) {
      setToast({
        open: true,
        title: 'Error al consultar cancelación',
        description: err.message || 'No se pudo obtener el cálculo de cancelación.',
        type: 'error',
      });
    }
  }

  async function handleConfirmCancellationSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!registerId || !selectedLocker?.rentalId || !cancellationPreview) return;
    const refundMinor = Math.round(parseFloat(cancellationRefundPesos || '0') * 100);
    const found: Record<string, string> = {};
    if (refundMinor > cancellationPreview.max_refundable_minor) {
      found.refund = `El reembolso no puede exceder $${(cancellationPreview.max_refundable_minor / 100).toFixed(2)} MXN.`;
    }
    if (!cancellationReason.trim()) found.reason = 'Escribe el motivo de la cancelación anticipada.';
    if (Object.keys(found).length) {
      setFieldErrors(found);
      document.getElementById(found.refund ? 'cancel-refund-amount' : 'cancel-reason')?.focus();
      return;
    }
    setFieldErrors({});

    setCancellingSubmitting(true);
    try {
      await confirmLockerCancellation(
        apiRequest,
        selectedLocker.rentalId,
        {
          register_id: registerId,
          preview_token: cancellationPreview.preview_token,
          refund_amount_minor: Math.max(0, refundMinor),
          refund_method: cancellationMethod,
          reason: cancellationReason.trim(),
        },
        crypto.randomUUID()
      );
      await refreshLive();
      setIsCancellationOpen(false);
      setCancellationPreview(null);
      setToast({
        open: true,
        title: 'Casillero cancelado y liberado',
        description: `Casillero ${selectedLocker.code} cancelado. Se registró alerta a administración.`,
        type: 'warning',
      });
    } catch (err: any) {
      setToast({
        open: true,
        title: 'Error al confirmar cancelación',
        description: err.message || 'No se pudo confirmar la cancelación.',
        type: 'error',
      });
    } finally {
      setCancellingSubmitting(false);
    }
  }

  async function handleRenewLocker() {
    if (!selectedLocker || !registerId || !selectedLocker.rentalId) return;
    const code = selectedLocker.code;
    try {
      await apiRenewLocker(
        apiRequest,
        selectedLocker.rentalId,
        {
          register_id: registerId,
          components: [{ method: 'cash', amount_minor: selectedLocker.monthlyPriceMinor }],
          expected_total_minor: selectedLocker.monthlyPriceMinor,
          accepted_shortfall_minor: 0,
        },
        crypto.randomUUID()
      );
      await refreshLive();
      setToast({
        open: true,
        title: 'Mensualidad renovada',
        description: `Casillero ${code} extendido por 1 mes.`,
        type: 'success',
      });
    } catch (err: any) {
      setToast({
        open: true,
        title: 'Error al renovar',
        description: err.message || 'No se pudo renovar la mensualidad.',
        type: 'error',
      });
    }
  }

  async function handleEvictAndReleaseLocker() {
    await handleReleaseLocker('Casillero desalojado');
  }

  // Admin handlers
  async function handleCreateLockerAsset(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode.trim()) {
      setFieldErrors({ code: 'Escribe el código del casillero.' });
      document.getElementById('new-locker-code')?.focus();
      return;
    }
    setAdminSaving(true);
    try {
      const priceMinor = Math.round(parseFloat(newPricePesos || '0') * 100);
      await createRentalAsset(apiRequest, {
        branch_id: branchId,
        kind: 'locker',
        code: newCode.trim(),
        locker_number: Number(newNumber) || 1,
        price_minor: priceMinor,
        deposit_minor: Math.max(0, Math.round(parseFloat(newDepositPesos || '0') * 100) || 0),
      });
      await refreshLive();
      setNewCode('');
      setToast({
        open: true,
        title: 'Casillero registrado',
        description: `Se agregó el casillero ${newCode.trim()} al catálogo.`,
        type: 'success',
      });
    } catch (err: any) {
      setToast({
        open: true,
        title: 'Error al crear',
        description: err.message || 'No se pudo crear el casillero.',
        type: 'error',
      });
    } finally {
      setAdminSaving(false);
    }
  }

  async function handleUpdateLockerPrice() {
    if (!selectedLocker) return;
    const priceMinor = Math.round(parseFloat(editingPricePesos || '0') * 100);
    if (!Number.isFinite(priceMinor) || priceMinor <= 0) {
      setFieldErrors({ price: 'Ingresa una tarifa válida mayor a $0.00.' });
      document.getElementById('edit-locker-price')?.focus();
      return;
    }
    clearFieldError('price');
    setAdminSaving(true);
    try {
      await updateRentalAsset(apiRequest, selectedLocker.id, { price_minor: priceMinor });
      await refreshLive();
      setEditingPricePesos('');
      setToast({
        open: true,
        title: 'Tarifa mensual actualizada',
        description: `La mensualidad de ${selectedLocker.code} se actualizó a $${(priceMinor / 100).toFixed(2)} MXN.`,
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

  async function handleUpdateLockerDeposit() {
    if (!selectedLocker) return;
    const value = Math.round(parseFloat(editingDepositPesos || '') * 100);
    if (!Number.isFinite(value) || value < 0) {
      setFieldErrors({ deposit: 'Ingresa un depósito válido (0 o mayor).' });
      document.getElementById('edit-locker-deposit')?.focus();
      return;
    }
    clearFieldError('deposit');
    setAdminSaving(true);
    try {
      await updateRentalAsset(apiRequest, selectedLocker.id, { deposit_minor: value });
      await refreshLive();
      setEditingDepositPesos('');
      setToast({
        open: true,
        title: 'Depósito actualizado',
        description: `El depósito de ${selectedLocker.code} ahora es ${formatMoney(value)} MXN.`,
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

  const projectedExpiry = calculateNextMonthExpiry(new Date());
  const nowIso = new Date().toISOString();

  return (
    <div
      className="staff-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="casilleros-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget && !isCancellationOpen) onClose();
      }}
    >
      <div className="staff-modal-card casilleros-modal-card">
        {/* Header */}
        <div className="guantes-modal-header">
          <div className="guantes-modal-title-group">
            <h2 id="casilleros-modal-title">Casilleros</h2>
            <p className="muted">Control y asignación de los 42 casilleros mensuales del gimnasio</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isAdmin && (
              <Button
                variant="secondary"
                className="button-sm"
                onClick={() => setIsAdminMode(prev => !prev)}
              >
                {isAdminMode ? 'Volver a casilleros' : '⚙️ Gestionar casilleros'}
              </Button>
            )}
            <button
              type="button"
              className="guantes-close-btn"
              aria-label="Cerrar modal de casilleros"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Main Body */}
        <div className="guantes-modal-body">
          {/* Left Grid: Locker Cards */}
          <div className="casilleros-grid-container" role="group" aria-label="Casilleros del gimnasio">
            {lockers.map(locker => {
              const isSelected = selectedLocker?.id === locker.id;
              const eff = getLockerEffectiveStatus(locker, nowIso);

              return (
                <button
                  key={locker.id}
                  type="button"
                  className={`casillero-card ${isSelected ? 'selected' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => selectLocker(locker.id)}
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
            const effSelected = getLockerEffectiveStatus(selectedLocker, nowIso);

            return (
              <div className="guantes-sidebar-column">
                {isAdminMode ? (
                  /* Admin Locker Panel */
                  <div className="guantes-bento-card">
                    <h3>Administración de casillero</h3>
                    <div className="guantes-spec-list" style={{ marginBottom: '16px' }}>
                      <div className="guantes-spec-row">
                        <span className="muted">Código:</span>
                        <strong>{selectedLocker.code}</strong>
                      </div>
                      <div className="guantes-spec-row">
                        <span className="muted">Tarifa actual:</span>
                        <strong>{formatMoney(selectedLocker.monthlyPriceMinor)}/mes</strong>
                      </div>
                      <div className="guantes-spec-row">
                        <span className="muted">Depósito actual:</span>
                        <strong>{formatMoney(depositMinor)} MXN</strong>
                      </div>
                    </div>

                    <div className="field" style={{ marginBottom: '12px' }}>
                      <label htmlFor="edit-locker-price">Nueva tarifa mensual (MXN)</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          id="edit-locker-price"
                          aria-invalid={fieldErrors.price ? true : undefined}
                          aria-describedby={fieldErrors.price ? 'edit-locker-price-error' : undefined}
                          type="number"
                          step="1.00"
                          min="1"
                          placeholder="180.00"
                          value={editingPricePesos}
                          onChange={e => { setEditingPricePesos(e.target.value); clearFieldError('price'); }}
                        />
                        <Button
                          variant="secondary"
                          disabled={adminSaving}
                          onClick={handleUpdateLockerPrice}
                        >
                          Actualizar
                        </Button>
                      </div>
                      {fieldErrors.price && <p id="edit-locker-price-error" className="field-error">{fieldErrors.price}</p>}
                    </div>

                    <div className="field" style={{ marginBottom: '12px' }}>
                      <label htmlFor="edit-locker-deposit">Nuevo depósito reembolsable (MXN)</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          id="edit-locker-deposit"
                          aria-invalid={fieldErrors.deposit ? true : undefined}
                          aria-describedby="edit-locker-deposit-help"
                          type="number"
                          step="1.00"
                          min="0"
                          placeholder="0.00"
                          disabled={selectedLocker.status !== 'available'}
                          value={editingDepositPesos}
                          onChange={e => { setEditingDepositPesos(e.target.value); clearFieldError('deposit'); }}
                        />
                        <Button
                          variant="secondary"
                          disabled={adminSaving || selectedLocker.status !== 'available'}
                          onClick={handleUpdateLockerDeposit}
                        >
                          Actualizar depósito
                        </Button>
                      </div>
                      <span id="edit-locker-deposit-help" className="muted" style={{ fontSize: '0.8rem' }}>
                        {selectedLocker.status === 'available'
                          ? 'Se cobra en efectivo al asignar y se devuelve al liberar el casillero.'
                          : 'Solo se edita con el activo libre (sin renta activa).'}
                      </span>
                      {fieldErrors.deposit && <p className="field-error">{fieldErrors.deposit}</p>}
                    </div>

                    <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--color-border)' }} />

                    <h4>Agregar nuevo casillero</h4>
                    <form noValidate onSubmit={handleCreateLockerAsset} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <FormField label="Código" id="new-locker-code" error={fieldErrors.code}>
                        <input
                          type="text"
                          placeholder="#43 o C-43"
                          value={newCode}
                          onChange={e => { setNewCode(e.target.value); clearFieldError('code'); }}
                          required
                        />
                      </FormField>
                      <div className="field">
                        <label htmlFor="new-locker-number">Número de casillero</label>
                        <input
                          id="new-locker-number"
                          type="number"
                          min="1"
                          value={newNumber}
                          onChange={e => setNewNumber(parseInt(e.target.value, 10))}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="new-locker-price">Tarifa mensual (MXN)</label>
                        <input
                          id="new-locker-price"
                          type="number"
                          step="1.00"
                          min="1"
                          value={newPricePesos}
                          onChange={e => setNewPricePesos(e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="new-locker-deposit">Depósito reembolsable (MXN)</label>
                        <input
                          id="new-locker-deposit"
                          type="number"
                          step="1.00"
                          min="0"
                          value={newDepositPesos}
                          onChange={e => setNewDepositPesos(e.target.value)}
                        />
                      </div>
                      <Button type="submit" disabled={adminSaving}>
                        Guardar nuevo casillero
                      </Button>
                    </form>
                  </div>
                ) : effSelected.status === 'available' ? (
                  <CurrentPurchaseCard
                    className="current-purchase-card--modal"
                    title={`Casillero ${selectedLocker.code}`}
                    totalMinor={selectedLocker.monthlyPriceMinor}
                    step1Title="Casillero"
                    step2Title="Cobro"
                    confirmActionLabel="Confirmar cobro y asignar"
                    step1ActionLabel={`Proceder al cobro · ${formatMoney(selectedLocker.monthlyPriceMinor)} MXN →`}
                    step1ActionDisabled={!assignedMemberId}
                    useLiveCardIntent
                    statusMessage={depositNotice(depositMinor)}
                    statusType="warning"
                    allowCredit
                    assignedMember={assignedMember ? { id: assignedMember.id, name: assignedMember.name, phone: assignedMember.phone, creditMinor: memberCreditMinor } : null}
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
                        {depositMinor > 0 && (
                          <div className="guantes-spec-row">
                            <span className="muted">Depósito (efectivo):</span>
                            <strong>{formatMoney(depositMinor)} MXN</strong>
                          </div>
                        )}
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
                          <strong>{selectedLocker.assignedMemberName || 'Staff EvoGym'}</strong>
                        </div>
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

                    {selectedRental && heldDeposit > 0 && (
                      <DepositEndSection
                        idPrefix="locker"
                        rental={selectedRental}
                        refundPesos={refundPesosValue}
                        reason={depositReason}
                        errors={depositErrors}
                        note={effSelected.status === 'assigned'
                          ? 'Si cancelas la asignación, el depósito se devuelve completo en efectivo.'
                          : undefined}
                        onRefundChange={value => { setDepositRefundPesos(value); setDepositErrors({}); }}
                        onReasonChange={value => { setDepositReason(value); setDepositErrors({}); }}
                      />
                    )}

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
                              <Button variant="secondary" onClick={() => void handleRenewLocker()}>
                                Renovar mensualidad (+1 mes)
                              </Button>
                              <Button variant="secondary" onClick={() => void handleOpenCancellation()}>
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
                            <Button onClick={() => void handleRenewLocker()}>
                              Renovar casillero (+1 mes)
                            </Button>
                            <Button variant="secondary" onClick={() => void handleEvictAndReleaseLocker()}>
                              Desalojar casillero
                            </Button>
                          </div>
                        )}

                        {effSelected.status === 'evict' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <Notice tone="error">
                              Casillero con más de 2 semanas vencido sin renovar ({effSelected.overdueDays ?? 15} días de atraso). Requiere desalojo inmediato para liberar el espacio.
                            </Notice>
                            <Button onClick={() => void handleEvictAndReleaseLocker()}>
                              Desalojar casillero
                            </Button>
                          </div>
                        )}

                        {(effSelected.status === 'employee' || effSelected.status === 'out_of_service') && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <Button variant="secondary" onClick={() => void handleReleaseLocker()}>
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

      {/* Cancellation Confirmation Dialog (S3, S5, S6) */}
      {isCancellationOpen && cancellationPreview && selectedLocker && (
        <div
          className="staff-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-locker-modal-title"
          style={{ zIndex: 1100 }}
          onClick={e => {
            if (e.target === e.currentTarget && !cancellingSubmitting) setIsCancellationOpen(false);
          }}
        >
          <div className="staff-modal-card" style={{ maxWidth: '480px', width: '90%' }}>
            <div className="guantes-modal-header">
              <div className="guantes-modal-title-group">
                <h3 id="cancel-locker-modal-title">Confirmar cancelación de casillero</h3>
                <p className="muted">Revisa el resumen financiero antes de confirmar la liberación</p>
              </div>
              <button
                type="button"
                className="guantes-close-btn"
                aria-label="Cerrar confirmación de cancelación"
                disabled={cancellingSubmitting}
                onClick={() => setIsCancellationOpen(false)}
              >
                ✕
              </button>
            </div>

            {!cancellationPreview.can_cancel && (
              <div style={{ padding: '16px 16px 0' }}>
                <Notice tone="warning">
                  Este casillero no admite cancelación con reembolso (por ejemplo, si se pagó con saldo a favor). Usa Liberar casillero, que no genera reembolso.
                </Notice>
              </div>
            )}

            <form noValidate onSubmit={handleConfirmCancellationSubmit} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="guantes-bento-card" style={{ background: 'var(--color-surface-sunken, #f8f9fa)' }}>
                <div className="guantes-spec-list">
                  <div className="guantes-spec-row">
                    <span className="muted">Casillero:</span>
                    <strong>{selectedLocker.code}</strong>
                  </div>
                  <div className="guantes-spec-row">
                    <span className="muted">Socio:</span>
                    <strong>{selectedLocker.assignedMemberName || 'Socio'}</strong>
                  </div>
                  <div className="guantes-spec-row">
                    <span className="muted">Monto total pagado:</span>
                    <span>{formatMoney(cancellationPreview.settled_minor)} MXN</span>
                  </div>
                  {cancellationPreview.cancelled_debt_minor > 0 && (
                    <div className="guantes-spec-row">
                      <span className="muted">Deuda a cancelar:</span>
                      <strong style={{ color: 'var(--color-primary-ink)' }}>
                        {formatMoney(cancellationPreview.cancelled_debt_minor)} MXN
                      </strong>
                    </div>
                  )}
                  <div className="guantes-spec-row">
                    <span className="muted">Reembolso sugerido (proporcional):</span>
                    <strong>{formatMoney(cancellationPreview.suggested_refund_minor)} MXN</strong>
                  </div>
                  <div className="guantes-spec-row">
                    <span className="muted">Reembolso máximo permitido:</span>
                    <span>{formatMoney(cancellationPreview.max_refundable_minor)} MXN</span>
                  </div>
                </div>
              </div>

              <div className="field">
                <label htmlFor="cancel-refund-amount">Monto a reembolsar (MXN)</label>
                <input
                  id="cancel-refund-amount"
                  aria-invalid={fieldErrors.refund ? true : undefined}
                  aria-describedby={fieldErrors.refund ? 'cancel-refund-amount-error' : undefined}
                  type="number"
                  step="0.50"
                  min="0"
                  max={(cancellationPreview.max_refundable_minor / 100).toFixed(2)}
                  value={cancellationRefundPesos}
                  onChange={e => { setCancellationRefundPesos(e.target.value); clearFieldError('refund'); }}
                  disabled={cancellingSubmitting}
                  required
                />
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  Puede ser 0.00 si no se otorga devolución económica.
                </span>
                {fieldErrors.refund && <p id="cancel-refund-amount-error" className="field-error">{fieldErrors.refund}</p>}
              </div>

              <div className="field">
                <label htmlFor="cancel-refund-method">Método de reembolso</label>
                <select
                  id="cancel-refund-method"
                  value={cancellationMethod}
                  onChange={e => setCancellationMethod(e.target.value as 'cash' | 'card')}
                  disabled={cancellingSubmitting}
                >
                  <option value="cash">Efectivo (afecta caja)</option>
                  <option value="card">Tarjeta (registrado por staff)</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="cancel-reason">Motivo de cancelación (obligatorio)</label>
                <textarea
                  id="cancel-reason"
                  aria-invalid={fieldErrors.reason ? true : undefined}
                  aria-describedby={fieldErrors.reason ? 'cancel-reason-error' : undefined}
                  rows={3}
                  maxLength={240}
                  placeholder="Ej. Socio cambia de residencia o solicita baja anticipada..."
                  value={cancellationReason}
                  onChange={e => { setCancellationReason(e.target.value); clearFieldError('reason'); }}
                  disabled={cancellingSubmitting}
                  required
                />
                <span className="muted" style={{ fontSize: '0.8rem', textAlign: 'right' }}>
                  {cancellationReason.length}/240
                </span>
                {fieldErrors.reason && <p id="cancel-reason-error" className="field-error">{fieldErrors.reason}</p>}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={cancellingSubmitting}
                  onClick={() => setIsCancellationOpen(false)}
                >
                  Volver
                </Button>
                <Button
                  type="submit"
                  disabled={cancellingSubmitting || !cancellationPreview.can_cancel}
                >
                  {cancellingSubmitting ? 'Cancelando...' : 'Confirmar cancelación'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

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
