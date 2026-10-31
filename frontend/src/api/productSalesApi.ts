import type { AuthenticatedRequest } from './inventoryApi';

export interface ProductSaleInput {
  member_id: string | null;
  items: { product_id: string; quantity: number }[];
  expected_total_minor: number;
}

export interface ProductSaleResult {
  order: { id: string; total_minor: number; register_id: string };
  items: { id: string; product_id: string; quantity: number; line_total_minor: number }[];
  payment: {
    id: string;
    amount_minor: number;
    status: string;
    method: string;
    card_brand?: string | null;
    card_last_four?: string | null;
    authorization_code?: string | null;
  };
}

export class ProductSaleError extends Error {
  constructor(readonly status: number, readonly definitelyRejected: boolean, readonly firstShiftRequired = false) {
    super(status >= 500 ? 'No se pudo confirmar el resultado. Reintenta sin cambiar la compra.' : 'No se pudo registrar la compra. Revisa los datos y vuelve a intentar.');
  }
}

export async function submitCashProductSale(request: AuthenticatedRequest, registerId: string,
                                            payload: ProductSaleInput, key: string): Promise<ProductSaleResult> {
  const response = await request(`/api/v1/registers/${encodeURIComponent(registerId)}/product-sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const code = body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'code' in body.error ? body.error.code : null;
    throw new ProductSaleError(response.status, response.status === 403 || response.status === 422 || (response.status === 409 && (code === 'product_sale_rejected' || code === 'first_shift_required')), code === 'first_shift_required');
  }
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('order' in result) || !('payment' in result)
      || !('items' in result) || !Array.isArray(result.items)
      || !result.order || typeof result.order !== 'object' || !('id' in result.order)
      || typeof result.order.id !== 'string' || !('total_minor' in result.order)
      || result.order.total_minor !== payload.expected_total_minor || !result.payment
      || typeof result.payment !== 'object' || !('status' in result.payment) || result.payment.status !== 'confirmed'
      || !('method' in result.payment) || result.payment.method !== 'cash'
      || !('amount_minor' in result.payment) || result.payment.amount_minor !== payload.expected_total_minor) {
    throw new Error('No se pudo confirmar el resultado. Reintenta sin cambiar la compra.');
  }
  return result as ProductSaleResult;
}


export async function resolveCashProductSale(request: AuthenticatedRequest, registerId: string,
                                             payload: ProductSaleInput, key: string): Promise<'completed' | 'cancelled'> {
  const response = await request(`/api/v1/registers/${encodeURIComponent(registerId)}/product-sales/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('No se pudo resolver la compra.');
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('status' in result)) throw new Error('Respuesta inválida.');
  if (result.status === 'cancelled') return 'cancelled';
  if (result.status === 'completed' && 'order_id' in result && typeof result.order_id === 'string'
      && 'total_minor' in result && result.total_minor === payload.expected_total_minor) return 'completed';
  throw new Error('Respuesta inválida.');
}


export interface PendingProductSale { key: string; registerId: string; payload: ProductSaleInput }

export async function getPendingProductSale(request: AuthenticatedRequest): Promise<PendingProductSale | null> {
  const response = await request('/api/v1/registers/product-sale-intent');
  if (!response.ok) throw new Error('No se pudo consultar la compra pendiente.');
  return await response.json() as PendingProductSale | null;
}

export async function prepareProductSale(request: AuthenticatedRequest, intent: PendingProductSale): Promise<void> {
  const response = await request(`/api/v1/registers/${encodeURIComponent(intent.registerId)}/product-sale-intent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.key },
    body: JSON.stringify(intent.payload),
  });
  if (!response.ok) throw new Error('No se pudo preparar la compra.');
}

export interface CardIntent {
  id: string;
  payment_intent_id: string;
  device_id: string;
  amount_minor: number;
  status: 'OPEN' | 'ON_TERMINAL' | 'PROCESSING' | 'PROCESSED' | 'CANCELED' | 'ABANDONED' | string;
  authorization_code?: string | null;
  card_brand?: string | null;
  last_four_digits?: string | null;
}

export async function createCardIntent(
  request: AuthenticatedRequest,
  registerId: string,
  amountMinor: number,
  externalReference: string
): Promise<CardIntent> {
  const response = await request(
    `/api/v1/registers/${encodeURIComponent(registerId)}/card-intent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount_minor: amountMinor, external_reference: externalReference }),
    }
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string'
      ? body.detail
      : 'No se pudo iniciar el cobro con tarjeta en la terminal.';
    throw new Error(detail);
  }
  return (await response.json()) as CardIntent;
}

