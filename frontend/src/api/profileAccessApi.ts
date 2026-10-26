export interface ProfileBranchChoice {
  profile_id: string;
  branch_id: string;
  branch_name: string;
}

export interface ProfileIdentityChoice {
  id: string;
  kind: 'admin' | 'employee' | 'unlinked';
  source?: 'roster_profile';
  profile_id?: string;
  display_name: string;
  is_owner: boolean;
  can_manage_employees: boolean;
  branch_profiles: ProfileBranchChoice[];
}

export interface AdminProfileChoices {
  identities: ProfileIdentityChoice[];
  currentIdentityId: string;
}

export interface ProfileEntrySession {
  kind?: undefined;
  accessToken: string;
  expiresAt: number;
  purpose: string;
  identityId: string;
  profileId: string;
  branchId: string;
}

export interface ProfilePinSetupRequired {
  kind: 'setup_required';
  identityId: string;
  profileId: string;
  branchId: string;
}
export type ProfileEntryOutcome = ProfileEntrySession | ProfilePinSetupRequired;

export class ProfileAccessApiError extends Error {
  constructor(readonly status?: number) {
    super(status === 401 ? 'Authentication failed or the session expired.'
      : status === 403 ? 'This request is not allowed from this application origin.'
        : status === 429 ? 'Too many attempts. Try again later.'
          : 'Profile access could not be completed. Check your connection and try again.');
    this.name = 'ProfileAccessApiError';
  }
}

type FetchImpl = typeof fetch;
type AdminRequest = (path: string, init?: RequestInit) => Promise<Response>;
type Options = { apiOrigin?: string; fetchImpl?: FetchImpl };
type EntryInput = { identityId: string; profileId: string; branchId: string; pin: string; adminRequest?: AdminRequest };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_BASE = '/api/v1/auth/profile-access';

function configuredOrigin(value?: string): string {
  const defaultOrigin = typeof window !== 'undefined' && window.location.origin ? window.location.origin : import.meta.env?.VITE_API_BASE_URL;
  const configured = value ?? defaultOrigin;
  if (!configured) throw new ProfileAccessApiError();
  let parsed: URL;
  try { parsed = new URL(configured); } catch { throw new ProfileAccessApiError(); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) throw new ProfileAccessApiError();
  return parsed.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIdentities(value: unknown, allowUnlinked = false): ProfileIdentityChoice[] {
  if (!isRecord(value) || !Array.isArray(value.identities)) throw new ProfileAccessApiError();
  return value.identities.map(row => {
    if (!isRecord(row) || typeof row.id !== 'string' || !UUID.test(row.id) ||
        (row.kind !== 'admin' && row.kind !== 'employee' && row.kind !== 'unlinked') || typeof row.display_name !== 'string' ||
        typeof row.is_owner !== 'boolean' || typeof row.can_manage_employees !== 'boolean' || !Array.isArray(row.branch_profiles)) {
      throw new ProfileAccessApiError();
    }
    if (row.kind === 'unlinked' && !allowUnlinked) throw new ProfileAccessApiError();
    const branches = row.branch_profiles.map(branch => {
      if (!isRecord(branch) || typeof branch.profile_id !== 'string' || !UUID.test(branch.profile_id) ||
          typeof branch.branch_id !== 'string' || !UUID.test(branch.branch_id) || typeof branch.branch_name !== 'string') {
        throw new ProfileAccessApiError();
      }
      return { profile_id: branch.profile_id, branch_id: branch.branch_id, branch_name: branch.branch_name };
    });
    if (row.kind === 'unlinked') {
      if (row.source !== 'roster_profile' || typeof row.profile_id !== 'string' || !UUID.test(row.profile_id) ||
          row.profile_id !== row.id || row.is_owner || row.can_manage_employees || branches.length !== 1 ||
          branches[0].profile_id !== row.profile_id) throw new ProfileAccessApiError();
    } else if (row.source !== undefined || row.profile_id !== undefined) {
      throw new ProfileAccessApiError();
    }
    return { id: row.id, kind: row.kind, display_name: row.display_name, is_owner: row.is_owner,
      can_manage_employees: row.can_manage_employees, branch_profiles: branches,
      ...(row.kind === 'unlinked' ? { source: 'roster_profile' as const, profile_id: row.profile_id as string } : {}) };
  });
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new ProfileAccessApiError(response.status);
  try { return await response.json() as unknown; } catch { throw new ProfileAccessApiError(); }
}

export async function pairWithCode(code: string, options: Options = {}): Promise<void> {
  if (!/^\d{6}$/.test(code)) throw new ProfileAccessApiError();
  const origin = configuredOrigin(options.apiOrigin);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? globalThis.fetch.bind(globalThis))(`${origin}${PROFILE_BASE}/pair`, {
      method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairing_code: code }),
    });
  } catch { throw new ProfileAccessApiError(); }
  const body = await readJson(response);
  if (!isRecord(body) || body.status !== 'paired') throw new ProfileAccessApiError();
}

export async function getPairedProfileChoices(options: Options = {}): Promise<ProfileIdentityChoice[]> {
  const origin = configuredOrigin(options.apiOrigin);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? globalThis.fetch.bind(globalThis))(`${origin}${PROFILE_BASE}/context`, {
      credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' },
    });
  } catch { throw new ProfileAccessApiError(); }
  if (response.status === 401) return [];
  return parseIdentities(await readJson(response));
}

