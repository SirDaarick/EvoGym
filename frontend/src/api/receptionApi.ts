import { HttpError, NetworkError, parseErrorEnvelope } from './http';

const TOKEN_KEY = 'evogym:operational-session';

export interface ReceptionConfig {
  apiOrigin: string;
  branchId: string;
}

export interface OperationalMember {
  id: string;
  member_number: string;
  full_name: string;
  preferred_name: string | null;
  phone: string;
  status: string;
}

export interface OperationalMemberDetail extends OperationalMember {
  pending_balance_minor: number;
  has_pending_balance: boolean;
}

export class OperationalApiHttpError extends HttpError {
  constructor(status: number, message: string, code?: string, requestId?: string, issues?: unknown) {
    super(status, message, code, requestId, issues);
    this.name = 'OperationalApiHttpError';
  }
}

export class OperationalApiNetworkError extends NetworkError {
  constructor() {
    super('No se pudo conectar con el servidor. Intenta nuevamente.');
    this.name = 'OperationalApiNetworkError';
  }
}

export function getReceptionConfig(env: Partial<ImportMetaEnv> = import.meta.env): ReceptionConfig {
  const rawOrigin = env.VITE_API_BASE_URL?.trim();
  const branchId = env.VITE_BRANCH_ID?.trim();
  if (!rawOrigin || !branchId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(branchId)) {
    throw new Error('La recepción operativa requiere configurar VITE_API_BASE_URL y un VITE_BRANCH_ID UUID válido.');
  }
  let url: URL;
  try { url = new URL(rawOrigin); } catch { throw new Error('VITE_API_BASE_URL debe ser una URL válida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('VITE_API_BASE_URL debe ser un origen HTTP(S) sin ruta ni credenciales.');
  }
  return { apiOrigin: url.origin, branchId };
}

export function readOperationalToken(): string | null {
  if (typeof window !== 'undefined') {
    return window.sessionStorage.getItem(TOKEN_KEY);
  }
  return null;
}

export const resolveOperationalToken = readOperationalToken;

export function clearOperationalToken(): void {
  window.sessionStorage.removeItem(TOKEN_KEY);
}

export async function request<T>(config: ReceptionConfig, path: string, token?: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.apiOrigin}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new OperationalApiNetworkError();
  }
  if (!response.ok) {
    const { code, requestId, issues } = await parseErrorEnvelope(response);
    const messages: Record<number, string> = {
      401: token ? 'La sesión expiró o fue revocada. Inicia sesión nuevamente.' : 'Credenciales inválidas.',
      403: 'No tienes autorización para realizar esta acción.',
      409: 'La solicitud entra en conflicto con el estado actual.',
      429: 'Demasiadas solicitudes. Intenta nuevamente más tarde.',
      422: 'Revisa los datos enviados e intenta nuevamente.',
    };
    throw new OperationalApiHttpError(
      response.status,
      messages[response.status] ?? (response.status >= 500 ? 'El servidor no pudo completar la solicitud.' : `La solicitud falló (${response.status}).`),
      code,
      requestId,
      issues
    );
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export async function signInReception(loginIdentifier: string, pin: string): Promise<void> {
  const config = getReceptionConfig();
  const result = await request<{ access_token: string; token_type: string }>(config, '/api/v1/auth/staff/sessions', undefined, {
    method: 'POST',
    body: JSON.stringify({ login_identifier: loginIdentifier.trim(), pin, branch_id: config.branchId }),
  });
  if (result.token_type.toLowerCase() !== 'bearer' || !result.access_token) throw new Error('El servidor devolvió una sesión inválida.');
  window.sessionStorage.setItem(TOKEN_KEY, result.access_token);
}

export async function searchReceptionMembers(query: string, token: string): Promise<OperationalMember[]> {
  const config = getReceptionConfig();
  const params = new URLSearchParams({ page: '1', limit: '30', search: query.trim() });
  const result = await request<{ items: OperationalMember[] }>(config, `/api/v1/members?${params}`, token);
  return result.items;
}

export async function getReceptionMember(id: string, token: string): Promise<OperationalMemberDetail> {
  const config = getReceptionConfig();
  return request<OperationalMemberDetail>(config, `/api/v1/members/${encodeURIComponent(id)}`, token);
}
