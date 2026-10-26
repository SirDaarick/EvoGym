import { getReceptionConfig, readOperationalToken, OperationalApiHttpError, OperationalApiNetworkError } from './receptionApi';

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

export class CheckoutApiHttpError extends OperationalApiHttpError {
  constructor(status: number, message: string, code?: string, requestId?: string, issues?: unknown) {
    super(status, message, code, requestId, issues);
    this.name = 'CheckoutApiHttpError';
  }
}

export class CheckoutApiNetworkError extends OperationalApiNetworkError {
  constructor(message = 'No se pudo conectar con el servidor. Intenta nuevamente.') {
    super();
    this.message = message;
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
  } catch {
    throw new CheckoutApiNetworkError();
  }

  if (!response.ok) {
    let error: Record<string, unknown> = {};
    try {
      const parsed: unknown = await response.json();
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const envelope = (parsed as Record<string, unknown>).error;
        if (typeof envelope === 'object' && envelope !== null && !Array.isArray(envelope)) error = envelope as Record<string, unknown>;
      }
    } catch {
      // Keep safe status mapping when no JSON error body is available.
    }
    const code = typeof error.code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(error.code) ? error.code : undefined;
    const requestId = response.headers.get('X-Request-ID') || (typeof error.request_id === 'string' ? error.request_id : undefined);
    const allowedLocations = new Set(['body', 'query', 'path', 'header', 'cookie']);
    const allowedTypes = new Set(['missing', 'int_parsing', 'int_type', 'string_type', 'bool_parsing', 'uuid_parsing', 'extra_forbidden', 'json_invalid', 'greater_than', 'greater_than_equal', 'less_than', 'less_than_equal', 'string_too_short', 'string_too_long', 'string_pattern_mismatch', 'literal_error', 'invalid']);
    const issues = Array.isArray(error.issues) ? error.issues.slice(0, 20).flatMap((issue) => {
      if (typeof issue !== 'object' || issue === null || Array.isArray(issue)) return [];
      const candidate = issue as Record<string, unknown>;
      return [{ location: Array.isArray(candidate.location) ? candidate.location.filter((value): value is string => typeof value === 'string' && allowedLocations.has(value)).slice(0, 1) : [], type: typeof candidate.type === 'string' && allowedTypes.has(candidate.type) ? candidate.type : 'invalid' }];
    }) : undefined;
    const messages: Record<number, string> = { 401: 'La sesión expiró o fue revocada. Inicia sesión nuevamente.', 403: 'No tienes autorización para realizar esta acción.', 409: 'La solicitud entra en conflicto con el estado actual.', 429: 'Demasiadas solicitudes. Intenta nuevamente más tarde.', 422: 'Revisa los datos enviados e intenta nuevamente.' };
    const message = messages[response.status] ?? (response.status >= 500 ? 'El servidor no pudo completar la solicitud.' : `La solicitud falló (${response.status}).`);
    throw new CheckoutApiHttpError(response.status, message, code, requestId, issues);
  }
  if (response.status === 204) return undefined as T;
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