export async function getAdminProfileChoices(request: AdminRequest): Promise<AdminProfileChoices> {
  let response: Response;
  try { response = await request('/api/v1/admin/profile-access/choices'); }
  catch { throw new ProfileAccessApiError(); }
  const body = await readJson(response);
  if (!isRecord(body) || typeof body.current_identity_id !== 'string' || !UUID.test(body.current_identity_id)) {
    throw new ProfileAccessApiError();
  }
  return { identities: parseIdentities(body, true), currentIdentityId: body.current_identity_id };
}

function parseEntry(value: unknown, input: EntryInput): ProfileEntryOutcome {
  if (isRecord(value) && value.status === 'setup_required' && isRecord(value.identity) &&
      isRecord(value.profile) && typeof value.identity.id === 'string' && UUID.test(value.identity.id) &&
      typeof value.profile.id === 'string' && UUID.test(value.profile.id) &&
      typeof value.profile.branch_id === 'string' && UUID.test(value.profile.branch_id) &&
      value.identity.id === input.identityId && value.profile.id === input.profileId &&
      value.profile.branch_id === input.branchId && Object.keys(value).length === 3 &&
      Object.keys(value.identity).length === 1 && Object.keys(value.profile).length === 2) {
    return { kind: 'setup_required', identityId: value.identity.id, profileId: value.profile.id, branchId: value.profile.branch_id };
  }
  if (!isRecord(value) || typeof value.access_token !== 'string' || value.access_token.length < 40 ||
      value.token_type !== 'bearer' || typeof value.expires_at !== 'string' ||
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.expires_at) || !Number.isFinite(Date.parse(value.expires_at)) ||
      !isRecord(value.identity) || typeof value.identity.id !== 'string' || !UUID.test(value.identity.id) ||
      !isRecord(value.profile) || typeof value.profile.id !== 'string' || !UUID.test(value.profile.id) ||
      typeof value.profile.branch_id !== 'string' || !UUID.test(value.profile.branch_id) || typeof value.purpose !== 'string') {
    throw new ProfileAccessApiError();
  }
  if (value.identity.id !== input.identityId || value.profile.id !== input.profileId || value.profile.branch_id !== input.branchId ||
      Object.keys(value).some(key => !['access_token', 'token_type', 'expires_at', 'identity', 'profile', 'purpose'].includes(key))) {
    throw new ProfileAccessApiError();
  }
  return { accessToken: value.access_token, expiresAt: Date.parse(value.expires_at), purpose: value.purpose,
    identityId: value.identity.id, profileId: value.profile.id, branchId: value.profile.branch_id };
}

export async function enterEmployeeProfile(input: EntryInput, options: Options = {}): Promise<ProfileEntryOutcome> {
  if (!UUID.test(input.profileId) || !UUID.test(input.branchId) || !/^\d{6}$/.test(input.pin)) throw new ProfileAccessApiError();
  const init: RequestInit = { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_id: input.profileId, branch_id: input.branchId, pin: input.pin }) };
  let response: Response;
  if (input.adminRequest) {
    try { response = await input.adminRequest('/api/v1/admin/profile-access/sessions', init); }
    catch { throw new ProfileAccessApiError(); }
  } else {
    const origin = configuredOrigin(options.apiOrigin);
    try { response = await (options.fetchImpl ?? globalThis.fetch.bind(globalThis))(`${origin}${PROFILE_BASE}/sessions`, { ...init, credentials: 'include' }); }
    catch { throw new ProfileAccessApiError(); }
  }
  return parseEntry(await readJson(response), input);
}

export async function changeProfileInitialPin(input: EntryInput & { newPin: string }, options: Options = {}): Promise<void> {
  if (!UUID.test(input.profileId) || !UUID.test(input.branchId) || !/^\d{6}$/.test(input.pin) || !/^\d{6}$/.test(input.newPin)) {
    throw new ProfileAccessApiError();
  }
  const init: RequestInit = { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_id: input.profileId, branch_id: input.branchId, current_pin: input.pin, new_pin: input.newPin }) };
  let response: Response;
  if (input.adminRequest) {
    try { response = await input.adminRequest('/api/v1/admin/profile-access/first-pin-change', init); }
    catch { throw new ProfileAccessApiError(); }
  } else {
    const origin = configuredOrigin(options.apiOrigin);
    try { response = await (options.fetchImpl ?? globalThis.fetch.bind(globalThis))(`${origin}${PROFILE_BASE}/first-pin-change`, { ...init, credentials: 'include' }); }
    catch { throw new ProfileAccessApiError(); }
  }
  if (response.status !== 204) throw new ProfileAccessApiError(response.status);
}

export async function logoutProfileAccess(options: Options = {}): Promise<void> {
  const origin = configuredOrigin(options.apiOrigin);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? globalThis.fetch.bind(globalThis))(`${origin}${PROFILE_BASE}/logout`, {
      method: 'POST', credentials: 'include', redirect: 'error', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
  } catch { throw new ProfileAccessApiError(); }
  if (response.status !== 204) throw new ProfileAccessApiError(response.status);
}

export async function logoutEmployeeProfileSession(accessToken: string, options: Options = {}): Promise<void> {
  if (typeof accessToken !== 'string' || accessToken.length < 40) throw new ProfileAccessApiError();
  const origin = configuredOrigin(options.apiOrigin);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? globalThis.fetch.bind(globalThis))(`${origin}${PROFILE_BASE}/sessions/logout`, {
      method: 'POST', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: '{}',
    });
  } catch { throw new ProfileAccessApiError(); }
  if (response.status !== 204) throw new ProfileAccessApiError(response.status);
}

