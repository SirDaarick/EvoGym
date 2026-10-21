import { useEffect, useRef, useState } from 'react';
import {
  getActiveMembershipPlans,
  getCurrentRegisterShift,
  getRegisters,
  submitMembershipCashSale,
  submitMembershipTransferSale,
  type ActiveMembershipPlan,
  type CheckoutRegister,
  type CurrentRegisterShift,
  type MembershipSaleRequest,
  type MembershipTransferSaleRequest,
} from '../../api/membershipCheckoutApi';

interface CheckoutMember {
  id: string;
  name: string;
}

type PaymentMethod = 'cash' | 'transfer';
interface SaleIntent {
  method: PaymentMethod;
  registerId: string;
  body: MembershipSaleRequest | MembershipTransferSaleRequest;
  idempotencyKey: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatMoney(minor: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(minor / 100);
}

function currentVersion(plan: ActiveMembershipPlan): Record<string, unknown> | null {
  return isObject(plan.current_version) && typeof plan.current_version.id === 'string' ? plan.current_version : null;
}

export function LiveMembershipCheckout({ member, onClose, onCompleted }: {
  member: CheckoutMember;
  onClose: () => void;
  onCompleted?: () => void;
}) {
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
  const [result, setResult] = useState<{ payment: Record<string, unknown>; membership: Record<string, unknown> | null; method: PaymentMethod } | null>(null);
  const submittingRef = useRef(false);
  const selectedPlan = plans.find(plan => plan.id === planId);
  const version = selectedPlan ? currentVersion(selectedPlan) : null;
  const price = version && typeof version.price_minor === 'number' ? version.price_minor : null;
  const amountMinor = cashAmount.trim() ? Math.round(Number(cashAmount) * 100) : undefined;
  const amountInvalid = amountMinor !== undefined && (!Number.isFinite(Number(cashAmount)) || amountMinor <= 0 || (price !== null && amountMinor > price));
  const partialCash = amountMinor !== undefined && !amountInvalid && price !== null && amountMinor < price;

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([getActiveMembershipPlans(), getRegisters()]).then(([activePlans, availableRegisters]) => {
      if (!active) return;
      setPlans(activePlans.filter(plan => currentVersion(plan)));
      setRegisters(availableRegisters.filter(register => register.has_open_shift));
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los planes y cajas.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setShift(null);
    if (!registerId) return () => { active = false; };
    setShiftLoading(true);
    void getCurrentRegisterShift(registerId).then(value => {
      if (active && value.register_id === registerId) setShift(value);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'No se pudo consultar el turno abierto.');
    }).finally(() => { if (active) setShiftLoading(false); });
    return () => { active = false; };
  }, [registerId]);

  async function send(intent: SaleIntent) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const response = intent.method === 'cash'
        ? await submitMembershipCashSale(intent.registerId, intent.body as MembershipSaleRequest, intent.idempotencyKey)
        : await submitMembershipTransferSale(intent.registerId, intent.body as MembershipTransferSaleRequest, intent.idempotencyKey);
      setUnknownIntent(null);
      setResult({ payment: response.payment, membership: response.membership, method: intent.method });
      onCompleted?.();
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

  function submit(method: PaymentMethod) {
    if (!version || !registerId || !shift || amountInvalid || submittingRef.current) return;
    if (method === 'cash' && amountMinor !== undefined && !Number.isSafeInteger(amountMinor)) {
      setError('Ingresá un monto válido en pesos.');
      return;
    }
    const common = { member_id: member.id, plan_version_id: version.id };
    const body: MembershipSaleRequest | MembershipTransferSaleRequest = method === 'cash'
      ? { ...common, source_shift_id: shift.id, ...(amountMinor !== undefined ? { cash_amount_minor: amountMinor } : {}) }
      : common;
    void send({ method, registerId, body, idempotencyKey: crypto.randomUUID() });
  }

  const paymentStatus = result?.payment.status;
  const paymentConfirmed = paymentStatus === 'confirmed';

