import { getReceptionConfig, readOperationalToken } from './receptionApi';
import type { AuthenticatedRequest } from './membershipCheckoutApi';

export type PendingMoneyItemType = 'pending_transfer' | 'membership_debt';
export type TransferReviewDecisionStatus = 'confirmed' | 'pending';

export interface PendingMoneyItem {
  item_type: PendingMoneyItemType;
  branch_id: string;
  branch_name: string;
  member_id: string;
  member_number: string;
  member_name: string;
  order_id: string;
  amount_minor: number;
  currency: string;
  source_event_id: string;
  source_event_at: string;
  status: 'under_review' | 'pending' | 'outstanding' | string;
  status_event_id: string | null;
  status_event_at: string | null;
  initial_amount_minor: number | null;
  paid_amount_minor: number | null;
}

export type PendingMoneyItemDTO = PendingMoneyItem;

export interface PendingMoneyResponse {
  items: PendingMoneyItem[];
  total_items: number;
  total_pending_minor: number;
}

export type PendingMoneyResponseDTO = PendingMoneyResponse;

export interface ReviewTransferPaymentInput {
  status: TransferReviewDecisionStatus;
}

export interface ReviewTransferPaymentResponse {
  order: Record<string, unknown>;
  item: Record<string, unknown>;
  payment: Record<string, unknown>;
  membership: Record<string, unknown> | null;
  sample_entitlement?: Record<string, unknown> | null;
}

export class PendingMoneyApiError extends Error {
  readonly kind = 'http';

  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'PendingMoneyApiError';
  }
}

export function createTransferReviewIdempotencyKey(): string {
  return `tx-review-${crypto.randomUUID()}`;
}

async function requestPendingMoney<T>(
  path: string,
  init: RequestInit = {},
  apiRequest?: AuthenticatedRequest,
): Promise<T> {
  let response: Response;
  try {
    if (apiRequest) {
      response = await apiRequest(path, {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      });
    } else {
      const config = getReceptionConfig();
      const token = readOperationalToken();
      if (!token) {
        throw new PendingMoneyApiError(401, 'La sesión es obligatoria para consultar o revisar pagos pendientes.');
      }
      response = await fetch(`${config.apiOrigin}${path}`, {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${token}`,
          ...init.headers,
        },
      });
    }
  } catch (error) {
    if (error instanceof PendingMoneyApiError) throw error;
    throw new PendingMoneyApiError(0, 'No se pudo conectar con el servidor. Intenta nuevamente.');
  }

  if (!response.ok) {
    let detailMessage: string | undefined;
    let code: string | undefined;
    let requestId = response.headers.get('X-Request-ID') ?? undefined;
    try {
      const parsed: unknown = await response.json();
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (typeof record.detail === 'string' && record.detail.trim()) {
          detailMessage = record.detail.trim();
        }
        if (typeof record.error === 'object' && record.error !== null && !Array.isArray(record.error)) {
          const envelope = record.error as Record<string, unknown>;
          if (typeof envelope.code === 'string') code = envelope.code;
          if (!requestId && typeof envelope.request_id === 'string') requestId = envelope.request_id;
          if (!detailMessage && typeof envelope.message === 'string' && envelope.message.trim()) {
            detailMessage = envelope.message.trim();
          }
        }
      }
    } catch {
      // Fallback to status-based default message when body is not JSON.
    }

    const fallbackMessages: Record<number, string> = {
      401: 'La sesión expiró o fue revocada. Inicia sesión nuevamente.',
      403: 'No tienes autorización para consultar o revisar pagos de esta sucursal.',
      404: 'El pago o recurso solicitado no fue encontrado.',
      409: 'La revisión de la transferencia entra en conflicto con el estado actual.',
      422: 'Los datos de revisión enviados no son válidos.',
    };
    const message =
      detailMessage ??
      fallbackMessages[response.status] ??
      (response.status >= 500
        ? 'El servidor no pudo completar la operación.'
        : `La solicitud falló (${response.status}).`);
    throw new PendingMoneyApiError(response.status, message, code, requestId);
  }

  return response.json() as Promise<T>;
}

export async function getPendingMoney(
  options?: { branchId?: string; apiRequest?: AuthenticatedRequest },
  apiRequestArg?: AuthenticatedRequest,
): Promise<PendingMoneyResponse> {
  const effectiveRequest = apiRequestArg ?? options?.apiRequest;
  const branchId = options?.branchId?.trim();
  const query = branchId && branchId !== 'ALL' ? `?${new URLSearchParams({ branch_id: branchId }).toString()}` : '';
  return requestPendingMoney<PendingMoneyResponse>(`/api/v1/admin/pending-money${query}`, {}, effectiveRequest);
}

export async function reviewTransferPayment(
  paymentId: string,
  payloadOrStatus: ReviewTransferPaymentInput | TransferReviewDecisionStatus,
  idempotencyKey: string,
  apiRequest?: AuthenticatedRequest,
): Promise<ReviewTransferPaymentResponse> {
  const body: ReviewTransferPaymentInput =
    typeof payloadOrStatus === 'string' ? { status: payloadOrStatus } : payloadOrStatus;
  return requestPendingMoney<ReviewTransferPaymentResponse>(
    `/api/v1/registers/transfer-payments/${encodeURIComponent(paymentId)}/review`,
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    },
    apiRequest,
  );
}
