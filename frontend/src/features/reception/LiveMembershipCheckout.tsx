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
}

interface DebtPaymentIntent {
  registerId: string;
  body: MembershipDebtPaymentInput;
  idempotencyKey: string;
}

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
    method: PaymentMethod;
  } | null>(null);

  const [openDebts, setOpenDebts] = useState<RegisterMemberOpenDebt[]>([]);
  const [debtsLoading, setDebtsLoading] = useState(false);
  const [selectedDebtOrderId, setSelectedDebtOrderId] = useState(initialOrderId ?? '');
  const [debtAmountMajor, setDebtAmountMajor] = useState('');
  const [unknownDebtIntent, setUnknownDebtIntent] = useState<DebtPaymentIntent | null>(null);
  const [debtReceipt, setDebtReceipt] = useState<MembershipDebtPaymentReceipt | null>(null);
  const debtIdempotencyMapRef = useRef<Record<string, string>>({});

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
      const req = apiRequest ?? ((path, init) => fetch(path, init));
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
      const validPlans = activePlans.filter(plan => currentVersion(plan));
      const openRegisters = availableRegisters.filter(register => register.has_open_shift);
      setPlans(validPlans);
      setRegisters(openRegisters);
      // Automatically select active open register
      if (openRegisters.length >= 1) {
        setRegisterId(openRegisters[0].id);
      }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los planes y cajas.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiRequest]);

  // Load shift when registerId is set
  useEffect(() => {
    let active = true;
    setShift(null);
    if (!registerId) return () => { active = false; };
    setShiftLoading(true);
    void (apiRequest ? getCurrentRegisterShift(registerId, apiRequest) : getCurrentRegisterShift(registerId)).then(value => {
      if (active && value.cash_register_id === registerId) setShift(value);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'No se pudo consultar el turno abierto.');
    }).finally(() => { if (active) setShiftLoading(false); });
    return () => { active = false; };
  }, [registerId, apiRequest]);

  // Load open debts whenever registerId + selectedMember are set
  useEffect(() => {
    let active = true;
    if (!registerId || !selectedMember) {
      setOpenDebts([]);
      return () => { active = false; };
    }
    setDebtsLoading(true);
    setError('');
    void (apiRequest
      ? listRegisterMemberOpenDebts(registerId, selectedMember.id, apiRequest)
      : listRegisterMemberOpenDebts(registerId, selectedMember.id)
    ).then(items => {
      if (!active) return;
      setOpenDebts(items);
      const preferred = (initialOrderId && items.find(d => d.order_id === initialOrderId)) || items[0];
      if (preferred) {
        setSelectedDebtOrderId(preferred.order_id);
        setDebtAmountMajor((preferred.remaining_balance_minor / 100).toFixed(2));
      } else {
        setSelectedDebtOrderId('');
        setDebtAmountMajor('');
      }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los adeudos pendientes.');
    }).finally(() => { if (active) setDebtsLoading(false); });
    return () => { active = false; };
  }, [registerId, selectedMember, initialOrderId, apiRequest]);

  const selectedDebt = openDebts.find(d => d.order_id === selectedDebtOrderId) ?? null;
  const rawDebtNumber = Number(debtAmountMajor);
  const parsedDebtMinor = debtAmountMajor.trim() ? Math.round(rawDebtNumber * 100) : 0;
  const debtAmountInvalid =
    !debtAmountMajor.trim() ||
    !Number.isFinite(rawDebtNumber) ||
    !Number.isSafeInteger(parsedDebtMinor) ||
    parsedDebtMinor <= 0 ||
    (selectedDebt !== null && parsedDebtMinor > selectedDebt.remaining_balance_minor);

  function getStableDebtIdempotencyKey(regId: string, orderId: string, minor: number): string {
    const fingerprint = `${regId}:${orderId}:${minor}`;
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
      const receipt = await (apiRequest
        ? submitMembershipDebtPayment(intent.registerId, intent.body, intent.idempotencyKey, apiRequest)
        : submitMembershipDebtPayment(intent.registerId, intent.body, intent.idempotencyKey));
      setUnknownDebtIntent(null);
      setDebtReceipt(receipt);
      notifyCompleted();
    } catch (reason) {
      if (isObject(reason) && reason.kind === 'network') {
        setUnknownDebtIntent(intent);
        setError('No se pudo confirmar si el servidor registró el abono. Conservamos la misma solicitud; reintentala para consultar el resultado sin duplicar el cobro.');
      } else {
        setUnknownDebtIntent(null);
        setError(reason instanceof Error ? reason.message : 'No se pudo registrar el abono del adeudo.');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function submitDebtPayment() {
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
      const response = intent.method === 'cash'
        ? await (apiRequest
            ? submitMembershipCashSale(intent.registerId, intent.body as MembershipSaleRequest, intent.idempotencyKey, apiRequest)
            : submitMembershipCashSale(intent.registerId, intent.body as MembershipSaleRequest, intent.idempotencyKey))
        : await (apiRequest
            ? submitMembershipTransferSale(intent.registerId, intent.body as MembershipTransferSaleRequest, intent.idempotencyKey, apiRequest)
            : submitMembershipTransferSale(intent.registerId, intent.body as MembershipTransferSaleRequest, intent.idempotencyKey));
      setUnknownIntent(null);
      setResult({
        payment: response.payment,
        membership: response.membership,
        sample_entitlement: response.sample_entitlement,
        method: intent.method,
      });
      notifyCompleted();
    } catch (reason) {
      if (isObject(reason) && reason.kind === 'network') {
        setUnknownIntent(intent);
        setError('No se pudo confirmar si el servidor registró la venta. Conservamos la misma solicitud; reintentala para consultar el resultado sin crear otra intención.');
      } else {
        setUnknownIntent(null);
        setError(reason instanceof Error ? reason.message : 'No se pudo registrar la venta.');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function submit(method: PaymentMethod, overrideCashAmountMinor?: number) {
    if (!selectedMember || !version || !registerId || !shift || amountInvalid || submittingRef.current) return;
    const finalAmountMinor = overrideCashAmountMinor !== undefined ? overrideCashAmountMinor : amountMinor;
    if (method === 'cash' && finalAmountMinor !== undefined && !Number.isSafeInteger(finalAmountMinor)) {
      setError('Ingresá un monto válido en pesos.');
      return;
    }
    const common = { member_id: selectedMember.id, plan_version_id: version.id };
    const body: MembershipSaleRequest | MembershipTransferSaleRequest = method === 'cash'
      ? { ...common, ...(finalAmountMinor !== undefined ? { cash_amount_minor: finalAmountMinor } : {}) }
      : common;
    void send({ method, registerId, body, idempotencyKey: crypto.randomUUID() });
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
  const debtEntries: AnimatedListEntry[] = openDebts.map(d => ({
    id: d.order_id,
    title: d.description_snapshot,
    description: `Pedido ${d.order_id.slice(0, 8)}… · Adeudo inicial: ${formatMoney(d.initial_outstanding_minor)} MXN`,
    meta: `Resta: ${formatMoney(d.remaining_balance_minor)} MXN`,
  }));

  const selectedDebtIndex = openDebts.findIndex(d => d.order_id === selectedDebtOrderId);

  // Debt repayment receipt dialog
  if (debtReceipt) {
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
            Abono en efectivo confirmado por {formatMoney(debtReceipt.amount_minor)}.
          </p>
          <p>
            Saldo restante del pedido: {formatMoney(debtReceipt.remaining_balance_minor)} MXN
            {debtReceipt.remaining_balance_minor === 0 ? ' · Adeudo liquidado en su totalidad.' : ''}
          </p>
          <p className="muted" style={{ fontSize: '13px' }}>
            Recibo: {debtReceipt.id} · Turno: {debtReceipt.shift_id}
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
              disabled={submitting || Boolean(unknownIntent) || Boolean(unknownDebtIntent) || (Boolean(selectedMember) && !debtsLoading && openDebts.length === 0)}
              title={Boolean(selectedMember) && !debtsLoading && openDebts.length === 0 ? 'El socio no tiene adeudos pendientes' : undefined}
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
                      <span className="muted" style={{ display: 'block', fontSize: '12px' }}>ID: {selectedMember.id}</span>
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
                ) : openDebts.length === 0 ? (
                  <p role="status" className="muted">No hay adeudos pendientes en esta sucursal para este socio.</p>
                ) : (
                  <>
                    <AnimatedList
                      items={debtEntries}
                      selectedIndex={selectedDebtIndex >= 0 ? selectedDebtIndex : undefined}
                      onSelectedIndexChange={idx => {
                        if (openDebts[idx]) {
                          setSelectedDebtOrderId(openDebts[idx].order_id);
                          setDebtAmountMajor((openDebts[idx].remaining_balance_minor / 100).toFixed(2));
                        }
                      }}
                      onItemSelect={(_item, idx) => {
                        if (openDebts[idx]) {
                          setSelectedDebtOrderId(openDebts[idx].order_id);
                          setDebtAmountMajor((openDebts[idx].remaining_balance_minor / 100).toFixed(2));
                        }
                      }}
                      accentColor="#FC6C06"
                      theme={dark ? 'dark' : 'light'}
                      animation="pop"
                      maxHeight={260}
                      width="100%"
                    />
                    <select
                      id="checkout-debt-order"
                      value={selectedDebtOrderId}
                      onChange={e => {
                        const nextOrderId = e.target.value;
                        setSelectedDebtOrderId(nextOrderId);
                        const nextDebt = openDebts.find(d => d.order_id === nextOrderId);
                        if (nextDebt) {
                          setDebtAmountMajor((nextDebt.remaining_balance_minor / 100).toFixed(2));
                        }
                      }}
                      disabled={Boolean(unknownDebtIntent) || submitting}
                      style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}
                    >
                      {openDebts.map(debt => (
                        <option key={debt.order_id} value={debt.order_id}>
                          {debt.description_snapshot} · Pedido {debt.order_id.slice(0, 8)} · Restante {formatMoney(debt.remaining_balance_minor)}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>

              {selectedDebt && debtAmountMajor.trim() !== '' && debtAmountInvalid && (
                <p role="alert" style={{ marginTop: '6px', color: 'var(--color-danger, #b91c1c)', fontSize: '13px' }}>
                  El abono en efectivo debe ser mayor a cero y no superar el saldo pendiente ({formatMoney(selectedDebt.remaining_balance_minor)}).
                </p>
              )}

              {error && <Notice tone="error">{error}</Notice>}
            </div>

            {/* Right Column: CurrentPurchaseCard for debt payment */}
            <div className="guantes-sidebar-column">
              <CurrentPurchaseCard
                className="current-purchase-card--modal"
                title="Cobro de adeudo"
                step1Title="Adeudo"
                step2Title="Cobro"
                totalMinor={selectedDebt ? (parsedDebtMinor > 0 && !debtAmountInvalid ? parsedDebtMinor : selectedDebt.remaining_balance_minor) : 0}
                assignedMember={selectedMember ? { id: selectedMember.id, name: selectedMember.name } : null}
                step1ActionDisabled={!selectedMember || !selectedDebt || !registerId || !shift || debtAmountInvalid || debtsLoading || shiftLoading || submitting}
                step1ActionLabel={
                  !selectedMember
                    ? 'Selecciona un socio beneficiario'
                    : !selectedDebt
                    ? 'Selecciona un adeudo'
                    : `Proceder al cobro · ${formatMoney(parsedDebtMinor > 0 && !debtAmountInvalid ? parsedDebtMinor : selectedDebt.remaining_balance_minor)} MXN →`
                }
                confirmActionLabel="Registrar abono en efectivo"
                statusMessage={error}
                statusType={error ? 'error' : 'success'}
                onConfirmPayment={breakdown => {
                  if (breakdown.tenderedMinor && breakdown.tenderedMinor > 0 && selectedDebt) {
                    if (breakdown.tenderedMinor <= selectedDebt.remaining_balance_minor) {
                      const idempotencyKey = getStableDebtIdempotencyKey(registerId, selectedDebt.order_id, breakdown.tenderedMinor);
                      void sendDebtPayment({
                        registerId,
                        body: { order_id: selectedDebt.order_id, amount_minor: breakdown.tenderedMinor },
                        idempotencyKey,
                      });
                      return;
                    }
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
                      <strong>{selectedDebt?.description_snapshot ?? 'Sin seleccionar'}</strong>
                    </div>
                    {selectedDebt && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="muted">Adeudo inicial:</span>
                          <span>{formatMoney(selectedDebt.initial_outstanding_minor)} MXN</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="muted">Abonado previamente:</span>
                          <span>{formatMoney(selectedDebt.paid_amount_minor)} MXN</span>
                        </div>
                      </>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-divider)', paddingTop: '6px' }}>
                      <span className="muted">Saldo pendiente:</span>
                      <strong style={{ color: '#FC6C06', fontSize: '15px' }}>
                        {selectedDebt ? `${formatMoney(selectedDebt.remaining_balance_minor)} MXN` : '$0.00 MXN'}
                      </strong>
                    </div>
                    {selectedDebt && parsedDebtMinor > 0 && parsedDebtMinor < selectedDebt.remaining_balance_minor && !debtAmountInvalid && (
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
                disabled={Boolean(unknownDebtIntent) || submitting || !selectedDebt}
              />
              <button
                type="button"
                onClick={submitDebtPayment}
                disabled={loading || debtsLoading || shiftLoading || submitting || !selectedMember || !registerId || !shift || !selectedDebt || debtAmountInvalid}
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
                  step1Title="Membresía"
                  step2Title="Cobro"
                  totalMinor={price ?? 0}
                  assignedMember={selectedMember ? { id: selectedMember.id, name: selectedMember.name } : null}
                  step1ActionDisabled={!selectedMember || !version || !registerId || !shift || amountInvalid || submitting}
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
                    if (breakdown.method === 'transfer') {
                      submit('transfer');
                    } else {
                      submit('cash', breakdown.tenderedMinor);
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
                        <strong style={{ color: '#FC6C06', fontSize: '15px' }}>
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
                    disabled={loading || submitting || !version || !shift || amountInvalid}
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
