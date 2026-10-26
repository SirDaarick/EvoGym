export type AdminSessionCategory = 'computer' | 'phone';

export interface AdminSession {
  accessToken: string;
  expiresAt: number;
}

export interface AdminSessionRecord {
  id: string;
  staffId: string;
  scopeKind: string;
  authMethod: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
}

export interface AdminPendingApproval {
  kind: 'pending';
  approvalId: string;
  pollToken: string;
}

export interface AdminAuthenticated {
  kind: 'authenticated';
  accessToken: string;
  expiresAt: number;
}

export type AdminLoginResult = AdminPendingApproval | AdminAuthenticated;

export class AdminAuthHttpError extends Error {
  readonly kind = 'http';
  constructor(readonly status: number, message: string, readonly code?: string, readonly requestId?: string) {
    super(message);
    this.name = 'AdminAuthHttpError';
  }
}

export class AdminAuthNetworkError extends Error {
  readonly kind = 'network';
  constructor() {
    super('The authentication service could not be reached.');
    this.name = 'AdminAuthNetworkError';
  }
}

export class AdminAuthContractError extends Error {
  readonly kind = 'contract';
  constructor() {
    super('The authentication service returned an invalid response.');
    this.name = 'AdminAuthContractError';
  }
}

export class AdminAuthReauthenticationRequired extends Error {
  readonly kind = 'reauthentication-required';
  readonly retryRequired = true;
  constructor() {
    super('Your session expired. Sign in again, then retry this action.');
    this.name = 'AdminAuthReauthenticationRequired';
  }
}

export interface AdminAuthClientOptions {
  apiOrigin?: string;
  category?: AdminSessionCategory;
  fetchImpl?: typeof fetch;
}

const messages: Record<number, string> = {
  401: 'Authentication failed or the session expired.',
  403: 'You are not authorized to perform this action.',
  409: 'The request conflicts with the current state.',
  429: 'Too many requests. Try again later.',
};

function isValidEmailToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSession(value: unknown): AdminSession {
  if (!isRecord(value) || typeof value.access_token !== 'string' || value.access_token.length === 0 ||
      value.token_type !== 'bearer' || typeof value.expires_at !== 'string' ||
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.expires_at)) throw new AdminAuthContractError();
  const expiresAt = Date.parse(value.expires_at);
  if (!Number.isFinite(expiresAt)) throw new AdminAuthContractError();
  return { accessToken: value.access_token, expiresAt };
}

async function parseHttpError(response: Response): Promise<AdminAuthHttpError> {
  let code: string | undefined;
  const headerRequestId = response.headers.get('X-Request-ID') ?? undefined;
  let requestId = headerRequestId && /^[A-Za-z0-9_.:-]{1,128}$/.test(headerRequestId) ? headerRequestId : undefined;
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      const error = isRecord(body.error) ? body.error : body;
      if (typeof error.code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(error.code)) code = error.code;
      if (!requestId && typeof error.request_id === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(error.request_id)) requestId = error.request_id;
    }
  } catch { /* HTTP status remains sufficient for safe client messaging. */ }
  const message = messages[response.status] ?? (response.status >= 500
    ? 'The server could not complete the request.'
    : `The request failed (${response.status}).`);
  return new AdminAuthHttpError(response.status, message, code, requestId);
}

export class AdminAuthClient {
  readonly #origin: string;
  #category: AdminSessionCategory;
  readonly #fetch: typeof fetch;
  #accessToken: string | null = null;
  #expiresAt: number | null = null;
  #refreshFlight: Promise<AdminSession> | null = null;
  #restoreFlight: Promise<AdminAuthenticated | null> | null = null;
  #refreshUncertain = false;
  #epoch = 0;
  #cookieOperations: Promise<unknown> = Promise.resolve();

