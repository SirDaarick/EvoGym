import type { AuthenticatedRequest } from './inventoryApi';

export type RentalKind = 'glove' | 'locker';
export type RentalStatus = 'active' | 'returned' | 'released' | 'cancelled';
export type TenderMethod = 'cash' | 'card' | 'transfer';
export type RefundMethod = 'cash' | 'card';

export interface RentalAssetDTO {
  id: string;
  branch_id: string;
  kind: RentalKind;
  code: string;
  status: 'available' | 'employee' | 'out_of_service';
  locker_number: number | null;
  color: string | null;
  ounces: number | null;
  price_minor: number;
  deposit_minor: number;
  is_active: boolean;
  active_rental_id: string | null;
}

export interface RentalAssetPage {
  items: RentalAssetDTO[];
  total: number;
}

export interface RentalAssetInput {
  branch_id: string;
  kind: RentalKind;
  code: string;
  locker_number?: number | null;
  color?: string | null;
  ounces?: number | null;
  price_minor: number;
  deposit_minor?: number;
}

export interface RentalAssetPatch {
  code?: string | null;
  locker_number?: number | null;
  color?: string | null;
  ounces?: number | null;
  price_minor?: number | null;
  /** Admin only; the backend answers 409 when the asset has an active rental. */
  deposit_minor?: number | null;
  is_active?: boolean | null;
}

export interface TenderComponentInput {
  method: TenderMethod;
  amount_minor: number;
}

export interface RentalCreateInput {
  branch_id: string;
  asset_id: string;
  member_id: string;
  register_id: string;
  components: TenderComponentInput[];
  expected_total_minor: number;
  accepted_shortfall_minor: number;
  /** Must equal the asset's current `deposit_minor` (collected in cash); 409 otherwise. */
  expected_deposit_minor?: number;
  /** Member credit applied to the charge; sum(components) + credit + shortfall must equal the total. */
  credit_minor?: number;
}

export interface RentalRenewalInput {
  register_id: string;
  components: TenderComponentInput[];
  expected_total_minor: number;
  accepted_shortfall_minor: number;
  credit_minor?: number;
}

export interface RentalChargeDTO {
  id: string;
  charge_kind: 'initial' | 'renewal';
  amount_minor: number;
  starts_on: string;
  ends_on: string;
  outstanding_minor: number;
}

export type DepositStatus = 'none' | 'held' | 'refunded' | 'partially_retained' | 'retained';

export interface RentalEndInput {
  /** Required by the backend whenever a deposit is held. */
  register_id?: string;
  /** Defaults (server side) to the full held amount. */
  deposit_refund_minor?: number;
  /** 1-240 chars; required when the refund is lower than the held amount. */
  reason?: string;
}

export interface RentalDTO {
  id: string;
  branch_id: string;
  asset_id: string;
  asset_code: string;
  member_id: string;
  member_name: string;
  member_number: string;
  kind: RentalKind;
  status: RentalStatus;
  starts_on: string | null;
  ends_on: string | null;
  paid_minor: number;
  outstanding_minor: number;
  cancelled_debt_minor: number;
  deposit_minor: number;
  deposit_status: DepositStatus;
  deposit_held_minor: number;
  deposit_refunded_minor: number;
  deposit_retained_minor: number;
  deposit_reason: string | null;
  assigned_by_name: string;
  charges: RentalChargeDTO[];
  created_at: string;
}

export interface RentalPage {
  items: RentalDTO[];
  total: number;
}

export interface CancellationPeriodDTO {
  charge_id: string;
  amount_minor: number;
  starts_on: string;
  ends_on: string;
  outstanding_minor: number;
}

export interface CancellationPreviewDTO {
  can_cancel: boolean;
  preview_token: string;
  settled_minor: number;
  max_refundable_minor: number;
  suggested_refund_minor: number;
  outstanding_minor: number;
  cancelled_debt_minor: number;
  periods: CancellationPeriodDTO[];
}

export interface CancellationInput {
  register_id: string;
  preview_token: string;
  refund_amount_minor: number;
  refund_method: RefundMethod;
  reason: string;
}

export interface RentalCancellationDTO {
  id: string;
  rental_id: string;
  member_id: string;
  member_name: string;
  member_number: string;
  asset_id: string;
  asset_code: string;
  actor_id: string;
  actor_name: string | null;
  reason: string;
  refund_method: RefundMethod;
  refund_amount_minor: number;
  suggested_refund_minor: number;
  settled_minor: number;
  cancelled_debt_minor: number;
  reviewed: boolean;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface RentalAlertPage {
  items: RentalCancellationDTO[];
  total: number;
}

export interface MemberReceivableItem {
  payment_id: string;
  rental_id: string;
  charge_id: string;
  asset_id: string;
  asset_code: string;
  member_id: string;
  kind: RentalKind;
  method: TenderMethod;
  status: string;
  amount_minor: number;
  settled_minor: number;
  outstanding_minor: number;
  created_at: string;
}

export interface MemberReceivablePage {
  items: MemberReceivableItem[];
  total_outstanding_minor: number;
}

export interface ReceivablePaymentInput {
  register_id: string;
  method: TenderMethod | 'credit';
  amount_minor: number;
}

export interface ReceivableAllocationDTO {
  charge_id: string;
  amount_minor: number;
}

export interface ReceivablePaymentDTO {
  id: string;
  rental_id: string;
  charge_id: string;
  method: TenderMethod | 'credit';
  status: string;
  amount_minor: number;
  remaining_minor: number;
  allocations: ReceivableAllocationDTO[];
}

export class RentalApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'RentalApiError';
  }
}

