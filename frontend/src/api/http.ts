/**
 * Shared HTTP layer for the frontend API modules.
 *
 * Provides the request type, the backend error-envelope parser, typed errors,
 * a JSON request helper with safe retries and a small client factory.
 */

export type ApiRequest = (path: string, init?: RequestInit) => Promise<Response>;
export type AuthenticatedRequest = ApiRequest;

export const DEFAULT_NETWORK_MESSAGE = 'No se pudo conectar con el servidor.';

export interface ErrorIssue {
  location: string[];
  type: string;
}

export interface ParsedErrorEnvelope {
  code?: string;
  message?: string;
  requestId?: string;
  issues?: ErrorIssue[];
  metadata?: Record<string, unknown>;
  /** Legacy FastAPI `{detail: string}` payload. */
  detail?: string;
}

export type ErrorMessageMap = Partial<Record<string | number, string>>;

export class HttpError extends Error {
  readonly kind = 'http';
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly requestId?: string,
    readonly issues?: unknown,
    readonly metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class NetworkError extends Error {
  readonly kind = 'network';
  readonly status = 0;
  constructor(message: string = DEFAULT_NETWORK_MESSAGE) {
    super(message);
    this.name = 'NetworkError';
  }
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}

export function isNetworkError(value: unknown): value is NetworkError {
  return value instanceof NetworkError;
}

export function isAbortError(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { name?: unknown }).name === 'AbortError';
}

const CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const ALLOWED_LOCATIONS = new Set(['body', 'query', 'path', 'header', 'cookie']);
const ALLOWED_TYPES = new Set(['missing', 'int_parsing', 'int_type', 'string_type', 'bool_parsing', 'uuid_parsing', 'extra_forbidden', 'json_invalid', 'greater_than', 'greater_than_equal', 'less_than', 'less_than_equal', 'string_too_short', 'string_too_long', 'string_pattern_mismatch', 'literal_error', 'invalid']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeIssues(raw: unknown): ErrorIssue[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.slice(0, 20).flatMap((issue) => {
    if (!isRecord(issue)) return [];
    return [{
      location: Array.isArray(issue.location)
        ? issue.location.filter((v): v is string => typeof v === 'string' && ALLOWED_LOCATIONS.has(v)).slice(0, 1)
        : [],
      type: typeof issue.type === 'string' && ALLOWED_TYPES.has(issue.type) ? issue.type : 'invalid',
    }];
  });
}

/** Reads the backend error envelope from a non-ok response. Never throws. */
export async function parseErrorEnvelope(response: Response): Promise<ParsedErrorEnvelope> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const root = isRecord(body) ? body : {};
  const envelope = isRecord(root.error) ? root.error : {};
  const code = typeof envelope.code === 'string' && CODE_PATTERN.test(envelope.code) ? envelope.code : undefined;
  const headerId = response.headers?.get?.('X-Request-ID') || undefined;
  const requestId = headerId || (typeof envelope.request_id === 'string' && envelope.request_id ? envelope.request_id : undefined);
  const out: ParsedErrorEnvelope = {};
  if (code) out.code = code;
  if (typeof envelope.message === 'string') out.message = envelope.message;
  if (requestId) out.requestId = requestId;
  const issues = sanitizeIssues(envelope.issues);
  if (issues) out.issues = issues;
  if (isRecord(envelope.metadata)) out.metadata = envelope.metadata;
  if (typeof root.detail === 'string') out.detail = root.detail;
  return out;
}

export const DEFAULT_ERROR_MESSAGES: ErrorMessageMap = {
  401: 'La sesión expiró o fue revocada. Inicia sesión nuevamente.',
  403: 'No tienes autorización para realizar esta acción.',
  404: 'No se encontró el recurso solicitado.',
  409: 'La solicitud entra en conflicto con el estado actual.',
  422: 'Revisa los datos enviados e intenta nuevamente.',
  429: 'Demasiadas solicitudes. Intenta nuevamente más tarde.',
};

export function resolveErrorMessage(status: number, code: string | undefined, messages?: ErrorMessageMap): string {
  if (code && messages?.[code]) return messages[code] as string;
  if (messages?.[status]) return messages[status] as string;
  if (DEFAULT_ERROR_MESSAGES[status]) return DEFAULT_ERROR_MESSAGES[status] as string;
  if (status >= 500) return 'El servidor no pudo completar la solicitud.';
  return `La solicitud falló (${status}).`;
}

export interface RequestJsonOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  signal?: AbortSignal;
  messages?: ErrorMessageMap;
  /** Max retries for safe (GET/HEAD) requests. Default 2. */
  retry?: number;
  /** Base delay for exponential backoff in ms. Default 300. */
  retryDelayMs?: number;
  networkMessage?: string;
  errorFactory?: (status: number, parsed: ParsedErrorEnvelope) => Error;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function requestJson<T>(request: ApiRequest, path: string, opts: RequestJsonOptions = {}): Promise<T> {
  const method = (opts.method ?? 'GET').toUpperCase();
  const safe = method === 'GET' || method === 'HEAD';
  const maxRetries = safe ? (opts.retry ?? 2) : 0;
  const baseDelay = opts.retryDelayMs ?? 300;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const hasBody = opts.body !== undefined;
  if (hasBody && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const init: RequestInit = { method, headers };
  if (hasBody) init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  if (opts.signal) init.signal = opts.signal;

  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await request(path, init);
    } catch (error) {
      if (isAbortError(error) || opts.signal?.aborted) throw error;
      if (attempt < maxRetries) { await sleep(baseDelay * 2 ** attempt, opts.signal); continue; }
      throw error instanceof NetworkError ? error : new NetworkError(opts.networkMessage);
    }
    if (response.ok) {
      if (response.status === 204) return undefined as T;
      try {
        return (await response.json()) as T;
      } catch {
        throw new HttpError(response.status, 'Respuesta inválida del servidor.', 'invalid_response');
      }
    }
    if (attempt < maxRetries && RETRYABLE_STATUS.has(response.status)) {
      await sleep(baseDelay * 2 ** attempt, opts.signal);
      continue;
    }
    const parsed = await parseErrorEnvelope(response);
    if (opts.errorFactory) throw opts.errorFactory(response.status, parsed);
    throw new HttpError(
      response.status,
      resolveErrorMessage(response.status, parsed.code, opts.messages),
      parsed.code,
      parsed.requestId,
      parsed.issues,
      parsed.metadata
    );
  }
}

export interface HttpClientOptions {
  baseUrl: string;
  getAuthorization?: () => string | null | undefined;
  branchId?: string;
  fetchImpl?: typeof fetch;
}

export function createHttpClient(options: HttpClientOptions): ApiRequest {
  const base = options.baseUrl.replace(/\/+$/, '');
  return (path, init = {}) => {
    const extra: Record<string, string> = {};
    const authorization = options.getAuthorization?.();
    if (authorization) extra.Authorization = authorization;
    if (options.branchId) extra['X-Branch-ID'] = options.branchId;
    const given = init.headers;
    let headers: HeadersInit;
    if (given === undefined || (!Array.isArray(given) && !(typeof Headers !== 'undefined' && given instanceof Headers))) {
      headers = { ...extra, ...(given as Record<string, string> | undefined) };
    } else {
      const merged = new Headers(given);
      for (const [k, v] of Object.entries(extra)) if (!merged.has(k)) merged.set(k, v);
      headers = merged;
    }
    const impl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    return impl(`${base}${path}`, { ...init, headers });
  };
}

/** Request that defers to `globalThis.fetch` at call time (spy friendly). */
export const browserRequest: ApiRequest = (path, init) => globalThis.fetch(path, init);
