export interface AdminBranchChoice {
  id: string;
  code: string;
  name: string;
}

export interface AdminRosterProfileChoice {
  id: string;
  full_name: string;
  position: string;
  is_active: boolean;
  staff_user_id: string | null;
}

export interface AdminStaffAccountChoice {
  id: string;
  login_identifier: string;
  is_active: boolean;
  link_state: 'linked' | 'unlinked';
  linked_profile_id: string | null;
}

export interface ReceptionStationChoice {
  id: string;
  branch_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface IssuedReceptionStation extends ReceptionStationChoice {
  station_credential: string;
}

export class StaffCredentialsApiError extends Error {
  constructor(readonly status?: number) {
    super(status === 429 ? 'Too many attempts. Wait a few minutes before trying again.'
      : status === 401 ? 'Your Admin session or employee credentials could not be verified.'
        : status === 404 ? 'The selected branch, employee, or account is no longer available.'
          : 'The request could not be completed. Check your connection and try again.');
    this.name = 'StaffCredentialsApiError';
  }
}

export class StaffCredentialsConfigurationError extends Error {
  constructor() {
    super('The employee PIN service is not configured. Contact your administrator.');
    this.name = 'StaffCredentialsConfigurationError';
  }
}

type AdminRequest = (path: string, init?: RequestInit) => Promise<Response>;
type FetchImpl = typeof fetch;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new StaffCredentialsApiError(response.status);
  try { return await response.json() as unknown; } catch { throw new StaffCredentialsApiError(); }
}

function parseBranches(value: unknown): AdminBranchChoice[] {
  if (!isRecord(value) || !Array.isArray(value.branches)) throw new StaffCredentialsApiError();
  return value.branches.map(row => {
    if (!isRecord(row) || !validUuid(row.id) || typeof row.code !== 'string' || typeof row.name !== 'string') {
      throw new StaffCredentialsApiError();
    }
    return { id: row.id, code: row.code, name: row.name };
  });
}

function parseProfiles(value: unknown): AdminRosterProfileChoice[] {
  if (!isRecord(value) || !Array.isArray(value.profiles)) throw new StaffCredentialsApiError();
  return value.profiles.map(row => {
    if (!isRecord(row) || !validUuid(row.id) || typeof row.full_name !== 'string' || typeof row.position !== 'string' ||
        typeof row.is_active !== 'boolean' || (row.staff_user_id !== null && !validUuid(row.staff_user_id))) {
      throw new StaffCredentialsApiError();
    }
    return { id: row.id, full_name: row.full_name, position: row.position, is_active: row.is_active, staff_user_id: row.staff_user_id };
  });
}

function parseAccounts(value: unknown): AdminStaffAccountChoice[] {
  if (!isRecord(value) || !Array.isArray(value.accounts)) throw new StaffCredentialsApiError();
  return value.accounts.map(row => {
    if (!isRecord(row) || !validUuid(row.id) || typeof row.login_identifier !== 'string' ||
        typeof row.is_active !== 'boolean' || (row.link_state !== 'linked' && row.link_state !== 'unlinked') ||
        (row.linked_profile_id !== null && !validUuid(row.linked_profile_id))) throw new StaffCredentialsApiError();
    return { id: row.id, login_identifier: row.login_identifier, is_active: row.is_active,
      link_state: row.link_state, linked_profile_id: row.linked_profile_id };
  });
}

export async function listAdminBranches(request: AdminRequest): Promise<AdminBranchChoice[]> {
  return parseBranches(await readJson(await request('/api/v1/admin/staff-accounts/branches')));
}

export async function listAdminRosterProfiles(request: AdminRequest, branchId: string): Promise<AdminRosterProfileChoice[]> {
  if (!validUuid(branchId)) throw new StaffCredentialsApiError();
  return parseProfiles(await readJson(await request(`/api/v1/admin/staff-accounts/roster-profiles?branch_id=${encodeURIComponent(branchId)}`)));
}

export async function listAdminStaffAccounts(request: AdminRequest, branchId: string): Promise<AdminStaffAccountChoice[]> {
  if (!validUuid(branchId)) throw new StaffCredentialsApiError();
  return parseAccounts(await readJson(await request(`/api/v1/admin/staff-accounts?branch_id=${encodeURIComponent(branchId)}`)));
}

export async function linkAdminStaffAccount(request: AdminRequest, profileId: string, staffUserId: string): Promise<void> {
  if (!validUuid(profileId) || !validUuid(staffUserId)) throw new StaffCredentialsApiError();
  const response = await request(`/api/v1/admin/staff-accounts/roster-profiles/${profileId}/link`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staff_user_id: staffUserId }),
  });
  if (!response.ok) throw new StaffCredentialsApiError(response.status);
  let body: unknown;
  try { body = await response.json() as unknown; } catch { throw new StaffCredentialsApiError(); }
  if (!isRecord(body) || body.profile_id !== profileId || body.staff_user_id !== staffUserId || body.link_state !== 'linked') {
    throw new StaffCredentialsApiError();
  }
}

