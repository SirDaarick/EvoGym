import { getReceptionConfig, readOperationalToken } from './receptionApi';

export interface PublishedMembershipPlanVersion {
  id: string;
  price_minor: number;
  [key: string]: unknown;
}

export interface ActiveMembershipPlan {
  id: string;
  current_version: PublishedMembershipPlanVersion | null;
  [key: string]: unknown;
}

export interface CheckoutRegister {
  id: string;
  has_open_shift: boolean;
  [key: string]: unknown;
}

export interface CurrentRegisterShift {
  id: string;
  cash_register_id: string;
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

export class MemberNumberConflictError extends Error {
  readonly kind = 'conflict';

  constructor(readonly status: 409, readonly memberNumber: string) {
    super('Este número de socio ya pertenece a otra identidad.');
    this.name = 'MemberNumberConflictError';
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
  const response = await request<unknown>('/api/v1/catalog/plans?kind=membership&status=active');
  if (!Array.isArray(response) || !response.every(isActiveMembershipPlan)) {
    throw new Error('La respuesta de planes no es válida.');
  }
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPublishedVersion(value: unknown): value is PublishedMembershipPlanVersion {
  return isRecord(value) && isIdentifier(value.id)
    && typeof value.price_minor === 'number' && Number.isSafeInteger(value.price_minor) && value.price_minor >= 0;
}

function isActiveMembershipPlan(value: unknown): value is ActiveMembershipPlan {
  return isRecord(value) && isIdentifier(value.id)
    && (value.current_version === null || isPublishedVersion(value.current_version));
}

function isCheckoutRegister(value: unknown): value is CheckoutRegister {
  return isRecord(value) && isIdentifier(value.id) && typeof value.has_open_shift === 'boolean';
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

    const query = new URLSearchParams({
      page: '1',
      limit: '100',
      search: requestBody.member_number,
      sort_by: 'member_number',
      sort_dir: 'asc',
    });
    let items: CreatedMember[];
    try {
      ({ items } = await request<MemberSearchResponse>(`/api/v1/members?${query}`));
      if (!Array.isArray(items)) throw new Error('Member search did not return an items list.');
    } catch {
      // Failed or incomplete reconciliation cannot establish whether this create succeeded.
      throw new CheckoutApiNetworkError('No se pudo verificar el resultado del registro. Reintentá con el mismo número y los mismos datos.');
    }
    const sameNumber = items.filter(member =>
      typeof member === 'object' && member !== null && member.member_number === requestBody.member_number,
    );
    const match = sameNumber.find(member => member.full_name === requestBody.full_name && member.phone === requestBody.phone);
    if (match) return match;
    if (sameNumber.length > 0) throw new MemberNumberConflictError(409, requestBody.member_number);
    throw new CheckoutApiNetworkError('La búsqueda no confirmó si el número de socio ya fue registrado. Reintentá con el mismo número y los mismos datos.');
  }
}

export async function getRegisters(): Promise<CheckoutRegister[]> {
  const response = await request<unknown>('/api/v1/registers');
  if (!Array.isArray(response) || !response.every(isCheckoutRegister)) {
    throw new Error('La respuesta de cajas no es válida.');
  }
  return response;
}

export async function getCurrentRegisterShift(registerId: string): Promise<CurrentRegisterShift> {
  const query = new URLSearchParams({ register_id: registerId });
  const response = await request<unknown>(`/api/v1/shifts/current?${query}`);
  if (!isRecord(response) || !isIdentifier(response.id) || !isIdentifier(response.cash_register_id)) {
    throw new Error('La respuesta del turno no es válida.');
  }
  return { ...response, id: response.id, cash_register_id: response.cash_register_id };
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
