import { useEffect, useRef, useState } from 'react';
import {
  getActiveMembershipPlans,
  getCurrentRegisterShift,
  getRegisters,
  listRegisterMemberOpenDebts,
  submitMembershipCashSale,
  submitMembershipDebtPayment,
  submitMembershipTransferSale,
  type ActiveMembershipPlan,
  type AuthenticatedRequest,
  type CheckoutRegister,
  type CurrentRegisterShift,
  type MembershipDebtPaymentInput,
  type MembershipDebtPaymentReceipt,
  type MembershipSaleRequest,
  type MembershipTransferSaleRequest,
  type RegisterMemberOpenDebt,
} from '../../api/membershipCheckoutApi';
import { depositMemberCredit } from '../../api/memberCreditApi';
import { getMember } from '../../api/membersApi';
import { getMemberReceivables, recordRentalRepayment, type MemberReceivableItem } from '../../api/rentalsApi';
import { browserRequest } from '../../api/http';
import { refreshLocalRoster, markMemberRosterUncertain, clearMemberRosterUncertain } from '../../offline/flushManager';
import { Button, Notice } from '../../shared/ui';
import AnimatedList, { type AnimatedListEntry } from '../catalog/react-bits/AnimatedList';
import { CurrentPurchaseCard } from './CurrentPurchaseCard';
import './LiveMembershipCheckout.css';

export interface CheckoutMember {
  id: string;
  name: string;
}

export type CheckoutOperation = 'sale' | 'debt_payment';

type PaymentMethod = 'cash' | 'transfer';
interface SaleIntent {
  method: PaymentMethod;
  registerId: string;
  body: MembershipSaleRequest | MembershipTransferSaleRequest;
  idempotencyKey: string;
  /** Cash tendered above what was due that the member left as saldo a favor. */
  changeToCreditMinor?: number;
  rosterMarker?: string;
}

interface DebtPaymentIntent {
  registerId: string;
  body: MembershipDebtPaymentInput;
  idempotencyKey: string;
  changeToCreditMinor?: number;
  rosterMarker?: string;
}

/** A rental repayment: the endpoint takes one method per call, so saldo a favor and cash go as two calls. */
interface RentalRepaymentIntent {
  registerId: string;
  rentalId: string;
  creditMinor: number;
  cashMinor: number;
  /** The credit call already succeeded; a retry must send only the cash part. */
  creditDone: boolean;
}

interface ReceiptView {
  amountMinor: number;
  creditMinor: number;
  remainingMinor: number;
  footer: string;
}

function rentalLabel(item: MemberReceivableItem): string {
  return `Renta de ${item.kind === 'locker' ? 'casillero' : 'guantes'} ${item.asset_code}`;
}

const CREDIT_DEPOSIT_FAILED = 'El pago sí se registró, pero no se pudo depositar el saldo a favor. Puedes agregarlo desde el perfil del socio.';
const LOCAL_ROSTER_REFRESH_FAILED = 'La operación se registró, pero no se pudo actualizar la copia local de socios.';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatMoney(minor: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(minor / 100);
}