export async function issueInitialPin(request: AdminRequest, staffUserId: string): Promise<string> {
  if (!validUuid(staffUserId)) throw new StaffCredentialsApiError();
  const response = await request(`/api/v1/staff/credentials/${staffUserId}/initial-pin`, {
    method: 'POST', cache: 'no-store',
  });
  const body = await readJson(response);
  if (!isRecord(body) || typeof body.initial_pin !== 'string' || !/^\d{6}$/.test(body.initial_pin)) {
    throw new StaffCredentialsApiError();
  }
  return body.initial_pin;
}

export async function listReceptionStations(request: AdminRequest, branchId: string): Promise<ReceptionStationChoice[]> {
  if (!validUuid(branchId)) throw new StaffCredentialsApiError();
  const body = await readJson(await request(`/api/v1/admin/staff-accounts/reception-stations?branch_id=${encodeURIComponent(branchId)}`));
  if (!isRecord(body) || !Array.isArray(body.stations)) throw new StaffCredentialsApiError();
  return body.stations.map(row => {
    if (!isRecord(row) || !validUuid(row.id) || !validUuid(row.branch_id) || typeof row.created_at !== 'string' ||
        typeof row.expires_at !== 'string' || (row.revoked_at !== null && typeof row.revoked_at !== 'string')) {
      throw new StaffCredentialsApiError();
    }
    return { id: row.id, branch_id: row.branch_id, created_at: row.created_at,
      expires_at: row.expires_at, revoked_at: row.revoked_at };
  });
}

export async function issueReceptionStation(request: AdminRequest, branchId: string): Promise<IssuedReceptionStation> {
  if (!validUuid(branchId)) throw new StaffCredentialsApiError();
  const body = await readJson(await request('/api/v1/admin/staff-accounts/reception-stations', {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch_id: branchId }),
  }));
  if (!isRecord(body) || !validUuid(body.id) || body.branch_id !== branchId ||
      typeof body.created_at !== 'string' || typeof body.expires_at !== 'string' ||
      body.revoked_at !== null || typeof body.station_credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.station_credential)) {
    throw new StaffCredentialsApiError();
  }
  return { id: body.id, branch_id: body.branch_id, created_at: body.created_at,
    expires_at: body.expires_at, revoked_at: null, station_credential: body.station_credential };
}

export async function revokeReceptionStation(request: AdminRequest, branchId: string, stationId: string): Promise<void> {
  if (!validUuid(branchId) || !validUuid(stationId)) throw new StaffCredentialsApiError();
  const response = await request(`/api/v1/admin/staff-accounts/reception-stations/${stationId}/revoke?branch_id=${encodeURIComponent(branchId)}`, {
    method: 'POST',
  });
  if (response.status !== 204) throw new StaffCredentialsApiError(response.status);
}

export async function deactivateStaffAccount(request: AdminRequest, staffId: string): Promise<void> {
  if (!validUuid(staffId)) throw new StaffCredentialsApiError();
  const response = await request(`/api/v1/admin/staff-accounts/deactivate/${staffId}`, { method: 'POST' });
  if (response.status !== 204) throw new StaffCredentialsApiError(response.status);
}

function configuredOrigin(apiOrigin?: string): string {
  const configured = apiOrigin ?? import.meta.env?.VITE_API_BASE_URL;
  if (!configured) throw new StaffCredentialsConfigurationError();
  let parsed: URL;
  try { parsed = new URL(configured); } catch { throw new StaffCredentialsConfigurationError(); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
    throw new StaffCredentialsConfigurationError();
  }
  return parsed.origin;
}

export async function submitFirstPinChange(
  input: { loginIdentifier: string; branchId: string; currentPin: string; newPin: string },
  options: { apiOrigin?: string; fetchImpl?: FetchImpl } = {},
): Promise<void> {
  if (!validUuid(input.branchId)) throw new StaffCredentialsApiError();
  const origin = configuredOrigin(options.apiOrigin);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? globalThis.fetch.bind(globalThis))(`${origin}/api/v1/staff/credentials/first-change`, {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login_identifier: input.loginIdentifier, branch_id: input.branchId,
        current_pin: input.currentPin, new_pin: input.newPin }),
    });
  } catch { throw new StaffCredentialsApiError(); }
  if (response.status !== 204) throw new StaffCredentialsApiError(response.status);
}
