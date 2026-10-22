import { getReceptionConfig, readOperationalToken } from './receptionApi';

export interface PublishedMembershipPlanVersion {
  id: string;
  [key: string]: unknown;
}

export interface ActiveMembershipPlan {
  id: string;
  current_version?: PublishedMembershipPlanVersion | null;
  versions: PublishedMembershipPlanVersion[];
  [key: string]: unknown;
}

export interface CheckoutRegister {
  id: string;
  has_open_shift: boolean;
  [key: string]: unknown;
}

export interface CurrentRegisterShift {
  id: string;
  register_id: string;
  [key: string]: unknown;
}

export interface CreateMemberRequest {
  member_number: string;
  full_name: string;
  phone: string;
  email?: string | null;
}

export interface CreatedMember extends CreateMemberRequest {
  id: string;
  [key: string]: unknown;
}

interface MemberSearchResponse {
  items: CreatedMember[];
}

export interface MembershipSaleRequest {
  member_id: string;
  plan_version_id: string;
  source_shift_id?: string;
  cash_amount_minor?: number;
}

export interface MembershipTransferSaleRequest {
  member_id: string;
  plan_version_id: string;
}

export interface MembershipSaleResponse {
  order: Record<string, unknown>;
  item: Record<string, unknown>;
  payment: Record<string, unknown>;
  membership: Record<string, unknown> | null;
}

export class CheckoutApiHttpError extends Error {
  readonly kind = 'http';

  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'CheckoutApiHttpError';
  }
}

export class CheckoutApiNetworkError extends Error {
  readonly kind = 'network';

  constructor(message: string) {
    super(message);
    this.name = 'CheckoutApiNetworkError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = getReceptionConfig();
  const token = readOperationalToken();
  if (!token) throw new Error('La sesión operativa es obligatoria para consultar o registrar ventas.');

  let response: Response;
  try {
    response = await fetch(`${config.apiOrigin}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch (cause) {
    throw new CheckoutApiNetworkError(cause instanceof Error ? cause.message : 'No se pudo confirmar la respuesta del servidor.');
  }

  if (!response.ok) {
    let message = `La solicitud falló (${response.status}).`;
    try {
      const body = await response.json() as { detail?: unknown; message?: unknown };
      const serverMessage = body.detail ?? body.message;
      if (typeof serverMessage === 'string' && serverMessage.trim()) message = serverMessage;
    } catch {
      // Keep the status-based message when the server does not return a JSON error body.
    }
    throw new CheckoutApiHttpError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export async function getActiveMembershipPlans(): Promise<ActiveMembershipPlan[]> {
  const response = await request<{ items: ActiveMembershipPlan[] }>('/api/v1/catalog/plans?kind=membership&status=active');
  return response.items;
}

export function createMemberNumber(): string {
  return `M${crypto.randomUUID().replaceAll('-', '').slice(0, 31)}`;
}

export async function createMember(requestBody: CreateMemberRequest): Promise<CreatedMember> {
  try {
    return await request<CreatedMember>('/api/v1/members', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    if (!(error instanceof CheckoutApiHttpError) || error.status !== 409) throw error;

    try {
      const query = new URLSearchParams({
        page: '1',
        limit: '100',
        search: requestBody.member_number,
        sort_by: 'member_number',
        sort_dir: 'asc',
      });
      const { items } = await request<MemberSearchResponse>(`/api/v1/members?${query}`);
      const match = items.find(member =>
        member.member_number === requestBody.member_number
        && member.full_name === requestBody.full_name
        && member.phone === requestBody.phone,
      );
      if (match) return match;
    } catch {
      // A failed reconciliation cannot establish that the original request created this member.
    }
    throw error;
  }
}

export async function getRegisters(): Promise<CheckoutRegister[]> {
  const response = await request<{ items: CheckoutRegister[] }>('/api/v1/registers');
  return response.items;
}

export function getCurrentRegisterShift(registerId: string): Promise<CurrentRegisterShift> {
  const query = new URLSearchParams({ register_id: registerId });
  return request<CurrentRegisterShift>(`/api/v1/shifts/current?${query}`);
}

export function submitMembershipCashSale(
  registerId: string,
  requestBody: MembershipSaleRequest,
  idempotencyKey: string,
): Promise<MembershipSaleResponse> {
  return submitSale(registerId, 'membership-sales', requestBody, idempotencyKey);
}

export function submitMembershipTransferSale(
  registerId: string,
  requestBody: MembershipTransferSaleRequest,
  idempotencyKey: string,
): Promise<MembershipSaleResponse> {
  return submitSale(registerId, 'membership-transfer-sales', requestBody, idempotencyKey);
}

function submitSale(
  registerId: string,
  endpoint: 'membership-sales' | 'membership-transfer-sales',
  requestBody: MembershipSaleRequest | MembershipTransferSaleRequest,
  idempotencyKey: string,
): Promise<MembershipSaleResponse> {
  return request<MembershipSaleResponse>(`/api/v1/registers/${encodeURIComponent(registerId)}/${endpoint}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(requestBody),
  });
}