  constructor(options: AdminAuthClientOptions = {}) {
    const defaultOrigin = typeof window !== 'undefined' && window.location.origin ? window.location.origin : import.meta.env?.VITE_API_BASE_URL;
    const configuredOrigin = options.apiOrigin ?? defaultOrigin;
    if (!configuredOrigin) throw new Error('An API origin is required for Admin authentication.');
    let parsedOrigin: URL;
    try { parsedOrigin = new URL(configuredOrigin); } catch { throw new Error('The Admin API origin must be a valid HTTP(S) origin.'); }
    if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.username || parsedOrigin.password ||
        (parsedOrigin.pathname !== '/' && parsedOrigin.pathname !== '') || parsedOrigin.search || parsedOrigin.hash) {
      throw new Error('The Admin API origin must not include credentials, a path, a query, or a fragment.');
    }
    this.#origin = parsedOrigin.origin;
    this.#category = options.category ?? 'computer';
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  getAccessToken(): string | null { return this.#accessToken; }
  getExpiresAt(): number | null { return this.#expiresAt; }

  clear(): void {
    this.#epoch += 1;
    this.#accessToken = null;
    this.#expiresAt = null;
  }

  login(loginIdentifier: string, password: string, category: AdminSessionCategory = this.#category): Promise<AdminLoginResult> {
    return this.#enqueueCookieOperation(async () => {
      this.clear();
      const epoch = this.#epoch;
      this.#category = category;
      this.#refreshUncertain = false;
      const response = await this.#send('/api/v1/auth/sessions', {
        method: 'POST',
        body: JSON.stringify({ login_identifier: loginIdentifier.trim(), password, category }),
      });
      if (response.status === 202) {
        const body: unknown = await this.#json(response);
        if (!isRecord(body) || body.status !== 'approval_required' || typeof body.approval_id !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.approval_id) ||
            typeof body.poll_token !== 'string' || body.poll_token.length !== 43) throw new AdminAuthContractError();
        if (epoch !== this.#epoch) throw new AdminAuthReauthenticationRequired();
        return { kind: 'pending', approvalId: body.approval_id, pollToken: body.poll_token };
      }
      if (response.status !== 201) throw await parseHttpError(response);
      const session = parseSession(await this.#json(response));
      if (epoch !== this.#epoch) throw new AdminAuthReauthenticationRequired();
      return this.#authenticate(session);
    });
  }

