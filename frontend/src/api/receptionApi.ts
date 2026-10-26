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

export class OperationalApiHttpError extends Error {
  readonly kind = 'http';
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly requestId?: string,
    readonly issues?: unknown
  ) {
    super(message);
    this.name = 'OperationalApiHttpError';
  }
}

export class OperationalApiNetworkError extends Error {
  readonly kind = 'network';
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
    let error: Record<string, unknown> = {};
    try {
      const parsed: unknown = await response.json();
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const envelope = (parsed as Record<string, unknown>).error;
        if (typeof envelope === 'object' && envelope !== null && !Array.isArray(envelope)) error = envelope as Record<string, unknown>;
      }
    } catch { /* Keep safe status mapping. */ }
    const code = typeof error.code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(error.code) ? error.code : undefined;
    const requestId = response.headers.get('X-Request-ID') || (typeof error.request_id === 'string' ? error.request_id : undefined);
    const allowedLocations = new Set(['body', 'query', 'path', 'header', 'cookie']);
    const allowedTypes = new Set(['missing', 'int_parsing', 'int_type', 'string_type', 'bool_parsing', 'uuid_parsing', 'extra_forbidden', 'json_invalid', 'greater_than', 'greater_than_equal', 'less_than', 'less_than_equal', 'string_too_short', 'string_too_long', 'string_pattern_mismatch', 'literal_error', 'invalid']);
    const issues = Array.isArray(error.issues) ? error.issues.slice(0, 20).flatMap((issue) => {
      if (typeof issue !== 'object' || issue === null || Array.isArray(issue)) return [];
      const candidate = issue as Record<string, unknown>;
      return [{ location: Array.isArray(candidate.location) ? candidate.location.filter((value): value is string => typeof value === 'string' && allowedLocations.has(value)).slice(0, 1) : [], type: typeof candidate.type === 'string' && allowedTypes.has(candidate.type) ? candidate.type : 'invalid' }];
    }) : undefined;
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
