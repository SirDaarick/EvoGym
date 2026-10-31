import { useEffect, useRef, useState } from 'react';
import type { LedgerEvent, PaymentMethod, Sale } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { memberStatus } from '../../demo/memberStatus';
import { expectedStock, recordMovement } from '../../demo/inventoryOperations';
import { cartQuote, registerCart } from '../../demo/salesOperations';
import { Button, EmptyState, Notice, PageHeader, Panel } from '../../shared/ui';
import AnimatedList from '../catalog/react-bits/AnimatedList';
import SwipeToast from '../catalog/react-bits/SwipeToast';
import { CurrentPurchaseCard, type CheckoutPaymentBreakdown } from './CurrentPurchaseCard';
import { AssignedMemberSummary } from './AssignedMemberSummary';
import { MermaModal, type WasteItem } from './MermaModal';
import { DevolucionesModal } from './DevolucionesModal';
import { GuantesModal } from './GuantesModal';
import { CasillerosModal } from './CasillerosModal';
import { SuplementosModal } from './SuplementosModal';
import { GastoModal } from './GastoModal';
import { ExtraModal } from './ExtraModal';
import { CashTenderCalculator } from '../payments/CashTenderCalculator';
import { ProductCard } from './ProductCard';
import { MobileDetailPanel } from '../../shared/MobileDetailPanel';
import { PendingBalanceModal } from './PendingBalanceModal';

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

const paymentIcons = {
  cash: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FC6C06" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  ),
  card: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FC6C06" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
    </svg>
  ),
  transfer: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FC6C06" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v4M12 14v4M16 14v4" />
    </svg>
  ),
  mixed: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FC6C06" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
    </svg>
  ),
  pending: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FC6C06" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
};

const memberFavoriteMethods: Record<string, PaymentMethod> = {
  'demo-001': 'card',
  'demo-002': 'transfer',
  'demo-active': 'cash',
  'demo-expired': 'cash',
  'demo-expiry': 'card',
  'demo-unknown': 'cash',
};

