export interface AdminPairedDevice {
  id: string;
  staff_id: string;
  staff_login: string;
  device_name: string;
  paired_at: string;
  last_seen_at: string;
  revoked: boolean;
  revoked_at: string | null;
}

export interface AdminDevicePairingCode {
  id: string;
  pairing_code: string;
  expires_at: string;
}

export class StaffDevicesApiError extends Error {
  constructor(readonly status?: number) {
    super('Device pairing could not be completed.');
    this.name = 'StaffDevicesApiError';
  }
}

export class StaffDevicesConfigurationError extends Error {
  constructor() {
    super('Staff device pairing is not configured.');
    this.name = 'StaffDevicesConfigurationError';
  }
}

type AdminRequest = (path: string, init?: RequestInit) => Promise<Response>;
type FetchImpl = typeof fetch;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function parseDevice(value: unknown): AdminPairedDevice {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.staff_id) ||
      typeof value.staff_login !== 'string' || typeof value.device_name !== 'string' ||
      !isIsoDate(value.paired_at) || !isIsoDate(value.last_seen_at) || typeof value.revoked !== 'boolean' ||
      (value.revoked_at !== null && !isIsoDate(value.revoked_at))) throw new StaffDevicesApiError();
  return { id: value.id, staff_id: value.staff_id, staff_login: value.staff_login,
    device_name: value.device_name, paired_at: value.paired_at, last_seen_at: value.last_seen_at,
    revoked: value.revoked, revoked_at: value.revoked_at as string | null };
}

async function adminJson(request: AdminRequest, path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try { response = await request(path, init); } catch { throw new StaffDevicesApiError(); }
  if (!response.ok) throw new StaffDevicesApiError(response.status);
  try { return await response.json() as unknown; } catch { throw new StaffDevicesApiError(); }
}

export async function listAdminPairedDevices(request: AdminRequest): Promise<AdminPairedDevice[]> {
  const body = await adminJson(request, '/api/v1/admin/devices', { method: 'GET', cache: 'no-store' });
  if (!isRecord(body) || !Array.isArray(body.devices)) throw new StaffDevicesApiError();
  return body.devices.map(parseDevice);
}

export async function issueAdminDevicePairingCode(request: AdminRequest, staffId: string): Promise<AdminDevicePairingCode> {
  if (!isUuid(staffId)) throw new StaffDevicesApiError();
  const body = await adminJson(request, `/api/v1/admin/staff/${encodeURIComponent(staffId)}/device-pairing`, {
    method: 'POST', cache: 'no-store',
  });
  if (!isRecord(body) || !isUuid(body.id) || typeof body.pairing_code !== 'string' ||
      !/^\d{6}$/.test(body.pairing_code) || !isIsoDate(body.expires_at)) throw new StaffDevicesApiError();
  return { id: body.id, pairing_code: body.pairing_code, expires_at: body.expires_at };
}

export async function revokeAdminPairedDevice(request: AdminRequest, deviceId: string): Promise<void> {
  if (!isUuid(deviceId)) throw new StaffDevicesApiError();
  const body = await adminJson(request, `/api/v1/admin/devices/${encodeURIComponent(deviceId)}/revoke`, {
    method: 'POST', cache: 'no-store',
  });
  if (!isRecord(body) || body.revoked !== true) throw new StaffDevicesApiError();
}

export async function submitEmployeeDevicePairing(input: {
  loginIdentifier: string;
  pairingCode: string;
  deviceIdentifier: string;
  deviceName: string;
}, options: { apiOrigin?: string; fetchImpl?: FetchImpl } = {}): Promise<void> {
  const { apiOrigin, fetchImpl = fetch } = options;
  if (!apiOrigin) throw new StaffDevicesConfigurationError();
  let origin: URL;
  try {
    origin = new URL(apiOrigin);
    if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password ||
        origin.pathname !== '/' || origin.search || origin.hash) throw new Error();
  } catch { throw new StaffDevicesConfigurationError(); }
  if (!input.loginIdentifier.trim() || input.loginIdentifier.trim().length > 320 || !/^\d{6}$/.test(input.pairingCode) ||
      !isUuid(input.deviceIdentifier) || !input.deviceName.trim() || input.deviceName.trim().length > 128) {
    throw new StaffDevicesApiError();
  }
  let response: Response;
  try {
    response = await fetchImpl(`${origin.origin}/api/v1/auth/devices/pair`, {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login_identifier: input.loginIdentifier.trim(), pairing_code: input.pairingCode,
        device_identifier: input.deviceIdentifier, device_name: input.deviceName.trim() }),
    });
  } catch { throw new StaffDevicesApiError(); }
  if (!response.ok) throw new StaffDevicesApiError(response.status);
  let body: unknown;
  try { body = await response.json() as unknown; } catch { throw new StaffDevicesApiError(); }
  if (!isRecord(body) || !isUuid(body.device_id) || body.status !== 'paired') throw new StaffDevicesApiError();
}
