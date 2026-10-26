export type EmployeeSessionPurpose = 'phone' | 'reception';

export interface EmployeeProfileChoice {
  id: string;
  full_name: string;
  position: string;
}

export interface EmployeeSession {
  accessToken: string;
  expiresAt: number;
  purpose: EmployeeSessionPurpose;
  profile: EmployeeProfileChoice | null;
}

export class EmployeeAuthError extends Error {
  constructor(readonly status?: number) {
    super(status === 429 ? 'Too many attempts. Wait before trying again.'
      : status === 401 ? 'The employee PIN or Reception station could not be verified.'
        : 'Employee access could not be completed. Check the connection and try again.');
    this.name = 'EmployeeAuthError';
  }
}

type FetchImpl = typeof fetch;
type Options = { apiOrigin?: string; fetchImpl?: FetchImpl };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function origin(apiOrigin?: string): string {
  const configured = apiOrigin ?? import.meta.env?.VITE_API_BASE_URL;
  if (!configured) throw new EmployeeAuthError();
  let parsed: URL;
  try { parsed = new URL(configured); } catch { throw new EmployeeAuthError(); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) throw new EmployeeAuthError();
  return parsed.origin;
}

async function json(response: Response): Promise<unknown> {
  if (!response.ok) throw new EmployeeAuthError(response.status);
  try { return await response.json() as unknown; } catch { throw new EmployeeAuthError(); }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSession(value: unknown, purpose: EmployeeSessionPurpose, profile: EmployeeProfileChoice | null): EmployeeSession {
  if (!record(value) || typeof value.access_token !== 'string' || value.access_token.length < 40 ||
      value.token_type !== 'bearer' || typeof value.expires_at !== 'string' ||
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.expires_at)) throw new EmployeeAuthError();
  const expiresAt = Date.parse(value.expires_at);
  if (!Number.isFinite(expiresAt)) throw new EmployeeAuthError();
  return { accessToken: value.access_token, expiresAt, purpose, profile };
}

export async function phoneLogin(input: { loginIdentifier: string; pin: string; branchId: string }, options: Options = {}): Promise<EmployeeSession> {
  if (!UUID_PATTERN.test(input.branchId) || !input.loginIdentifier.trim() || !input.pin) throw new EmployeeAuthError();
  let response: Response;
  try {
    response = await (options.fetchImpl ?? globalThis.fetch.bind(globalThis))(`${origin(options.apiOrigin)}/api/v1/auth/staff/sessions`, {
      method: 'POST', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login_identifier: input.loginIdentifier, pin: input.pin, branch_id: input.branchId }),
    });
  } catch { throw new EmployeeAuthError(); }
  return parseSession(await json(response), 'phone', null);
}

export async function listReceptionProfiles(stationCredential: string, options: Options = {}): Promise<EmployeeProfileChoice[]> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(stationCredential)) throw new EmployeeAuthError();
  let response: Response;
  try {
    response = await (options.fetchImpl ?? globalThis.fetch.bind(globalThis))(`${origin(options.apiOrigin)}/api/v1/auth/reception/profiles`, {
      method: 'POST', credentials: 'omit', cache: 'no-store', headers: { Authorization: `ReceptionStation ${stationCredential}` },
    });
  } catch { throw new EmployeeAuthError(); }
  const body = await json(response);
  if (!record(body) || !Array.isArray(body.profiles)) throw new EmployeeAuthError();
  return body.profiles.map(row => {
    if (!record(row) || typeof row.id !== 'string' || !UUID_PATTERN.test(row.id) ||
        typeof row.full_name !== 'string' || typeof row.position !== 'string') throw new EmployeeAuthError();
    return { id: row.id, full_name: row.full_name, position: row.position };
  });
}

export async function receptionLogin(input: { stationCredential: string; profile: EmployeeProfileChoice; pin: string }, options: Options = {}): Promise<EmployeeSession> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.stationCredential) || !UUID_PATTERN.test(input.profile.id) || !input.pin) {
    throw new EmployeeAuthError();
  }
  let response: Response;
  try {
    response = await (options.fetchImpl ?? globalThis.fetch.bind(globalThis))(`${origin(options.apiOrigin)}/api/v1/auth/reception/sessions`, {
      method: 'POST', credentials: 'omit', cache: 'no-store', headers: {
        Authorization: `ReceptionStation ${input.stationCredential}`, 'Content-Type': 'application/json',
      }, body: JSON.stringify({ profile_id: input.profile.id, pin: input.pin }),
    });
  } catch { throw new EmployeeAuthError(); }
  return parseSession(await json(response), 'reception', input.profile);
}
