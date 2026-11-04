import type { AuthenticatedRequest } from '../../api/inventoryApi';
import {
  beginRentalCardAttempt,
  getRentalCardAttempt,
  type CardAttemptDTO,
  type RentalDTO,
  type RentalEndInput,
  type TenderComponentInput,
} from '../../api/rentalsApi';
import { formatMoney } from '@/shared/formatters/money';
import type { CheckoutPaymentBreakdown } from './CurrentPurchaseCard';

export interface RentalTender {
  /** Cash/transfer components the backend accepts at creation time. */
  components: TenderComponentInput[];
  /** Card amount is NOT accepted at creation: it is collected afterwards via a terminal attempt. */
  cardMinor: number;
  /** Amount left unpaid at creation (shortfall plus the card portion). */
  shortfallMinor: number;
}

export function buildRentalTender(totalMinor: number, breakdown?: CheckoutPaymentBreakdown): RentalTender {
  if (!breakdown) {
    return { components: [{ method: 'cash', amount_minor: totalMinor }], cardMinor: 0, shortfallMinor: 0 };
  }
  const shortfall = breakdown.shortfallMinor ?? 0;
  const components: TenderComponentInput[] = [];
  let cardMinor = 0;
  const add = (method: string | undefined, amount: number | undefined) => {
    if (!method || !amount || amount <= 0) return;
    if (method === 'card') cardMinor += amount;
    else components.push({ method: method as 'cash' | 'transfer', amount_minor: amount });
  };
  if (breakdown.mode === 'single') {
    add(breakdown.method, totalMinor - shortfall);
  } else {
    add(breakdown.mixedMethod1, breakdown.mixedAmount1Minor);
    add(breakdown.mixedMethod2, breakdown.mixedAmount2Minor);
  }
  return { components, cardMinor, shortfallMinor: shortfall + cardMinor };
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface CardCollectionResult {
  attempt: CardAttemptDTO;
  confirmed: boolean;
}

/** Starts a terminal attempt on the rental's open charge and polls until it leaves `pending`. */
export async function collectRentalCard(
  request: AuthenticatedRequest,
  rental: RentalDTO,
  registerId: string,
  amountMinor: number,
  options: { pollMs?: number; maxPolls?: number } = {}
): Promise<CardCollectionResult> {
  const charge = [...(rental.charges ?? [])].reverse().find(c => c.outstanding_minor >= amountMinor);
  if (!charge) throw new Error('La renta no tiene un cargo pendiente para cobrar con tarjeta.');
  let attempt = await beginRentalCardAttempt(
    request,
    rental.id,
    charge.id,
    { register_id: registerId, amount_minor: amountMinor },
    crypto.randomUUID()
  );
  const pollMs = options.pollMs ?? 1500;
  const maxPolls = options.maxPolls ?? 20;
  for (let i = 0; attempt.status === 'pending' && i < maxPolls; i += 1) {
    await sleep(pollMs);
    attempt = await getRentalCardAttempt(request, attempt.id);
  }
  return { attempt, confirmed: attempt.status === 'confirmed' };
}

export function cardPendingMessage(attempt: CardAttemptDTO, amountMinor: number): string {
  const base = `El cobro con tarjeta de ${formatMoney(amountMinor)} MXN no se confirmó`;
  if (attempt.status === 'pending' || attempt.status === 'unknown') {
    return `${base}. Verifica la terminal; la renta quedó con saldo pendiente.`;
  }
  return `${base}${attempt.failure_reason ? ` (${attempt.failure_reason})` : ''}. La renta quedó con saldo pendiente.`;
}

export function depositNotice(depositMinor: number): string | undefined {
  return depositMinor > 0
    ? `Además del precio, cobra en efectivo el depósito reembolsable: ${formatMoney(depositMinor)} MXN.`
    : undefined;
}

export interface DepositEndErrors {
  refund?: string;
  reason?: string;
  register?: string;
}

/** Body for /return and /release. `body` is undefined when no deposit is held. */
export function buildEndBody(input: {
  heldMinor: number;
  registerId?: string;
  refundPesos: string;
  reason: string;
}): { body?: RentalEndInput; errors?: DepositEndErrors } {
  if (input.heldMinor <= 0) return {};
  const errors: DepositEndErrors = {};
  if (!input.registerId) errors.register = 'Selecciona una caja con turno abierto para devolver el depósito.';
  const refundMinor = Math.round(parseFloat(input.refundPesos || '0') * 100);
  if (!Number.isFinite(refundMinor) || refundMinor < 0) {
    errors.refund = 'Ingresa un monto válido (0 o mayor).';
  } else if (refundMinor > input.heldMinor) {
    errors.refund = `No puedes devolver más de ${formatMoney(input.heldMinor)} MXN.`;
  }
  const reason = input.reason.trim();
  if (!errors.refund && refundMinor < input.heldMinor && !reason) {
    errors.reason = 'Escribe el motivo de la retención (máx. 240 caracteres).';
  }
  if (errors.register || errors.refund || errors.reason) return { errors };
  return {
    body: {
      register_id: input.registerId,
      deposit_refund_minor: refundMinor,
      ...(refundMinor < input.heldMinor ? { reason } : {}),
    },
  };
}

const DEPOSIT_STATUS_LABEL: Record<RentalDTO['deposit_status'], string> = {
  none: 'Sin depósito',
  held: 'Retenido (en custodia)',
  refunded: 'Devuelto',
  partially_retained: 'Devuelto parcialmente',
  retained: 'Retenido definitivamente',
};

export function depositStatusLabel(status: RentalDTO['deposit_status']): string {
  return DEPOSIT_STATUS_LABEL[status] ?? status;
}

interface DepositEndSectionProps {
  idPrefix: string;
  rental: RentalDTO;
  refundPesos: string;
  reason: string;
  errors: DepositEndErrors;
  disabled?: boolean;
  onRefundChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  note?: string;
}

/** Deposit summary plus refund inputs shown while ending a rental that holds a deposit. */
export function DepositEndSection({
  idPrefix, rental, refundPesos, reason, errors, disabled, onRefundChange, onReasonChange, note,
}: DepositEndSectionProps) {
  const held = rental.deposit_held_minor;
  const refundMinor = Math.round(parseFloat(refundPesos || '0') * 100);
  const retaining = Number.isFinite(refundMinor) && refundMinor < held;
  return (
    <div className="guantes-bento-card">
      <h3>Depósito reembolsable</h3>
      <div className="guantes-spec-list">
        <div className="guantes-spec-row">
          <span className="muted">Estado:</span>
          <strong>{depositStatusLabel(rental.deposit_status)}</strong>
        </div>
        <div className="guantes-spec-row">
          <span className="muted">Retenido:</span>
          <strong>{formatMoney(held)} MXN</strong>
        </div>
      </div>
      {note ? (
        <p className="muted" style={{ fontSize: '0.85rem' }}>{note}</p>
      ) : (
        <>
          <div className="field" style={{ marginTop: '8px' }}>
            <label htmlFor={`${idPrefix}-deposit-refund`}>Monto a devolver en efectivo (MXN)</label>
            <input
              id={`${idPrefix}-deposit-refund`}
              type="number"
              step="0.50"
              min="0"
              max={(held / 100).toFixed(2)}
              value={refundPesos}
              disabled={disabled}
              aria-invalid={errors.refund ? true : undefined}
              aria-describedby={errors.refund ? `${idPrefix}-deposit-refund-error` : undefined}
              onChange={e => onRefundChange(e.target.value)}
            />
            {errors.refund && <p id={`${idPrefix}-deposit-refund-error`} className="field-error">{errors.refund}</p>}
          </div>
          {retaining && (
            <div className="field">
              <label htmlFor={`${idPrefix}-deposit-reason`}>
                Motivo de la retención ({formatMoney(Math.max(0, held - Math.max(0, refundMinor)))} MXN se quedan)
              </label>
              <textarea
                id={`${idPrefix}-deposit-reason`}
                rows={2}
                maxLength={240}
                value={reason}
                disabled={disabled}
                aria-invalid={errors.reason ? true : undefined}
                aria-describedby={errors.reason ? `${idPrefix}-deposit-reason-error` : undefined}
                onChange={e => onReasonChange(e.target.value)}
              />
              {errors.reason && <p id={`${idPrefix}-deposit-reason-error`} className="field-error">{errors.reason}</p>}
            </div>
          )}
          {errors.register && <p className="field-error" role="alert">{errors.register}</p>}
        </>
      )}
    </div>
  );
}