export const shortcutIcons = {
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
  const [selectedMethods, setSelectedMethods] = useState<PaymentMethod[]>([]);
  const [holdingMethod, setHoldingMethod] = useState<PaymentMethod | null>(null);
  const [mixedSubStep, setMixedSubStep] = useState<1 | 2>(1);
  const [mixedAmount1, setMixedAmount1] = useState<string>('');
  const [mixedAmount2, setMixedAmount2] = useState<string>('');
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [assignedMemberId, setAssignedMemberId] = useState<string | null>(null);
  const [tenderedAmount, setTenderedAmount] = useState<string>('');
  const [isMermaOpen, setIsMermaOpen] = useState(false);
  const [isDevolucionesOpen, setIsDevolucionesOpen] = useState(false);
  const [selectedCatalogProductId, setSelectedCatalogProductId] = useState<string | null>(null);
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

  const currentShift = state.shifts.find(s => s.id === state.currentShiftId) ?? state.shifts.find(s => s.status === 'open');
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

  const methodNames: Record<PaymentMethod, string> = {
    cash: 'Efectivo',
    card: 'Tarjeta',
    transfer: 'Transferencia',
  };

  const holdTimerRef = useRef<{ [key in PaymentMethod]?: number }>({});
  const didLongPressRef = useRef<{ [key in PaymentMethod]?: boolean }>({});

  const toggleMixedMethod = (m: PaymentMethod) => {
    setSelectedMethods(prev => {
      if (prev.includes(m)) {
        return prev.length > 1 ? prev.filter(x => x !== m) : prev;
      }
      if (prev.length === 1) {
        setMixedSubStep(1);
        setMixedAmount1('');
        setMixedAmount2('');
        return [prev[0], m];
      }
      setMixedSubStep(1);
      setMixedAmount1('');
      setMixedAmount2('');
      return [m];
    });
  };

  const handleTilePointerDown = (m: PaymentMethod) => {
    didLongPressRef.current[m] = false;
    setHoldingMethod(m);
    holdTimerRef.current[m] = window.setTimeout(() => {
      didLongPressRef.current[m] = true;
      setHoldingMethod(null);
      toggleMixedMethod(m);
    }, 450);
  };

  const handleTilePointerUpOrCancel = (m: PaymentMethod) => {
    if (holdTimerRef.current[m]) {
      clearTimeout(holdTimerRef.current[m]);
      delete holdTimerRef.current[m];
    }
    setHoldingMethod(null);
  };

  const handleTileClick = (m: PaymentMethod, e: React.MouseEvent) => {
    if (didLongPressRef.current[m]) {
      didLongPressRef.current[m] = false;
      return;
    }

    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      toggleMixedMethod(m);
      return;
    }

    if (selectedMethods.length === 2) {
      if (m === selectedMethods[0] && mixedSubStep === 2) {
        setMixedSubStep(1);
        return;
      }
      if (m === selectedMethods[1] && mixedSubStep === 1) {
        const a1 = parseMoney(mixedAmount1);
        if (a1 && a1 > 0) {
          const remaining = Math.max(0, totalMinor - a1);
          if (!mixedAmount2 && remaining > 0) {
            setMixedAmount2((remaining / 100).toFixed(2));
          }
          setMixedSubStep(2);
          return;
        }
      }
    }

    // Normal click: switch single selection
    setSelectedMethods([m]);
    setMixedSubStep(1);
    setMixedAmount1('');
    setMixedAmount2('');
    setMethod(m);
  };

  function handleWasteMovement(
    itemsOrProductId: WasteItem[] | string,
    quantityOrReason?: number | string,
    maybeReason?: string
  ) {
    const itemsToWaste: WasteItem[] = Array.isArray(itemsOrProductId)
      ? itemsOrProductId
      : [
          {
            product: state.products.find(p => p.id === itemsOrProductId)!,
            quantity: typeof quantityOrReason === 'number' ? quantityOrReason : 1,
          },
        ].filter(i => Boolean(i.product));

    const reason = (
      typeof itemsOrProductId === 'string'
        ? (typeof quantityOrReason === 'string' ? quantityOrReason : maybeReason ?? '')
        : (typeof quantityOrReason === 'string' ? quantityOrReason : '')
    ).trim();

    const result = transact(current => {
      let nextState = current;
      for (const item of itemsToWaste) {
        const op = recordMovement(nextState, {
          id: `waste-${crypto.randomUUID()}`,
          productId: item.product.id,
          kind: 'waste',
          quantity: item.quantity,
          reason,
        });
        if (op.result.status === 'error') {
          return op;
        }
        nextState = op.state;
      }
      return { state: nextState, result: { status: 'ok' as const } };
    });

    if (result.status === 'ok') {
      setQuantities(prev => {
        const next = { ...prev };
        for (const item of itemsToWaste) {
          delete next[item.product.id];
        }
        return next;
      });
      setSelectedCatalogProductId(null);
      const totalUnits = itemsToWaste.reduce((sum, i) => sum + i.quantity, 0);
      const successMsg = `Merma registrada: ${totalUnits} unidad(es) descontada(s) del inventario.`;
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

  type CustomTransactionResult =
    | { status: 'error'; message: string; sales?: never }
    | { status: 'confirmed' | 'pending'; sales: Sale[]; message?: string };

  const handleConfirmPayment = (
    breakdownOrForce?: CheckoutPaymentBreakdown | boolean,
    forcePendingShortfall = false
  ) => {
    if (!review) return;
    const breakdown = typeof breakdownOrForce === 'object' ? breakdownOrForce : undefined;
    const forcePending = typeof breakdownOrForce === 'boolean' ? breakdownOrForce : forcePendingShortfall;
    const isMixed = breakdown ? breakdown.mode === 'mixed' : selectedMethods.length === 2;
    const m1 = breakdown?.mode === 'mixed' ? breakdown.mixedMethod1! : selectedMethods[0];
    const m2 = breakdown?.mode === 'mixed' ? breakdown.mixedMethod2! : selectedMethods[1];
    const a1 = breakdown?.mode === 'mixed' ? breakdown.mixedAmount1Minor ?? 0 : parseMoney(mixedAmount1) ?? 0;
    const a2 = breakdown?.mode === 'mixed' ? breakdown.mixedAmount2Minor ?? 0 : parseMoney(mixedAmount2) ?? 0;
    const covered = a1 + a2;
    const shortfall = breakdown ? breakdown.shortfallMinor : Math.max(0, totalMinor - covered);

    if (isMixed) {
      if (shortfall > 0 && !forcePending) {
        if (!assignedMemberId) {
          setError(true);
          setMessage(`Faltan ${formatMoney(shortfall)} MXN. Para asignar saldo pendiente debes asignar un socio en el Paso 1 (Carrito).`);
          return;
        }
        setIsPendingModalOpen(true);
        return;
      }

      const result = transact<CustomTransactionResult>(current => {
        if (current.revision !== review.revision) {
          return {
            state: current,
            result: {
              status: 'error' as const,
              message: 'Los registros cambiaron. Revisa la compra de nuevo.',
            },
          };
        }
        const currentQuote = cartQuote(current, lines);
        if (!currentQuote) {
          return {
            state: current,
            result: { status: 'error' as const, message: 'Revisa productos.' },
          };
        }
        for (const line of currentQuote.lines) {
          const available = expectedStock(current, line.productId);
          if (line.quantity > available) {
            const product = current.products.find(p => p.id === line.productId);
            return {
              state: current,
              result: {
                status: 'error' as const,
                message: `Existencia insuficiente para ${product?.name ?? 'producto'}. Disponible: ${available}.`,
              },
            };
          }
        }
        const recordedAt = new Date().toISOString();
        const sales: Sale[] = currentQuote.lines.map((line, index) => ({
          ...line,
          id: `${review.id}:line:${index}`,
          cartId: review.id,
          kind: 'product' as const,
          method: m1,
          status: shortfall > 0 ? ('pending' as const) : ('confirmed' as const),
          shiftId: current.currentShiftId,
          recordedAt,
          memberId: assignedMemberId,
          memberName: assignedMember?.name,
          isOvertime: breakdown?.isOvertime,
          is_overtime: breakdown?.isOvertime,
        }));

        const ledger: LedgerEvent[] = [];
        if (a1 > 0 && (m1 === 'cash' || m1 === 'card')) {
          ledger.push({
            id: `sale-event-${review.id}:part1`,
            paymentId: review.id,
            shiftId: current.currentShiftId,
            kind: 'product' as const,
            amountMinor: a1,
            method: m1,
            recordedAt,
          });
        }
        if (a2 > 0 && (m2 === 'cash' || m2 === 'card')) {
          ledger.push({
            id: `sale-event-${review.id}:part2`,
            paymentId: review.id,
            shiftId: current.currentShiftId,
            kind: 'product' as const,
            amountMinor: a2,
            method: m2,
            recordedAt,
          });
        }

        const updatedMembers =
          shortfall > 0 && assignedMemberId
            ? current.members.map(m =>
                m.id === assignedMemberId
                  ? { ...m, creditMinor: m.creditMinor - shortfall }
                  : m
              )
            : current.members;

        const movements = currentQuote.lines.map(line => ({
          id: `sale-stock-${review.id}:${line.productId}`,
          productId: line.productId,
          shiftId: current.currentShiftId,
          kind: 'sale' as const,
          quantity: line.quantity,
          recordedAt,
        }));

        return {
          state: {
            ...current,
            revision: current.revision + 1,
            sales: [...current.sales, ...sales],
            ledger: [...current.ledger, ...ledger],
            stockMovements: [...current.stockMovements, ...movements],
            members: updatedMembers,
          },
          result: {
            status: shortfall > 0 ? ('pending' as const) : ('confirmed' as const),
            sales,
          },
        };
      });

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
      } else {
        setPending(false);
        const successMsg =
          shortfall > 0
            ? `Cobro registrado: ${formatMoney(covered)} MXN cobrados y ${formatMoney(shortfall)} MXN asignados como saldo pendiente a ${assignedMember?.name}.`
            : `Cobro mixto registrado con éxito (${formatMoney(a1)} MXN en ${methodNames[m1]} + ${formatMoney(a2)} MXN en ${methodNames[m2]}).`;
        setMessage(successMsg);
        setQuantities({});
        setTenderedAmount('');
        setMixedAmount1('');
        setMixedAmount2('');
        setSelectedMethods([]);
        cartId.current = null;
        setToast({
          open: true,
          type: 'success',
          title: shortfall > 0 ? 'Cobro y saldo asignado' : 'Cobro confirmado',
          description: successMsg,
        });
      }
      return;
    }

    // Single method:
    const singleMethod = breakdown?.mode === 'single' ? breakdown.method : selectedMethods[0];
    if (singleMethod === 'cash') {
      const isTenderSpecified = breakdown ? breakdown.tenderedMinor !== undefined : tenderedAmount.trim() !== '';
      const tendered = breakdown ? (breakdown.tenderedMinor ?? totalMinor) : (isTenderSpecified ? (tenderedMinor ?? 0) : totalMinor);
      const shortfall = breakdown ? breakdown.shortfallMinor : Math.max(0, totalMinor - tendered);

      if (shortfall > 0 && !forcePending) {
        if (!assignedMemberId) {
          setError(true);
          setMessage(`Faltan ${formatMoney(shortfall)} MXN. Para asignar saldo pendiente debes asignar un socio en el Paso 1 (Carrito).`);
          return;
        }
        setIsPendingModalOpen(true);
        return;
      }

      if (shortfall > 0) {
        const result = transact<CustomTransactionResult>(current => {
          if (current.revision !== review.revision) {
            return {
              state: current,
              result: {
                status: 'error' as const,
                message: 'Los registros cambiaron. Revisa la compra de nuevo.',
              },
            };
          }
          const currentQuote = cartQuote(current, lines);
          if (!currentQuote) {
            return {
              state: current,
              result: { status: 'error' as const, message: 'Revisa productos.' },
            };
          }
          for (const line of currentQuote.lines) {
            const available = expectedStock(current, line.productId);
            if (line.quantity > available) {
              const product = current.products.find(p => p.id === line.productId);
              return {
                state: current,
                result: {
                  status: 'error' as const,
                  message: `Existencia insuficiente para ${product?.name ?? 'producto'}. Disponible: ${available}.`,
                },
              };
            }
          }
          const recordedAt = new Date().toISOString();
          const sales: Sale[] = currentQuote.lines.map((line, index) => ({
            ...line,
            id: `${review.id}:line:${index}`,
            cartId: review.id,
            kind: 'product' as const,
            method: 'cash' as PaymentMethod,
            status: 'pending' as const,
            shiftId: current.currentShiftId,
            recordedAt,
            memberId: assignedMemberId,
            memberName: assignedMember?.name,
            isOvertime: breakdown?.isOvertime,
            is_overtime: breakdown?.isOvertime,
          }));

          const ledger: LedgerEvent[] = [];
          if (tendered > 0) {
            ledger.push({
              id: `sale-event-${review.id}:cash`,
              paymentId: review.id,
              shiftId: current.currentShiftId,
              kind: 'product' as const,
              amountMinor: tendered,
              method: 'cash',
              recordedAt,
            });
          }

          const updatedMembers = assignedMemberId
            ? current.members.map(m =>
                m.id === assignedMemberId
                  ? { ...m, creditMinor: m.creditMinor - shortfall }
                  : m
              )
            : current.members;

          const movements = currentQuote.lines.map(line => ({
            id: `sale-stock-${review.id}:${line.productId}`,
            productId: line.productId,
            shiftId: current.currentShiftId,
            kind: 'sale' as const,
            quantity: line.quantity,
            recordedAt,
          }));

          return {
            state: {
              ...current,
              revision: current.revision + 1,
              sales: [...current.sales, ...sales],
              ledger: [...current.ledger, ...ledger],
              stockMovements: [...current.stockMovements, ...movements],
              members: updatedMembers,
            },
            result: {
              status: 'pending' as const,
              sales,
            },
          };
        });

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
        } else {
          setPending(false);
          const successMsg = `Cobro registrado: ${formatMoney(tendered)} MXN cobrados en efectivo y ${formatMoney(shortfall)} MXN asignados como saldo pendiente a ${assignedMember?.name}.`;
          setMessage(successMsg);
          setQuantities({});
          setTenderedAmount('');
          setSelectedMethods([]);
          cartId.current = null;
          setToast({
            open: true,
            type: 'success',
            title: 'Cobro y saldo asignado',
            description: successMsg,
          });
        }
        return;
      }
    }

    const effectiveMethod: PaymentMethod = singleMethod;
    const result = transact(current =>
      current.revision !== review.revision
        ? {
            state: current,
            result: {
              status: 'error' as const,
              message: 'Los registros cambiaron. Revisa la compra de nuevo.',
            },
          }
        : registerCart(current, { id: review.id, method: effectiveMethod, lines, isOvertime: breakdown?.isOvertime })
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
      const successMsg = breakdown?.cardVoucher
        ? `Cobro con Tarjeta aprobado (${breakdown.cardVoucher.cardBrand} **** ${breakdown.cardVoucher.lastFourDigits} · Auth: ${breakdown.cardVoucher.authorizationCode}). Compra registrada.`
        : 'Cobro registrado. Compra completa registrada; lista para la siguiente compra.';
      setMessage(successMsg);
      setQuantities({});
      setTenderedAmount('');
      setMixedAmount1('');
      setMixedAmount2('');
      setSelectedMethods([]);
      cartId.current = null;
      setToast({
        open: true,
        type: 'success',
        title: 'Cobro confirmado',
        description: successMsg,
      });
    }
  };

  const selectedWasteItems: WasteItem[] = Object.entries(quantities)
    .filter(([_, qty]) => qty > 0)
    .map(([id, qty]) => {
      const product = state.products.find(p => p.id === id);
      return product ? { product, quantity: qty } : null;
    })
    .filter((item): item is WasteItem => Boolean(item));

  const effectiveWasteItems: WasteItem[] =
    selectedWasteItems.length > 0
      ? selectedWasteItems
      : selectedCatalogProductId
      ? [
          {
            product: state.products.find(p => p.id === selectedCatalogProductId)!,
            quantity: 1,
          },
        ].filter(i => Boolean(i.product))
      : [];

  const hasWasteItems = effectiveWasteItems.length > 0;

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
              <div className="catalog-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Button
                  variant="secondary"
                  className="catalog-devolucion-header-btn"
                  aria-label="Devoluciones"
                  disabled={pending}
                  onClick={() => setIsDevolucionesOpen(true)}
                  title="Registrar devolución de compras del día o servicios activos"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  <span>Devoluciones</span>
                </Button>
                <Button
                  variant="secondary"
                  className={`catalog-merma-header-btn ${hasWasteItems ? 'active-merma' : ''}`}
                  aria-label="Merma"
                  disabled={pending || !hasWasteItems}
                  onClick={() => setIsMermaOpen(true)}
                  title={
                    hasWasteItems
                      ? `Registrar merma para los productos seleccionados (${effectiveWasteItems.reduce((s, i) => s + i.quantity, 0)} uds)`
                      : 'Selecciona productos en el catálogo para registrar merma'
                  }
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                  <span>Merma</span>
                </Button>
              </div>
            </div>

            {state.products.length ? (
              <div className="product-grid">
                {state.products.map(product => {
                  const stock = expectedStock(state, product.id);
                  const currentQty = quantities[product.id] ?? 0;
                  return (
                    <ProductCard
                      key={product.id}
                      product={product}
                      stock={stock}
                      quantity={currentQty}
                      selected={selectedCatalogProductId === product.id}
                      disabled={pending}
                      onSelect={() => setSelectedCatalogProductId(product.id)}
                      onQuantityChange={quantity => {
                        setSelectedCatalogProductId(product.id);
                        changeQuantity(product.id, quantity);
                      }}
                    />
                  );
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
          disabled={pending}
          shiftWindow={currentShift?.window}
          currentTime={state.demoClock}
          assignedMember={assignedMember}
          onAssignMemberClick={() => setReview(null)}
          step={review ? 2 : 1}
          onStepChange={nextStep => {
            if (nextStep === 1) {
              setReview(null);
            } else if (nextStep === 2 && quote && quote.lines.length > 0) {
              cartId.current ??= `cart-${crypto.randomUUID()}`;
              setReview({
                id: cartId.current,
                revision: state.revision,
                totalMinor: quote.totalMinor,
              });
              setMessage('');
              setError(false);
            }
          }}
          step1ActionDisabled={!quote || quote.lines.length === 0 || pending}
          onStep1Proceed={() => {
            if (quote && quote.lines.length > 0) {
              cartId.current ??= `cart-${crypto.randomUUID()}`;
              setReview({
                id: cartId.current,
                revision: state.revision,
                totalMinor: quote.totalMinor,
              });
              setMessage('');
              setError(false);
            }
          }}
          onConfirmPayment={handleConfirmPayment}
          statusMessage={message}
          statusType={error ? 'error' : pending ? 'warning' : 'success'}
          memberAssignment={
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
          }
        >
          {/* Step 1 Content: Cart product lines */}
          <div className="cart-items-section">
            {!lines.length ? (
              <p className="cart-empty-msg">Sin productos seleccionados.</p>
            ) : (
              <ul className="cart-lines">
                {quote?.lines.map(line => (
                  <li key={line.productId} className="cart-line-row">
                    <div className="cart-line-top-row">
                      <span className="cart-line-title">{line.quantity} × {line.description}</span>
                      <strong className="cart-line-total">{formatMoney(line.amountMinor)} MXN</strong>
                    </div>
                    <div className="cart-line-bottom-row">
                      <span className="cart-line-unit muted">{formatMoney(line.unitPriceMinor)} c/u</span>
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
                    </div>
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
        items={effectiveWasteItems}
        products={state.products}
        state={state}
        onConfirmWaste={handleWasteMovement}
      />

      {/* Devoluciones Modal Dialog */}
      <DevolucionesModal
        isOpen={isDevolucionesOpen}
        onClose={() => setIsDevolucionesOpen(false)}
        state={state}
        initialMemberId={assignedMemberId}
        transact={transact}
        onSuccess={({ message }) => {
          setMessage(message);
          setError(false);
          setToast({
            open: true,
            type: 'success',
            title: 'Devolución registrada',
            description: message,
          });
        }}
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