const CONFLICT_MESSAGES: Array<[RegExp, string]> = [
  [/refund|held|exceed/i, 'El reembolso no puede exceder el depósito retenido.'],
  [/settled|different/i, 'El depósito de esta renta ya fue liquidado con otros datos.'],
  [/deposit/i, 'El depósito cambió o no coincide. Actualiza el catálogo y vuelve a intentar.'],
  [/open shift/i, 'Se requiere un turno abierto en la caja para operar rentas.'],
  [/not available|already/i, 'El activo ya no está disponible. Actualiza la lista.'],
];

/** Spanish text for backend 409/422 so operators never see raw English detail. */
function localizedMessage(status: number, detail: string | null): string | null {
  if (status === 409) {
    const hit = detail ? CONFLICT_MESSAGES.find(([pattern]) => pattern.test(detail)) : undefined;
    return hit ? hit[1] : 'La operación entra en conflicto con el estado actual. Actualiza e intenta de nuevo.';
  }
  if (status === 422) {
    if (detail && /reason/i.test(detail)) return 'Indica el motivo cuando se devuelve menos del depósito retenido.';
    if (detail && /register/i.test(detail)) return 'Selecciona una caja para devolver el depósito.';
    return 'Los datos enviados no son válidos. Revisa los montos y campos obligatorios.';
  }
  return null;
}

async function extractError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 409 || response.status === 422) {
    const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const detail = raw && typeof raw.detail === 'string' ? raw.detail : raw && typeof raw.message === 'string' ? raw.message : null;
    const message = localizedMessage(response.status, detail);
    if (message) return message;
  }
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (typeof obj.detail === 'string') return obj.detail;
    if (typeof obj.message === 'string') return obj.message;
    if (obj.error && typeof obj.error === 'object' && typeof (obj.error as Record<string, unknown>).message === 'string') {
      return (obj.error as Record<string, unknown>).message as string;
    }
  }
  return response.status >= 500
    ? 'El servidor no pudo procesar la solicitud de renta.'
    : `Error en la operación de renta (${response.status}).`;
}

export async function listRentalAssets(
  request: AuthenticatedRequest,
  branchId: string,
  kind?: RentalKind,
  offset = 0,
  limit = 50
): Promise<RentalAssetPage> {
  const params = new URLSearchParams({
    branch_id: branchId,
    offset: String(offset),
    limit: String(limit),
  });
  if (kind) params.set('kind', kind);
  const response = await request(`/api/v1/rentals/assets?${params}`);
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<RentalAssetPage>;
}