function currentVersion(plan: ActiveMembershipPlan): ActiveMembershipPlan['current_version'] {
  return plan.current_version;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function LiveMembershipCheckout({
  member,
  apiRequest,
  onClose,
  onCompleted,
  onSaleCompleted,
  initialOperation = 'sale',
  initialOrderId,
}: {
  member?: CheckoutMember | null;
  apiRequest?: AuthenticatedRequest;
  onClose: () => void;
  onCompleted?: () => void;
  onSaleCompleted?: () => void;
  initialOperation?: CheckoutOperation;
  initialOrderId?: string;
}) {
  const [operation, setOperation] = useState<CheckoutOperation>(initialOperation);
  const [selectedMember, setSelectedMember] = useState<CheckoutMember | null>(member ?? null);
  const [membersList, setMembersList] = useState<CheckoutMember[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [plans, setPlans] = useState<ActiveMembershipPlan[]>([]);
  const [registers, setRegisters] = useState<CheckoutRegister[]>([]);
  const [planId, setPlanId] = useState('');
  const [registerId, setRegisterId] = useState('');
  const [shift, setShift] = useState<CurrentRegisterShift | null>(null);
  const [cashAmount, setCashAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [unknownIntent, setUnknownIntent] = useState<SaleIntent | null>(null);
  const [result, setResult] = useState<{
    payment: Record<string, unknown>;
    membership: Record<string, unknown> | null;
    sample_entitlement?: Record<string, unknown> | null;
    credit_applied_minor?: number;
    method: PaymentMethod;
  } | null>(null);
  const [memberCreditMinor, setMemberCreditMinor] = useState(0);
  const [creditWarning, setCreditWarning] = useState('');

  const [openDebts, setOpenDebts] = useState<RegisterMemberOpenDebt[]>([]);
  const [debtsLoading, setDebtsLoading] = useState(false);
  const [selectedDebtOrderId, setSelectedDebtOrderId] = useState(initialOrderId ?? '');
  const [debtAmountMajor, setDebtAmountMajor] = useState('');
  const [unknownDebtIntent, setUnknownDebtIntent] = useState<DebtPaymentIntent | null>(null);
  const [debtReceipt, setDebtReceipt] = useState<MembershipDebtPaymentReceipt | null>(null);
  const debtIdempotencyMapRef = useRef<Record<string, string>>({});
  const [rentalDebts, setRentalDebts] = useState<MemberReceivableItem[]>([]);
  const [selectedRentalId, setSelectedRentalId] = useState('');
  const [pendingRentalIntent, setPendingRentalIntent] = useState<RentalRepaymentIntent | null>(null);
  const [rentalReceipt, setRentalReceipt] = useState<ReceiptView | null>(null);

  const submittingRef = useRef(false);

  function notifyCompleted() {
    onCompleted?.();
    onSaleCompleted?.();
  }

  // Sync prop member if changed
  useEffect(() => {
    if (member) setSelectedMember(member);
  }, [member]);

  // Load members for search if no member is selected
  useEffect(() => {
    if (!selectedMember) {
      let active = true;
      setLoadingMembers(true);
      const req = apiRequest ?? browserRequest;
      req('/api/v1/members?page=1&limit=100')
        .then(res => res.json())
        .then((data: { items?: { id: string; full_name?: string; name?: string }[] }) => {
          if (!active || !data?.items) return;
          const mapped = data.items.map(m => ({
            id: m.id,
            name: m.full_name ?? m.name ?? m.id,
          }));
          setMembersList(mapped);
        })
        .catch(() => { /* non-fatal, fallback to manual or typed search */ })
        .finally(() => { if (active) setLoadingMembers(false); });
      return () => { active = false; };
    }
  }, [selectedMember, apiRequest]);

  // Saldo a favor of the selected member; unknown balance simply hides the tick.
  const selectedMemberId = selectedMember?.id;
  async function loadMemberCredit(memberId: string | undefined, isActive: () => boolean = () => true) {
    let balance = 0;
    if (memberId) {
      try {
        const detail = await getMember(apiRequest ?? browserRequest, memberId);
        if (typeof detail?.credit_balance_minor === 'number') balance = detail.credit_balance_minor;
      } catch { /* non-fatal: no saldo a favor offered */ }
    }
    if (isActive()) setMemberCreditMinor(balance);
  }

  useEffect(() => {
    let active = true;
    void loadMemberCredit(selectedMemberId, () => active);
    return () => { active = false; };
  }, [selectedMemberId, apiRequest]);

  /** The payment is already recorded; a failed deposit must not look like a failed payment. */
  async function depositChange(registerIdValue: string, memberId: string, amountMinor: number | undefined) {
    if (!amountMinor || amountMinor <= 0) return;
    try {
      await depositMemberCredit(apiRequest ?? browserRequest, registerIdValue, { member_id: memberId, amount_minor: amountMinor }, crypto.randomUUID());
    } catch {
      setCreditWarning(CREDIT_DEPOSIT_FAILED);
    }
  }

  // Theme observer for AnimatedList
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.dataset.theme === 'dark' || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  });

  useEffect(() => {
    function syncTheme() {
      setDark(document.documentElement.dataset.theme === 'dark' || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false));
    }
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // Handle escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const selectedPlan = plans.find(plan => plan.id === planId);
  const version = selectedPlan ? currentVersion(selectedPlan) : null;
  const price = version && typeof version.price_minor === 'number' ? version.price_minor : null;
  const amountMinor = cashAmount.trim() ? Math.round(Number(cashAmount) * 100) : undefined;
  const amountInvalid = amountMinor !== undefined && (!Number.isFinite(Number(cashAmount)) || amountMinor <= 0 || (price !== null && amountMinor > price));
  const partialCash = amountMinor !== undefined && !amountInvalid && price !== null && amountMinor < price;

  // Load plans and registers
  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      apiRequest ? getActiveMembershipPlans(apiRequest) : getActiveMembershipPlans(),
      apiRequest ? getRegisters(apiRequest) : getRegisters(),
    ]).then(([activePlans, availableRegisters]) => {
      if (!active) return;
      const validPlans = activePlans.filter(plan => currentVersion(plan) && plan.status !== 'inactive' && plan.status !== 'archived');
      const selectableRegisters = availableRegisters.filter(
        register => register.has_open_shift || Boolean(register.last_closed_shift_id),
      );
      setPlans(validPlans);
      setRegisters(selectableRegisters);
      // Prefer a register with an open shift; fall back to a register ready for overtime sales.
      const preferred = selectableRegisters.find(register => register.has_open_shift) ?? selectableRegisters[0];
      if (preferred) {
        setRegisterId(preferred.id);
      }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los planes y cajas.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiRequest]);

  const selectedRegister = registers.find(register => register.id === registerId) ?? null;
  const overtimeSourceShiftId =
    selectedRegister && !selectedRegister.has_open_shift && typeof selectedRegister.last_closed_shift_id === 'string'
      ? selectedRegister.last_closed_shift_id
      : null;
  const canSubmitCashSale = Boolean(shift || overtimeSourceShiftId);
  // Undefined until an open register's shift lookup settles, so the clock fallback never flashes a false banner.
  const openShiftFlag = registerId && !shiftLoading ? Boolean(shift) : undefined;

  // Load shift when registerId is set and has an active open shift
  useEffect(() => {
    let active = true;
    setShift(null);
    if (!registerId || !selectedRegister?.has_open_shift) {
      setShiftLoading(false);
      return () => { active = false; };
    }
    setShiftLoading(true);
    void (apiRequest ? getCurrentRegisterShift(registerId, apiRequest) : getCurrentRegisterShift(registerId)).then(value => {
      if (active && value.cash_register_id === registerId) setShift(value);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'No se pudo consultar el turno abierto.');
    }).finally(() => { if (active) setShiftLoading(false); });
    return () => { active = false; };
  }, [registerId, selectedRegister?.has_open_shift, apiRequest]);

  // Load open debts whenever registerId + selectedMember are set
  useEffect(() => {
    let active = true;
    if (!registerId || !selectedMember) {
      setOpenDebts([]);
      setRentalDebts([]);
      return () => { active = false; };
    }
    setDebtsLoading(true);
    setError('');
    const branchId = registers.find(r => r.id === registerId)?.branch_id;
    // Rental receivables are best effort: a failure keeps the membership debts usable.
    const rentalsRequest = typeof branchId === 'string'
      ? getMemberReceivables(apiRequest ?? browserRequest, selectedMember.id, branchId)
          .then(page => page.items.filter(item => item.outstanding_minor > 0))
          .catch(() => [] as MemberReceivableItem[])
      : Promise.resolve([] as MemberReceivableItem[]);
    void Promise.all([
      apiRequest
        ? listRegisterMemberOpenDebts(registerId, selectedMember.id, apiRequest)
        : listRegisterMemberOpenDebts(registerId, selectedMember.id),
      rentalsRequest,
    ]).then(([items, rentals]) => {
      if (!active) return;
      setOpenDebts(items);
      setRentalDebts(rentals);
      const preferred = (initialOrderId && items.find(d => d.order_id === initialOrderId)) || items[0];
      setSelectedRentalId('');
      if (preferred) {
        setSelectedDebtOrderId(preferred.order_id);
        setDebtAmountMajor((preferred.remaining_balance_minor / 100).toFixed(2));
      } else if (rentals[0]) {
        setSelectedDebtOrderId('');
        setSelectedRentalId(rentals[0].payment_id);
        setDebtAmountMajor((rentals[0].outstanding_minor / 100).toFixed(2));
      } else {
        setSelectedDebtOrderId('');
        setDebtAmountMajor('');
      }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los adeudos pendientes.');
    }).finally(() => { if (active) setDebtsLoading(false); });
    return () => { active = false; };
  }, [registerId, registers, selectedMember, initialOrderId, apiRequest]);

  const selectedRental = rentalDebts.find(r => r.payment_id === selectedRentalId) ?? null;
  const selectedDebt = selectedRental ? null : openDebts.find(d => d.order_id === selectedDebtOrderId) ?? null;
  const hasDebtTarget = selectedDebt !== null || selectedRental !== null;
  const owedMinor = selectedRental ? selectedRental.outstanding_minor : selectedDebt ? selectedDebt.remaining_balance_minor : null;
  const rawDebtNumber = Number(debtAmountMajor);
  const parsedDebtMinor = debtAmountMajor.trim() ? Math.round(rawDebtNumber * 100) : 0;
  const debtAmountInvalid =
    !debtAmountMajor.trim() ||
    !Number.isFinite(rawDebtNumber) ||
    !Number.isSafeInteger(parsedDebtMinor) ||
    parsedDebtMinor <= 0 ||
    (owedMinor !== null && parsedDebtMinor > owedMinor);

  /** Index into the combined list: membership debts first, then rental receivables. */
  function selectDebtEntry(idx: number) {
    if (pendingRentalIntent) return;
    if (idx < openDebts.length) {
      setSelectedRentalId('');
      setSelectedDebtOrderId(openDebts[idx].order_id);
      setDebtAmountMajor((openDebts[idx].remaining_balance_minor / 100).toFixed(2));
    } else if (rentalDebts[idx - openDebts.length]) {
      const rental = rentalDebts[idx - openDebts.length];
      setSelectedDebtOrderId('');
      setSelectedRentalId(rental.payment_id);
      setDebtAmountMajor((rental.outstanding_minor / 100).toFixed(2));
    }
  }

  function getStableDebtIdempotencyKey(regId: string, orderId: string, minor: number, creditMinor = 0): string {
    const fingerprint = `${regId}:${orderId}:${minor}:${creditMinor}`;
    if (!debtIdempotencyMapRef.current[fingerprint]) {
      debtIdempotencyMapRef.current[fingerprint] = crypto.randomUUID();
    }
    return debtIdempotencyMapRef.current[fingerprint];
  }

  async function sendDebtPayment(intent: DebtPaymentIntent) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      intent.rosterMarker ??= await markMemberRosterUncertain(selectedMemberId ?? '').catch(() => undefined);
      const receipt = await (apiRequest
        ? submitMembershipDebtPayment(intent.registerId, intent.body, intent.idempotencyKey, apiRequest)
        : submitMembershipDebtPayment(intent.registerId, intent.body, intent.idempotencyKey));
      setUnknownDebtIntent(null);
      try {
        const refreshed = await refreshLocalRoster();
        if (refreshed) {
          if (intent.rosterMarker) {
            await clearMemberRosterUncertain(receipt.member_id, intent.rosterMarker).catch(() => setCreditWarning(LOCAL_ROSTER_REFRESH_FAILED));
          }
        } else {
          setCreditWarning(LOCAL_ROSTER_REFRESH_FAILED);
        }
      } catch {
        setCreditWarning(LOCAL_ROSTER_REFRESH_FAILED);
      }
      await depositChange(intent.registerId, receipt.member_id, intent.changeToCreditMinor);
      void loadMemberCredit(selectedMemberId);
      setDebtReceipt(receipt);
      notifyCompleted();
    } catch (reason) {
      if (isObject(reason) && reason.kind === 'network') {
        setUnknownDebtIntent(intent);
        setError('No se pudo confirmar si el servidor registró el abono. Conservamos la misma solicitud; reintentala para consultar el resultado sin duplicar el cobro.');
      } else {
        if (intent.rosterMarker && selectedMemberId) await clearMemberRosterUncertain(selectedMemberId, intent.rosterMarker).catch(() => {});
        setUnknownDebtIntent(null);
        setError(reason instanceof Error ? reason.message : 'No se pudo registrar el abono del adeudo.');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function sendRentalPayment(intent: RentalRepaymentIntent) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    let creditDone = intent.creditDone;
    try {
      const call = (method: 'credit' | 'cash', amountMinor: number, key: string) => recordRentalRepayment(
        apiRequest ?? browserRequest,
        intent.rentalId,
        { register_id: intent.registerId, method, amount_minor: amountMinor },
        key,
      );
      let last;
      if (intent.creditMinor > 0 && !creditDone) {
        last = await call('credit', intent.creditMinor, getStableDebtIdempotencyKey(intent.registerId, `rental-credit:${intent.rentalId}`, intent.creditMinor));
        creditDone = true;
      }
      if (intent.cashMinor > 0) {
        last = await call('cash', intent.cashMinor, getStableDebtIdempotencyKey(intent.registerId, `rental-cash:${intent.rentalId}`, intent.cashMinor));
      }
      setPendingRentalIntent(null);
      try {
        const refreshed = await refreshLocalRoster();
        if (!refreshed) {
          setCreditWarning(LOCAL_ROSTER_REFRESH_FAILED);
        }
      } catch {
        setCreditWarning(LOCAL_ROSTER_REFRESH_FAILED);
      }
      void loadMemberCredit(selectedMemberId);
      setRentalReceipt({
        amountMinor: intent.creditMinor + intent.cashMinor,
        creditMinor: intent.creditMinor,
        remainingMinor: last?.remaining_minor ?? 0,
        footer: selectedRental ? rentalLabel(selectedRental) : 'Renta',
      });
      notifyCompleted();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'No se pudo registrar el abono de la renta.';
      if (creditDone && intent.creditMinor > 0) {
        // Credit is already spent; keep only the cash part pending so a retry never re-sends it.
        setPendingRentalIntent({ ...intent, creditDone: true });
        setError(`El saldo a favor (${formatMoney(intent.creditMinor)}) sí se aplicó; solo falta el efectivo (${formatMoney(intent.cashMinor)}). Reintenta el cobro en efectivo. ${message}`);
      } else if (isObject(reason) && reason.kind === 'network') {
        setPendingRentalIntent(intent);
        setError('No se pudo confirmar si el servidor registró el abono. Conservamos la misma solicitud; reintentala para consultar el resultado sin duplicar el cobro.');
      } else {
        setPendingRentalIntent(null);
        setError(message);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function submitDebtPayment() {
    if (pendingRentalIntent) { void sendRentalPayment(pendingRentalIntent); return; }
    if (selectedRental) {
      if (!registerId || !shift || debtAmountInvalid || submittingRef.current) return;
      void sendRentalPayment({ registerId, rentalId: selectedRental.rental_id, creditMinor: 0, cashMinor: parsedDebtMinor, creditDone: false });
      return;
    }
    if (!selectedMember || !registerId || !shift || !selectedDebt || debtAmountInvalid || submittingRef.current) return;
    const idempotencyKey = getStableDebtIdempotencyKey(registerId, selectedDebt.order_id, parsedDebtMinor);
    void sendDebtPayment({
      registerId,
      body: { order_id: selectedDebt.order_id, amount_minor: parsedDebtMinor },
      idempotencyKey,
    });
  }

  async function send(intent: SaleIntent) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      intent.rosterMarker ??= await markMemberRosterUncertain(intent.body.member_id).catch(() => undefined);
      const response = intent.method === 'cash'
        ? await (apiRequest
            ? submitMembershipCashSale(intent.registerId, intent.body as MembershipSaleRequest, intent.idempotencyKey, apiRequest)
            : submitMembershipCashSale(intent.registerId, intent.body as MembershipSaleRequest, intent.idempotencyKey))
        : await (apiRequest
            ? submitMembershipTransferSale(intent.registerId, intent.body as MembershipTransferSaleRequest, intent.idempotencyKey, apiRequest)
            : submitMembershipTransferSale(intent.registerId, intent.body as MembershipTransferSaleRequest, intent.idempotencyKey));
      setUnknownIntent(null);
      try {
        const refreshed = await refreshLocalRoster();
        if (refreshed) {
          if (intent.rosterMarker) {
            await clearMemberRosterUncertain(intent.body.member_id, intent.rosterMarker).catch(() => setCreditWarning(LOCAL_ROSTER_REFRESH_FAILED));
          }
        } else {
          setCreditWarning(LOCAL_ROSTER_REFRESH_FAILED);
        }
      } catch {
        setCreditWarning(LOCAL_ROSTER_REFRESH_FAILED);
      }
      await depositChange(intent.registerId, intent.body.member_id, intent.changeToCreditMinor);
      void loadMemberCredit(selectedMemberId);
      setResult({
        payment: response.payment,
        membership: response.membership,
        sample_entitlement: response.sample_entitlement,
        credit_applied_minor: response.credit_applied_minor,
        method: intent.method,
      });
      notifyCompleted();
    } catch (reason) {
      if (isObject(reason) && reason.kind === 'network') {
        setUnknownIntent(intent);
        setError('No se pudo confirmar si el servidor registró la venta. Conservamos la misma solicitud; reintentala para consultar el resultado sin crear otra intención.');
      } else {
        if (intent.rosterMarker) await clearMemberRosterUncertain(intent.body.member_id, intent.rosterMarker).catch(() => {});
        setUnknownIntent(null);
        setError(reason instanceof Error ? reason.message : 'No se pudo registrar la venta.');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function submit(method: PaymentMethod, overrideCashAmountMinor?: number, creditMinor = 0, changeToCreditMinor = 0) {
    if (method !== 'cash' && !shift && overtimeSourceShiftId) {
      setError('En overtime solo están permitidos los cobros de membresía en efectivo.');
      return;
    }
    const methodShiftReady = method === 'cash' ? canSubmitCashSale : Boolean(shift);
    if (!selectedMember || !version || !registerId || !methodShiftReady || amountInvalid || submittingRef.current) return;
    let finalAmountMinor = overrideCashAmountMinor !== undefined ? overrideCashAmountMinor : amountMinor;
    if (price !== null && finalAmountMinor !== undefined) {
      // Cash only covers what credit leaves (tender above it is change); the backend rejects a cash part of zero or above that.
      finalAmountMinor = Math.min(finalAmountMinor, price - creditMinor);
      if (creditMinor > 0 && finalAmountMinor <= 0) finalAmountMinor = undefined;
    }
    if (method === 'cash' && finalAmountMinor !== undefined && !Number.isSafeInteger(finalAmountMinor)) {
      setError('Ingresá un monto válido en pesos.');
      return;
    }
    const common = {
      member_id: selectedMember.id,
      plan_version_id: version.id,
      ...(creditMinor > 0 ? { credit_minor: creditMinor } : {}),
    };
    const body: MembershipSaleRequest | MembershipTransferSaleRequest = method === 'cash'
      ? {
          ...common,
          ...(!shift && overtimeSourceShiftId ? { source_shift_id: overtimeSourceShiftId } : {}),
          ...(finalAmountMinor !== undefined ? { cash_amount_minor: finalAmountMinor } : {}),
        }
      : common;
    void send({ method, registerId, body, idempotencyKey: crypto.randomUUID(), changeToCreditMinor });
  }

  const paymentStatus = result?.payment.status;
  const paymentConfirmed = paymentStatus === 'confirmed';

  // Filtered members for search
  const filteredMembers = membersList.filter(m =>
    !memberQuery || m.name.toLowerCase().includes(memberQuery.trim().toLowerCase())
  );

  // AnimatedList entries for plans
  const planEntries: AnimatedListEntry[] = plans.map(p => {
    const v = currentVersion(p);
    const durationStr = v?.duration_value
      ? `Duración: ${String(v.duration_value)} ${String(v.duration_unit) === 'months' ? 'mes(es)' : 'días'}`
      : undefined;
    const priceStr = v && typeof v.price_minor === 'number' ? `${formatMoney(v.price_minor)} MXN` : undefined;
    return {
      id: p.id,
      title: String(p.name ?? v?.name ?? p.id),
      description: durationStr,
      meta: priceStr,
    };
  });

  const selectedPlanIndex = plans.findIndex(p => p.id === planId);

  // AnimatedList entries for debts
  const debtEntries: AnimatedListEntry[] = [
    ...openDebts.map(d => ({
      id: d.order_id,
      title: d.description_snapshot,
      description: `Pedido ${d.order_id.slice(0, 8)}… · Adeudo inicial: ${formatMoney(d.initial_outstanding_minor)} MXN`,
      meta: `Resta: ${formatMoney(d.remaining_balance_minor)} MXN`,
    })),
    ...rentalDebts.map(r => ({
      id: r.payment_id,
      title: rentalLabel(r),
      description: `Adeudo inicial: ${formatMoney(r.amount_minor)} MXN`,
      meta: `Resta: ${formatMoney(r.outstanding_minor)} MXN`,
    })),
  ];

  const selectedDebtIndex = selectedRental
    ? openDebts.length + rentalDebts.findIndex(r => r.payment_id === selectedRentalId)
    : openDebts.findIndex(d => d.order_id === selectedDebtOrderId);

  const receipt: ReceiptView | null = debtReceipt
    ? {
        amountMinor: debtReceipt.amount_minor,
        creditMinor: debtReceipt.credit_minor ?? 0,
        remainingMinor: debtReceipt.remaining_balance_minor,
        footer: `Recibo: ${debtReceipt.id} · Turno: ${debtReceipt.shift_id}`,
      }
    : rentalReceipt;

  // Debt repayment receipt dialog
  if (receipt) {
    return (
      <div
        className="membership-checkout-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="membership-checkout-modal-card" style={{ maxWidth: '580px', textAlign: 'center', alignItems: 'center' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#DCFCE7', color: '#166534', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', margin: '0 auto' }}>
            ✓
          </div>
          <h3 id="checkout-title" style={{ margin: '8px 0', fontSize: '20px' }}>Abono registrado</h3>
          <p role="status">
            {receipt.creditMinor > 0
              ? `Abono confirmado por ${formatMoney(receipt.amountMinor)}, de los cuales ${formatMoney(receipt.creditMinor)} con saldo a favor.`
              : `Abono en efectivo confirmado por ${formatMoney(receipt.amountMinor)}.`}
          </p>
          {creditWarning && <p role="alert">{creditWarning}</p>}
          <p>
            Saldo restante del pedido: {formatMoney(receipt.remainingMinor)} MXN
            {receipt.remainingMinor === 0 ? ' · Adeudo liquidado en su totalidad.' : ''}
          </p>
          <p className="muted" style={{ fontSize: '13px' }}>
            {receipt.footer}
          </p>
          <Button onClick={onClose} style={{ marginTop: '16px' }}>Cerrar</Button>
        </div>
      </div>
    );
  }

  // Result dialog
  if (result) {
    return (
      <div
        className="membership-checkout-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="membership-checkout-modal-card" style={{ maxWidth: '580px', textAlign: 'center', alignItems: 'center' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#DCFCE7', color: '#166534', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', margin: '0 auto' }}>
            ✓
          </div>
          <h3 id="checkout-title" style={{ margin: '8px 0', fontSize: '20px' }}>Resultado de la venta</h3>
          {result.method === 'transfer' ? (
            <p role="status">Transferencia pendiente de revisión{typeof paymentStatus === 'string' ? ` (${paymentStatus})` : ''}. No está confirmada ni liquidada.</p>
          ) : (
            <p role="status">{paymentConfirmed ? 'Pago confirmado.' : `Estado del pago: ${typeof paymentStatus === 'string' ? paymentStatus : 'sin estado informado'}.`}</p>
          )}
          {result.membership ? (
            <p>{typeof result.membership.starts_on === 'string' && typeof result.membership.ends_on === 'string'
              ? `Membresía activada por el backend: ${result.membership.starts_on} a ${result.membership.ends_on}.`
              : 'El backend devolvió un periodo de membresía.'}</p>
          ) : result.sample_entitlement ? (
            <p>Acceso de clase de muestra activado por el backend.</p>
          ) : (
            <p>Sin periodo de membresía devuelto; no se informa activación.</p>
          )}
          {(result.credit_applied_minor ?? 0) > 0 && (
            <p>Saldo a favor aplicado: {formatMoney(result.credit_applied_minor ?? 0)}.</p>
          )}
          {creditWarning && <p role="alert">{creditWarning}</p>}
          <Button onClick={onClose} style={{ marginTop: '16px' }}>Cerrar</Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="membership-checkout-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-title"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="membership-checkout-modal-card">
        {/* Modal Header */}
        <div className="membership-checkout-modal-header">
          <div>
            <h3 id="checkout-title">
              {operation === 'debt_payment'
                ? `Liquidar adeudo · ${selectedMember?.name ?? 'Seleccionar socio'}`
                : `Venta de membresía · ${selectedMember?.name ?? 'Seleccionar socio'}`}
            </h3>
            <p>
              {operation === 'debt_payment'
                ? 'Selecciona el pedido con saldo pendiente en esta sucursal y registra el abono en efectivo.'
                : 'Selecciona el socio beneficiario, el plan comercial y confirma el cobro.'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Button
              type="button"
              variant={operation === 'sale' ? 'primary' : 'secondary'}
              className="button-sm"
              onClick={() => { setOperation('sale'); setError(''); }}
              disabled={submitting || Boolean(unknownIntent) || Boolean(unknownDebtIntent)}
            >
              Vender membresía
            </Button>
            <Button
              type="button"
              variant={operation === 'debt_payment' ? 'primary' : 'secondary'}
              className="button-sm"
              onClick={() => { setOperation('debt_payment'); setError(''); }}
              disabled={submitting || Boolean(unknownIntent) || Boolean(unknownDebtIntent) || Boolean(pendingRentalIntent) || Boolean(!shift && overtimeSourceShiftId) || (Boolean(selectedMember) && !debtsLoading && debtEntries.length === 0)}
              title={!shift && overtimeSourceShiftId ? 'Los abonos a adeudos requieren un turno abierto' : Boolean(selectedMember) && !debtsLoading && debtEntries.length === 0 ? 'El socio no tiene adeudos pendientes' : undefined}
            >
              Liquidar adeudo
            </Button>
            <button
              type="button"
              className="membership-checkout-close-btn"
              aria-label="Cerrar modal de venta de membresía"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {operation === 'debt_payment' ? (
          <div className="membership-checkout-grid">
            {/* Left Column: Member selection & Debt selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* 1. Socio beneficiario */}
              <div>
                <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-ink)', display: 'block', marginBottom: '8px' }}>
                  1. Socio beneficiario
                </span>
                {selectedMember ? (
                  <div className="membership-member-badge">
                    <div className="membership-member-avatar">{getInitials(selectedMember.name)}</div>
                    <div style={{ flex: 1 }}>
                      <strong>{selectedMember.name}</strong>
                      <span className="muted" style={{ display: 'block', fontSize: '12px' }}>Socio activo en sistema</span>
                    </div>
                    <Button
                      variant="secondary"
                      className="button-sm"
                      type="button"
                      onClick={() => {
                        setSelectedMember(null);
                        setSelectedDebtOrderId('');
                        setOpenDebts([]);
                      }}
                    >
                      Cambiar socio
                    </Button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Buscar socio por nombre..."
                      value={memberQuery}
                      onChange={e => setMemberQuery(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        border: '1px solid var(--color-divider)',
                        background: 'var(--color-surface)',
                        color: 'var(--color-ink)',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', border: '1px solid var(--color-divider)', borderRadius: '10px', padding: '6px', background: 'var(--color-surface)' }}>
                      {filteredMembers.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => { setSelectedMember(m); setMemberQuery(''); }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 10px',
                            borderRadius: '6px',
                            border: 'none',
                            background: 'transparent',
                            textAlign: 'left',
                            cursor: 'pointer',
                            transition: 'background 100ms ease',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-canvas)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-ink)' }}>{m.name}</span>
                          <span className="muted" style={{ fontSize: '11px' }}>{m.id.slice(0, 8)}…</span>
                        </button>
                      ))}
                      {filteredMembers.length === 0 && (
                        <p className="muted" style={{ fontSize: '12px', padding: '6px 8px', margin: 0 }}>
                          {loadingMembers ? 'Cargando socios…' : 'No hay socios que coincidan.'}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Adeudo pendiente */}
              <div>
                <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-ink)', display: 'block', marginBottom: '8px' }}>
                  2. Adeudo pendiente
                </span>
                <label htmlFor="checkout-debt-order" style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>
                  Adeudo pendiente
                </label>
                {!selectedMember ? (
                  <p className="muted">Selecciona primero un socio para consultar sus adeudos pendientes.</p>
                ) : debtsLoading ? (
                  <p role="status" className="muted">Cargando adeudos pendientes…</p>
                ) : debtEntries.length === 0 ? (
                  <p role="status" className="muted">No hay adeudos pendientes en esta sucursal para este socio.</p>
                ) : (
                  <>
                    <AnimatedList
                      items={debtEntries}
                      selectedIndex={selectedDebtIndex >= 0 ? selectedDebtIndex : undefined}
                      onSelectedIndexChange={selectDebtEntry}
                      onItemSelect={(_item, idx) => selectDebtEntry(idx)}
                      accentColor="#FC6C06"
                      theme={dark ? 'dark' : 'light'}
                      animation="pop"
                      maxHeight={260}
                      width="100%"
                    />
                    <select
                      id="checkout-debt-order"
                      value={selectedRental ? selectedRental.payment_id : selectedDebtOrderId}
                      onChange={e => selectDebtEntry(debtEntries.findIndex(entry => entry.id === e.target.value))}
                      disabled={Boolean(unknownDebtIntent) || submitting}
                      style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}
                    >
                      {openDebts.map(debt => (
                        <option key={debt.order_id} value={debt.order_id}>
                          {debt.description_snapshot} · Pedido {debt.order_id.slice(0, 8)} · Restante {formatMoney(debt.remaining_balance_minor)}
                        </option>
                      ))}
                      {rentalDebts.map(rental => (
                        <option key={rental.payment_id} value={rental.payment_id}>
                          {rentalLabel(rental)} · Restante {formatMoney(rental.outstanding_minor)}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>

              {hasDebtTarget && owedMinor !== null && debtAmountMajor.trim() !== '' && debtAmountInvalid && (
                <p role="alert" style={{ marginTop: '6px', color: 'var(--color-danger, #b91c1c)', fontSize: '13px' }}>
                  El abono en efectivo debe ser mayor a cero y no superar el saldo pendiente ({formatMoney(owedMinor)}).
                </p>
              )}

              {error && <Notice tone="error">{error}</Notice>}
            </div>

            {/* Right Column: CurrentPurchaseCard for debt payment */}
            <div className="guantes-sidebar-column">
              <CurrentPurchaseCard
                className="current-purchase-card--modal"
                title="Cobro de adeudo"
                hasOpenShift={openShiftFlag}
                step1Title="Adeudo"
                step2Title="Cobro"
                totalMinor={owedMinor !== null ? (parsedDebtMinor > 0 && !debtAmountInvalid ? parsedDebtMinor : owedMinor) : 0}
                allowCredit
                assignedMember={selectedMember ? { id: selectedMember.id, name: selectedMember.name, creditMinor: memberCreditMinor } : null}
                step1ActionDisabled={!selectedMember || !hasDebtTarget || !registerId || !shift || debtAmountInvalid || debtsLoading || shiftLoading || submitting}
                step1ActionLabel={
                  !selectedMember
                    ? 'Selecciona un socio beneficiario'
                    : owedMinor === null
                    ? 'Selecciona un adeudo'
                    : `Proceder al cobro · ${formatMoney(parsedDebtMinor > 0 && !debtAmountInvalid ? parsedDebtMinor : owedMinor)} MXN →`
                }
                confirmActionLabel="Registrar abono en efectivo"
                statusMessage={error}
                statusType={error ? 'error' : 'success'}
                onConfirmPayment={breakdown => {
                  const credit = breakdown.creditAppliedMinor ?? 0;
                  const changeToCredit = breakdown.changeToCreditMinor ?? 0;
                  // The abono is the credit part plus the cash that stays on the debt (change left as credit does not).
                  const paid = credit + (breakdown.tenderedMinor ?? 0) - changeToCredit;
                  if (pendingRentalIntent) {
                    void sendRentalPayment(pendingRentalIntent);
                    return;
                  }
                  if (selectedRental && paid > 0 && paid <= selectedRental.outstanding_minor) {
                    void sendRentalPayment({ registerId, rentalId: selectedRental.rental_id, creditMinor: credit, cashMinor: paid - credit, creditDone: false });
                    return;
                  }
                  if (paid > 0 && selectedDebt && paid <= selectedDebt.remaining_balance_minor) {
                    const idempotencyKey = getStableDebtIdempotencyKey(registerId, selectedDebt.order_id, paid, credit);
                    void sendDebtPayment({
                      registerId,
                      body: { order_id: selectedDebt.order_id, amount_minor: paid, ...(credit > 0 ? { credit_minor: credit } : {}) },
                      idempotencyKey,
                      changeToCreditMinor: changeToCredit,
                    });
                    return;
                  }
                  submitDebtPayment();
                }}
              >
                <div className="modal-cart-section">
                  <h4 className="modal-cart-section-title">Resumen del adeudo</h4>
                  <div className="guantes-spec-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="muted">Socio:</span>
                      <strong>{selectedMember?.name ?? 'Sin seleccionar'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="muted">Concepto:</span>
                      <strong>{selectedRental ? rentalLabel(selectedRental) : selectedDebt?.description_snapshot ?? 'Sin seleccionar'}</strong>
                    </div>
                    {(selectedDebt || selectedRental) && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="muted">Adeudo inicial:</span>
                          <span>{formatMoney(selectedRental ? selectedRental.amount_minor : selectedDebt?.initial_outstanding_minor ?? 0)} MXN</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="muted">Abonado previamente:</span>
                          <span>{formatMoney(selectedRental ? selectedRental.settled_minor : selectedDebt?.paid_amount_minor ?? 0)} MXN</span>
                        </div>
                      </>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-divider)', paddingTop: '6px' }}>
                      <span className="muted">Saldo pendiente:</span>
                      <strong style={{ color: 'var(--color-primary-ink)', fontSize: '15px' }}>
                        {owedMinor !== null ? `${formatMoney(owedMinor)} MXN` : '$0.00 MXN'}
                      </strong>
                    </div>
                    {owedMinor !== null && parsedDebtMinor > 0 && parsedDebtMinor < owedMinor && !debtAmountInvalid && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--color-divider)', paddingTop: '6px' }}>
                        <span className="muted">Abono a registrar:</span>
                        <strong style={{ color: '#166534', fontSize: '14px' }}>
                          {formatMoney(parsedDebtMinor)} MXN
                        </strong>
                      </div>
                    )}
                  </div>
                </div>
              </CurrentPurchaseCard>
            </div>

            {/* Visually-hidden accessible elements for headless/form contracts and tests */}
            <div style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>
              <label htmlFor="checkout-debt-amount">Monto a abonar (MXN)</label>
              <input
                id="checkout-debt-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={debtAmountMajor}
                onChange={e => setDebtAmountMajor(e.target.value)}
                disabled={Boolean(unknownDebtIntent) || Boolean(pendingRentalIntent) || submitting || !hasDebtTarget}
              />
              <button
                type="button"
                onClick={submitDebtPayment}
                disabled={loading || debtsLoading || shiftLoading || submitting || !selectedMember || !registerId || !shift || !hasDebtTarget || (debtAmountInvalid && !pendingRentalIntent)}
              >
                Registrar abono en efectivo
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 2-Column Grid */}
            <div className="membership-checkout-grid">
              {/* Left Column: ONLY Member & Plan Selection */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* 1. Socio beneficiario */}
                <div>
                  <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-ink)', display: 'block', marginBottom: '8px' }}>
                    1. Socio beneficiario
                  </span>
                  {selectedMember ? (
                    <div className="membership-member-badge">
                      <div className="membership-member-avatar">{getInitials(selectedMember.name)}</div>
                      <div style={{ flex: 1 }}>
                        <strong>{selectedMember.name}</strong>
                        <span className="muted" style={{ display: 'block', fontSize: '12px' }}>ID: {selectedMember.id}</span>
                      </div>
                      <Button
                        variant="secondary"
                        className="button-sm"
                        type="button"
                        onClick={() => setSelectedMember(null)}
                      >
                        Cambiar socio
                      </Button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <input
                        type="text"
                        placeholder="Buscar socio por nombre..."
                        value={memberQuery}
                        onChange={e => setMemberQuery(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: '10px',
                          border: '1px solid var(--color-divider)',
                          background: 'var(--color-surface)',
                          color: 'var(--color-ink)',
                          fontSize: '14px',
                          boxSizing: 'border-box',
                        }}
                      />
                      <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', border: '1px solid var(--color-divider)', borderRadius: '10px', padding: '6px', background: 'var(--color-surface)' }}>
                        {filteredMembers.map(m => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => { setSelectedMember(m); setMemberQuery(''); }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 10px',
                              borderRadius: '6px',
                              border: 'none',
                              background: 'transparent',
                              textAlign: 'left',
                              cursor: 'pointer',
                              transition: 'background 100ms ease',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-canvas)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-ink)' }}>{m.name}</span>
                            <span className="muted" style={{ fontSize: '11px' }}>{m.id.slice(0, 8)}…</span>
                          </button>
                        ))}
                        {filteredMembers.length === 0 && (
                          <p className="muted" style={{ fontSize: '12px', padding: '6px 8px', margin: 0 }}>
                            {loadingMembers ? 'Cargando socios…' : 'No hay socios que coincidan.'}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Plan de membresía with AnimatedList */}
                <div>
                  <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-ink)', display: 'block', marginBottom: '8px' }}>
                    2. Plan de membresía
                  </span>
                  {loading ? (
                    <p role="status" className="muted">Cargando planes del catálogo…</p>
                  ) : plans.length === 0 ? (
                    <p className="muted">No hay planes activos publicados.</p>
                  ) : (
                    <AnimatedList
                      items={planEntries}
                      selectedIndex={selectedPlanIndex >= 0 ? selectedPlanIndex : undefined}
                      onSelectedIndexChange={idx => {
                        if (plans[idx]) setPlanId(plans[idx].id);
                      }}
                      onItemSelect={(_item, idx) => {
                        if (plans[idx]) setPlanId(plans[idx].id);
                      }}
                      accentColor="#FC6C06"
                      theme={dark ? 'dark' : 'light'}
                      animation="pop"
                      maxHeight={260}
                      width="100%"
                    />
                  )}
                  {version && price !== null && (
                    <p className="muted" style={{ fontSize: '13px', margin: '6px 0 0' }}>
                      Precio publicado: {formatMoney(price)}
                    </p>
                  )}
                </div>

                {error && <Notice tone="error">{error}</Notice>}
              </div>

              {/* Right Column: CurrentPurchaseCard from Reception Demo */}
              <div className="guantes-sidebar-column">
                <CurrentPurchaseCard
                  className="current-purchase-card--modal"
                  title="Venta de membresía"
                  hasOpenShift={openShiftFlag}
                  disabledMethods={!shift && overtimeSourceShiftId ? ['card', 'transfer'] : undefined}
                  step1Title="Membresía"
                  step2Title="Cobro"
                  totalMinor={price ?? 0}
                  allowCredit
                  assignedMember={selectedMember ? { id: selectedMember.id, name: selectedMember.name, creditMinor: memberCreditMinor } : null}
                  step1ActionDisabled={!selectedMember || !version || !registerId || !canSubmitCashSale || amountInvalid || submitting}
                  step1ActionLabel={
                    !selectedMember
                      ? 'Selecciona un socio beneficiario'
                      : !version
                      ? 'Selecciona una membresía'
                      : price !== null
                      ? `Proceder al cobro · ${formatMoney(price)} MXN →`
                      : 'Proceder al cobro →'
                  }
                  confirmActionLabel="Cobrar en efectivo"
                  statusMessage={error}
                  statusType={error ? 'error' : 'success'}
                  onConfirmPayment={breakdown => {
                    const credit = breakdown.creditAppliedMinor ?? 0;
                    if (breakdown.method === 'transfer') {
                      submit('transfer', undefined, credit);
                    } else {
                      submit('cash', breakdown.tenderedMinor, credit, breakdown.changeToCreditMinor ?? 0);
                    }
                  }}
                >
                  <div className="modal-cart-section">
                    <h4 className="modal-cart-section-title">Resumen de la membresía</h4>
                    <div className="guantes-spec-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="muted">Socio:</span>
                        <strong>{selectedMember?.name ?? 'Sin seleccionar'}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="muted">Plan:</span>
                        <strong>{version ? String(selectedPlan?.name ?? version.name) : 'Sin seleccionar'}</strong>
                      </div>
                      {Boolean(version?.duration_value) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="muted">Duración:</span>
                          <span>{String(version?.duration_value)} {String(version?.duration_unit) === 'months' ? 'mes(es)' : 'días'}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-divider)', paddingTop: '6px' }}>
                        <span className="muted">Total:</span>
                        <strong style={{ color: 'var(--color-primary-ink)', fontSize: '15px' }}>
                          {price !== null ? `${formatMoney(price)} MXN` : '$0.00 MXN'}
                        </strong>
                      </div>
                    </div>
                  </div>
                </CurrentPurchaseCard>
              </div>
            </div>

            {/* Visually-hidden accessible elements for headless/form contracts and tests */}
            <div style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>
              <label htmlFor="checkout-plan">Plan de membresía</label>
              <select
                id="checkout-plan"
                value={planId}
                onChange={e => setPlanId(e.target.value)}
                disabled={Boolean(unknownIntent) || submitting}
              >
                <option value="">Seleccioná un plan publicado</option>
                {plans.map(p => (
                  <option key={p.id} value={p.id}>{String(p.name ?? currentVersion(p)?.name ?? p.id)}</option>
                ))}
              </select>
              <label htmlFor="checkout-register">Caja abierta</label>
              <select
                id="checkout-register"
                value={registerId}
                onChange={e => setRegisterId(e.target.value)}
                disabled={Boolean(unknownIntent) || submitting}
              >
                <option value="">Seleccioná una caja con turno abierto</option>
                {registers.map(r => (
                  <option key={r.id} value={r.id}>{String(r.name ?? r.id)}</option>
                ))}
              </select>
              {shiftLoading && <p role="status">Consultando turno…</p>}
              {registerId && !shiftLoading && shift && (
                <span>Turno abierto confirmado: {shift.id}</span>
              )}
              {registerId && !shiftLoading && !shift && overtimeSourceShiftId && (
                <span>Venta en overtime · turno anterior: {overtimeSourceShiftId}</span>
              )}
              {registers.length === 0 && !loading && (
                <p role="alert">No hay cajas con turno abierto.</p>
              )}
              <label htmlFor="checkout-cash-amount">Efectivo recibido en MXN (opcional; vacío cobra el precio completo)</label>
              <input
                id="checkout-cash-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={cashAmount}
                onChange={e => setCashAmount(e.target.value)}
                disabled={Boolean(unknownIntent) || submitting}
              />
              {partialCash && (
                <p role="status">El monto en efectivo es menor al precio publicado; se registrará un saldo pendiente informativo.</p>
              )}
              {amountInvalid && (
                <p role="alert">El monto en efectivo debe ser mayor a cero y no superar el precio publicado.</p>
              )}
              {unknownIntent ? (
                <button type="button" onClick={() => void send(unknownIntent)} disabled={submitting}>
                  {submitting ? 'Consultando resultado…' : 'Reintentar la misma solicitud'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => submit('cash')}
                    disabled={loading || submitting || !version || !canSubmitCashSale || amountInvalid}
                  >
                    Cobrar en efectivo
                  </button>
                  <button
                    type="button"
                    onClick={() => submit('transfer')}
                    disabled={loading || submitting || !version || !shift}
                  >
                    Transferencia bancaria
                  </button>
                </>
              )}
              {!unknownIntent && (
                <button type="button" onClick={onClose} disabled={submitting}>
                  Cancelar
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