export async function getCardIntentStatus(
  request: AuthenticatedRequest,
  registerId: string,
  intentId: string
): Promise<CardIntent> {
  const response = await request(
    `/api/v1/registers/${encodeURIComponent(registerId)}/card-intent/${encodeURIComponent(intentId)}`
  );
  if (!response.ok) {
    throw new Error('No se pudo consultar el estado del cobro en la terminal.');
  }
  return (await response.json()) as CardIntent;
}

export async function cancelCardIntent(
  request: AuthenticatedRequest,
  registerId: string,
  intentId: string
): Promise<boolean> {
  const response = await request(
    `/api/v1/registers/${encodeURIComponent(registerId)}/card-intent/${encodeURIComponent(intentId)}`,
    { method: 'DELETE' }
  );
  if (!response.ok) {
    throw new Error('No se pudo cancelar el cobro en la terminal.');
  }
  const result: unknown = await response.json().catch(() => ({ cancelled: true }));
  return Boolean(result && typeof result === 'object' && 'cancelled' in result ? result.cancelled : true);
}

export async function submitCardProductSale(
  request: AuthenticatedRequest,
  registerId: string,
  payload: ProductSaleInput & { card_intent_id: string },
  key: string
): Promise<ProductSaleResult> {
  const response = await request(
    `/api/v1/registers/${encodeURIComponent(registerId)}/product-sales/card`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const code =
      body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'code' in body.error
        ? body.error.code
        : null;
    throw new ProductSaleError(
      response.status,
      response.status === 403 ||
        response.status === 422 ||
        (response.status === 409 && (code === 'product_sale_rejected' || code === 'first_shift_required')),
      code === 'first_shift_required'
    );
  }
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== 'object' ||
    !('order' in result) ||
    !('payment' in result) ||
    !('items' in result) ||
    !Array.isArray(result.items) ||
    !result.order ||
    typeof result.order !== 'object' ||
    !('id' in result.order) ||
    typeof result.order.id !== 'string' ||
    !('total_minor' in result.order) ||
    result.order.total_minor !== payload.expected_total_minor ||
    !result.payment ||
    typeof result.payment !== 'object' ||
    !('status' in result.payment) ||
    result.payment.status !== 'confirmed' ||
    !('method' in result.payment) ||
    result.payment.method !== 'card' ||
    !('amount_minor' in result.payment) ||
    result.payment.amount_minor !== payload.expected_total_minor
  ) {
    throw new Error('No se pudo confirmar el resultado del cobro con tarjeta.');
  }
  return result as ProductSaleResult;
}

export interface EligibleProductReturn {
  order_item_id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_amount_minor: number;
  line_total_minor: number;
  original_payment_method: string;
  created_at: string;
}

export interface ProductReturnInput {
  order_item_id: string;
  reason: string;
  disposition: 'restock' | 'waste';
  payout_method: 'cash' | 'card';
}

export interface ProductRefundResult {
  id: string;
  order_item_id: string;
  branch_id: string;
  register_id: string;
  shift_id: string;
  financial_shift_id: string | null;
  actor_id: string;
  reason: string;
  disposition: 'restock' | 'waste';
  payout_method: 'cash' | 'card';
  amount_minor: number;
  quantity: number;
  idempotency_key: string;
  created_at: string;
}

export async function listEligibleProductReturns(
  request: AuthenticatedRequest,
  registerId: string,
  memberId: string
): Promise<EligibleProductReturn[]> {
  const response = await request(
    `/api/v1/registers/${encodeURIComponent(registerId)}/members/${encodeURIComponent(memberId)}/eligible-product-returns`
  );
  if (!response.ok) {
    throw new Error('No se pudieron consultar los productos elegibles para devolución.');
  }
  return (await response.json()) as EligibleProductReturn[];
}

export async function submitProductReturn(
  request: AuthenticatedRequest,
  registerId: string,
  payload: ProductReturnInput,
  key: string
): Promise<ProductRefundResult> {
  const response = await request(
    `/api/v1/registers/${encodeURIComponent(registerId)}/product-returns`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string'
        ? body.detail
        : body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'message' in body.error && typeof body.error.message === 'string'
          ? body.error.message
          : 'No se pudo registrar la devolución.';
    throw new Error(message);
  }
  return (await response.json()) as ProductRefundResult;
}