export async function createRentalAsset(
  request: AuthenticatedRequest,
  payload: RentalAssetInput
): Promise<RentalAssetDTO> {
  const response = await request('/api/v1/rentals/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<RentalAssetDTO>;
}

export async function updateRentalAsset(
  request: AuthenticatedRequest,
  assetId: string,
  payload: RentalAssetPatch
): Promise<RentalAssetDTO> {
  const response = await request(`/api/v1/rentals/assets/${encodeURIComponent(assetId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<RentalAssetDTO>;
}

export async function listRentals(
  request: AuthenticatedRequest,
  branchId: string,
  filters?: {
    status?: RentalStatus;
    kind?: RentalKind;
    memberId?: string;
  }
): Promise<RentalPage> {
  const params = new URLSearchParams({ branch_id: branchId });
  if (filters?.status) params.set('status', filters.status);
  if (filters?.kind) params.set('kind', filters.kind);
  if (filters?.memberId) params.set('member_id', filters.memberId);

  const response = await request(`/api/v1/rentals?${params}`);
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<RentalPage>;
}

export async function getRental(
  request: AuthenticatedRequest,
  rentalId: string
): Promise<RentalDTO> {
  const response = await request(`/api/v1/rentals/${encodeURIComponent(rentalId)}`);
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<RentalDTO>;
}

export async function rentGlove(
  request: AuthenticatedRequest,
  payload: RentalCreateInput,
  idempotencyKey: string
): Promise<RentalDTO> {
  const response = await request('/api/v1/rentals/gloves', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<RentalDTO>;
}

export async function returnGlove(
  request: AuthenticatedRequest,
  rentalId: string,
  idempotencyKey: string,
  body?: RentalEndInput
): Promise<RentalDTO> {
  const response = await request(`/api/v1/rentals/${encodeURIComponent(rentalId)}/return`, {
    method: 'POST',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'Idempotency-Key': idempotencyKey,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<RentalDTO>;
}

export async function assignLocker(
  request: AuthenticatedRequest,
  payload: RentalCreateInput,
  idempotencyKey: string
): Promise<RentalDTO> {
  const response = await request('/api/v1/rentals/lockers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<RentalDTO>;
}

export async function renewLocker(
  request: AuthenticatedRequest,
  rentalId: string,
  payload: RentalRenewalInput,
  idempotencyKey: string
): Promise<RentalDTO> {
  const response = await request(`/api/v1/rentals/${encodeURIComponent(rentalId)}/renewals`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<RentalDTO>;
}

export async function releaseLocker(
  request: AuthenticatedRequest,
  rentalId: string,
  idempotencyKey: string,
  body?: RentalEndInput
): Promise<RentalDTO> {
  const response = await request(`/api/v1/rentals/${encodeURIComponent(rentalId)}/release`, {
    method: 'POST',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'Idempotency-Key': idempotencyKey,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<RentalDTO>;
}

export async function previewLockerCancellation(
  request: AuthenticatedRequest,
  rentalId: string
): Promise<CancellationPreviewDTO> {
  const response = await request(`/api/v1/rentals/${encodeURIComponent(rentalId)}/cancellation-preview`);
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<CancellationPreviewDTO>;
}

export async function confirmLockerCancellation(
  request: AuthenticatedRequest,
  rentalId: string,
  payload: CancellationInput,
  idempotencyKey: string
): Promise<RentalCancellationDTO> {
  const response = await request(`/api/v1/rentals/${encodeURIComponent(rentalId)}/cancellation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<RentalCancellationDTO>;
}

export async function listRentalAlerts(
  request: AuthenticatedRequest,
  branchId: string
): Promise<RentalAlertPage> {
  const params = new URLSearchParams({ branch_id: branchId });
  const response = await request(`/api/v1/rentals/alerts?${params}`);
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<RentalAlertPage>;
}

export async function reviewRentalAlert(
  request: AuthenticatedRequest,
  cancellationId: string
): Promise<RentalCancellationDTO> {
  const response = await request(`/api/v1/rentals/alerts/${encodeURIComponent(cancellationId)}/review`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<RentalCancellationDTO>;
}

export async function getMemberReceivables(
  request: AuthenticatedRequest,
  memberId: string,
  branchId: string
): Promise<MemberReceivablePage> {
  const params = new URLSearchParams({ branch_id: branchId });
  const response = await request(`/api/v1/rentals/members/${encodeURIComponent(memberId)}/receivables?${params}`);
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<MemberReceivablePage>;
}

export async function recordRentalRepayment(
  request: AuthenticatedRequest,
  rentalId: string,
  payload: ReceivablePaymentInput,
  idempotencyKey: string
): Promise<ReceivablePaymentDTO> {
  const response = await request(`/api/v1/rentals/${encodeURIComponent(rentalId)}/receivable-payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<ReceivablePaymentDTO>;
}

export type CardAttemptStatus = 'pending' | 'confirmed' | 'failed' | 'unknown' | 'cancelled';

export interface CardAttemptInput {
  register_id: string;
  amount_minor: number;
  terminal_id?: string;
}

export interface CardAttemptDTO {
  id: string;
  rental_id: string;
  charge_id: string;
  amount_minor: number;
  status: CardAttemptStatus;
  payment_id: string | null;
  failure_reason: string | null;
  created_at: string;
}

export async function beginRentalCardAttempt(
  request: AuthenticatedRequest,
  rentalId: string,
  chargeId: string,
  payload: CardAttemptInput,
  idempotencyKey: string
): Promise<CardAttemptDTO> {
  const response = await request(
    `/api/v1/rentals/${encodeURIComponent(rentalId)}/charges/${encodeURIComponent(chargeId)}/card-attempts`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    if (response.status === 503) {
      throw new RentalApiError(503, 'La terminal de tarjeta no está configurada. Cobra en efectivo o transferencia.');
    }
    if (response.status === 502) {
      throw new RentalApiError(502, 'La terminal rechazó la solicitud de cobro. Intenta de nuevo.');
    }
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<CardAttemptDTO>;
}

export async function getRentalCardAttempt(
  request: AuthenticatedRequest,
  attemptId: string
): Promise<CardAttemptDTO> {
  const response = await request(`/api/v1/rentals/card-attempts/${encodeURIComponent(attemptId)}`);
  if (!response.ok) {
    throw new RentalApiError(response.status, await extractError(response));
  }
  return response.json() as Promise<CardAttemptDTO>;
}