  pollApproval(approvalId: string, pollToken: string): Promise<AdminLoginResult | { kind: 'pending' }> {
    return this.#enqueueCookieOperation(async () => {
      const epoch = this.#epoch;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(approvalId) || pollToken.length !== 43) {
        throw new AdminAuthContractError();
      }
      const response = await this.#send(`/api/v1/auth/devices/approval/${approvalId}/poll`, {
        method: 'POST', body: JSON.stringify({ poll_token: pollToken }),
      });
      if (response.status === 202) {
        const body: unknown = await this.#json(response);
        if (!isRecord(body) || body.status !== 'pending') throw new AdminAuthContractError();
        if (epoch !== this.#epoch) throw new AdminAuthReauthenticationRequired();
        return { kind: 'pending' };
      }
      if (response.status !== 200) throw await parseHttpError(response);
      const session = parseSession(await this.#json(response));
      if (epoch !== this.#epoch) throw new AdminAuthReauthenticationRequired();
      return this.#authenticate(session);
    });
  }
  logout(): Promise<void> {
    this.clear();
    this.#refreshUncertain = true;
    return this.#enqueueCookieOperation(async () => {
      const response = await this.#send('/api/v1/auth/logout', {
        method: 'POST', body: JSON.stringify({ category: this.#category }),
      });
      if (response.status !== 204) throw await parseHttpError(response);
    });
  }
  async restore(): Promise<AdminAuthenticated | null> {
    if (this.#restoreFlight) return this.#restoreFlight;
    const flight = this.refresh().then(session => ({ kind: 'authenticated' as const, ...session })).catch(error => {
      if (error instanceof AdminAuthHttpError && error.status === 401) return null;
      throw error;
    }).finally(() => { if (this.#restoreFlight === flight) this.#restoreFlight = null; });
    this.#restoreFlight = flight;
    return flight;
  }

  async refresh(): Promise<AdminSession> {
    if (this.#refreshUncertain) throw new AdminAuthReauthenticationRequired();
    if (this.#refreshFlight) return this.#refreshFlight;
    const flight = this.#enqueueCookieOperation(() => this.#performRefresh(this.#epoch)).finally(() => { if (this.#refreshFlight === flight) this.#refreshFlight = null; });
    this.#refreshFlight = flight;
    return flight;
  }

  async fetchAuthenticated(path: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(path, this.#origin);
    if (url.origin !== this.#origin) throw new Error('Authenticated requests must target the configured API origin.');
    const method = (init.method ?? 'GET').toUpperCase();
    const token = this.#accessToken;
    if (!token) throw new AdminAuthReauthenticationRequired();
    const requestHeaders = new Headers(init.headers);
    requestHeaders.set('Authorization', `Bearer ${token}`);
    const first = await this.#send(url.href, { ...init, method, headers: requestHeaders });
    if (first.status !== 401) {
      if (!first.ok) throw await parseHttpError(first);
      return first;
    }
    if (method !== 'GET' && method !== 'HEAD') throw new AdminAuthReauthenticationRequired();
    const currentToken = this.#accessToken;
    if (!currentToken) throw new AdminAuthReauthenticationRequired();
    let retryToken = currentToken;
    if (currentToken === token) {
      try { retryToken = (await this.refresh()).accessToken; }
      catch (error) {
        if (error instanceof AdminAuthHttpError && error.status === 401) this.clear();
        if (error instanceof AdminAuthNetworkError) this.clear();
        if (error instanceof AdminAuthHttpError || error instanceof AdminAuthNetworkError) throw new AdminAuthReauthenticationRequired();
        throw error;
      }
    }
    const retryHeaders = new Headers(init.headers);
    retryHeaders.set('Authorization', `Bearer ${retryToken}`);
    const retry = await this.#send(url.href, { ...init, method, headers: retryHeaders });
    if (retry.status === 401) throw new AdminAuthReauthenticationRequired();
    if (!retry.ok) throw await parseHttpError(retry);
    return retry;
  }

  async approveDevice(token: string): Promise<void> {
    if (!isValidEmailToken(token)) throw new AdminAuthContractError();
    const response = await this.#sendPublic('/api/v1/auth/devices/approve', {
      method: 'POST', body: JSON.stringify({ token }),
    });
    if (response.status !== 204) throw await parseHttpError(response);
  }

  async startRecovery(loginIdentifier: string): Promise<void> {
    if (!loginIdentifier.trim()) throw new AdminAuthContractError();
    const response = await this.#sendPublic('/api/v1/auth/recovery/start', {
      method: 'POST', body: JSON.stringify({ login_identifier: loginIdentifier.trim() }),
    });
    if (response.status !== 202) throw await parseHttpError(response);
  }

  async completeRecovery(token: string, newPassword: string): Promise<void> {
    if (!isValidEmailToken(token) || !newPassword) throw new AdminAuthContractError();
    const response = await this.#sendPublic('/api/v1/auth/recovery/complete', {
      method: 'POST', body: JSON.stringify({ token, new_password: newPassword }),
    });
    if (response.status !== 204) throw await parseHttpError(response);
  }
  async listSessions(): Promise<AdminSessionRecord[]> {
    const response = await this.fetchAuthenticated('/api/v1/admin/sessions');
    const body: unknown = await this.#json(response);
    if (!isRecord(body) || !Array.isArray(body.sessions)) throw new AdminAuthContractError();
    return body.sessions.map((row): AdminSessionRecord => {
      if (!isRecord(row) || typeof row.id !== 'string' || typeof row.staff_id !== 'string' ||
          typeof row.scope_kind !== 'string' || typeof row.auth_method !== 'string' ||
          typeof row.issued_at !== 'string' || typeof row.expires_at !== 'string' || typeof row.revoked !== 'boolean') {
        throw new AdminAuthContractError();
      }
      return { id: row.id, staffId: row.staff_id, scopeKind: row.scope_kind, authMethod: row.auth_method,
        issuedAt: row.issued_at, expiresAt: row.expires_at, revoked: row.revoked };
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
      throw new AdminAuthContractError();
    }
    const response = await this.fetchAuthenticated(`/api/v1/admin/sessions/${sessionId}/revoke`, { method: 'POST' });
    const body: unknown = await this.#json(response);
    if (!isRecord(body) || body.revoked !== true) throw new AdminAuthContractError();
  }

  #authenticate(session: AdminSession): AdminAuthenticated {
    this.#accessToken = session.accessToken;
    this.#expiresAt = session.expiresAt;
    this.#refreshUncertain = false;
    return { kind: 'authenticated', ...session };
  }

  async #performRefresh(epoch: number): Promise<AdminSession> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#origin}/api/v1/auth/refresh`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: this.#category }),
      });
    } catch {
      this.#refreshUncertain = true;
      throw new AdminAuthNetworkError();
    }
    if (response.status !== 200) throw await parseHttpError(response);
    const session = parseSession(await this.#json(response));
    if (epoch !== this.#epoch) throw new AdminAuthReauthenticationRequired();
    return this.#authenticate(session);
  }

  async #send(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      if (init.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      response = await this.#fetch(path.startsWith('http') ? path : `${this.#origin}${path}`, {
        ...init, headers, credentials: 'include',
      });
    } catch { throw new AdminAuthNetworkError(); }
    return response;
  }

  async #sendPublic(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      if (init.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      response = await this.#fetch(`${this.#origin}${path}`, { ...init, headers, credentials: 'omit', redirect: 'error' });
    } catch { throw new AdminAuthNetworkError(); }
    return response;
  }
  #enqueueCookieOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#cookieOperations.then(operation, operation);
    this.#cookieOperations = result.then(() => undefined, () => undefined);
    return result;
  }
  async #json(response: Response): Promise<unknown> {
    try { return await response.json() as unknown; } catch { throw new AdminAuthContractError(); }
  }
}