  if (result) return <section role="dialog" aria-modal="true" aria-labelledby="checkout-title" className="panel" style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #94a3b8' }}>
    <h3 id="checkout-title">Resultado de la venta</h3>
    {result.method === 'transfer'
      ? <p role="status">Transferencia pendiente de revisión{typeof paymentStatus === 'string' ? ` (${paymentStatus})` : ''}. No está confirmada ni liquidada.</p>
      : <p role="status">{paymentConfirmed ? 'Pago confirmado.' : `Estado del pago: ${typeof paymentStatus === 'string' ? paymentStatus : 'sin estado informado'}.`}</p>}
    {result.membership
      ? <p>{typeof result.membership.starts_on === 'string' && typeof result.membership.ends_on === 'string'
        ? `Membresía activada por el backend: ${result.membership.starts_on} a ${result.membership.ends_on}.`
        : 'El backend devolvió un periodo de membresía.'}</p>
      : <p>Sin periodo de membresía devuelto; no se informa activación.</p>}
    <button type="button" onClick={onClose}>Cerrar</button>
  </section>;

  return <section role="dialog" aria-modal="true" aria-labelledby="checkout-title" className="panel" style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #94a3b8' }}>
    <h3 id="checkout-title">Venta de membresía · {member.name}</h3>
    {loading ? <p role="status">Cargando planes y cajas del backend…</p> : <>
      <label htmlFor="checkout-plan">Plan de membresía</label>
      <select id="checkout-plan" value={planId} onChange={event => setPlanId(event.target.value)} disabled={Boolean(unknownIntent) || submitting}>
        <option value="">Seleccioná un plan publicado</option>
        {plans.map(plan => <option key={plan.id} value={plan.id}>{String(plan.name ?? currentVersion(plan)?.name ?? plan.id)}</option>)}
      </select>
      {version && price !== null && <p>Precio publicado: {formatMoney(price)}</p>}
      <label htmlFor="checkout-register">Caja abierta</label>
      <select id="checkout-register" value={registerId} onChange={event => setRegisterId(event.target.value)} disabled={Boolean(unknownIntent) || submitting}>
        <option value="">Seleccioná una caja con turno abierto</option>
        {registers.map(register => <option key={register.id} value={register.id}>{String(register.name ?? register.id)}</option>)}
      </select>
      {shiftLoading && <p role="status">Consultando turno…</p>}
      {registerId && !shiftLoading && shift && <p>Turno abierto confirmado: {shift.id}</p>}
      {registers.length === 0 && !loading && <p role="alert">No hay cajas con turno abierto.</p>}
      <label htmlFor="checkout-cash-amount">Efectivo recibido en MXN (opcional; vacío cobra el precio completo)</label>
      <input id="checkout-cash-amount" type="number" min="0.01" step="0.01" value={cashAmount} onChange={event => setCashAmount(event.target.value)} disabled={Boolean(unknownIntent) || submitting} />
      {partialCash && <p role="status">El monto en efectivo es menor al precio publicado; se registrará un saldo pendiente informativo.</p>}
      {amountInvalid && <p role="alert">El monto en efectivo debe ser mayor a cero y no superar el precio publicado.</p>}
    </>}
    {error && <p role="alert">{error}</p>}
    {unknownIntent ? <button type="button" onClick={() => void send(unknownIntent)} disabled={submitting}>{submitting ? 'Consultando resultado…' : 'Reintentar la misma solicitud'}</button> : <>
      <button type="button" onClick={() => submit('cash')} disabled={loading || submitting || !version || !shift || amountInvalid}>Cobrar en efectivo</button>
      <button type="button" onClick={() => submit('transfer')} disabled={loading || submitting || !version || !shift}>Transferencia bancaria</button>
    </>}
    {!unknownIntent && <button type="button" onClick={onClose} disabled={submitting}>Cancelar</button>}
  </section>;
}
