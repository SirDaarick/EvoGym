/**
 * Typed HTTP client for Phase 5 offline/contingency sync endpoints (F5-D1..D10).
 */

export interface BootstrapRequest {
  station_code: string;
  reception_station_id?: string | null;
  rotate?: boolean;
  branch_id?: string;
  client_schema_version?: number;
}

export interface BootstrapDeviceDTO {
  device_id: string;
  device_prefix: string;
  token: string;
  expires_at: string;
  next_seq: number;
}

export interface BranchInfoDTO {
  id: string;
  code: string;
  name: string;
  timezone: string;
}

export interface ActivePeriodDTO {
  period_id: string;
  starts_on: string;
  ends_on: string;
  access: 'valid' | 'valid_with_outstanding_balance' | 'denied';
}

export interface RosterMemberDTO {
  member_id: string;
  member_number: string;
  full_name: string;
  phone_last4: string;
  photo_hash?: string | null;
  status: string;
  active_periods: ActivePeriodDTO[];
  has_debt: boolean;
  changed_at: string;
}

export interface CatalogItemDTO {
  product_id: string;
  code: string;
  name: string;
  unit: string;
  price_minor: number;
  is_active: boolean;
  on_hand: number;
}

export interface OpenShiftDTO {
  shift_id: string;
  opened_at: string;
  opening_cash_minor: number;
}

export interface RegisterDTO {
  register_id: string;
  name: string;
  open_shift?: OpenShiftDTO | null;
}

export interface SyncCursorDTO {
  changed_at: string;
  id: string;
}

export interface BootstrapResponse {
  device: BootstrapDeviceDTO;
  server_time: string;
  offline_grant_ttl_hours: number;
  branch: BranchInfoDTO;
  roster: RosterMemberDTO[];
  catalog: CatalogItemDTO[];
  registers: RegisterDTO[];
  cursor: SyncCursorDTO | null;
}

export interface SyncStatusResponse {
  device: {
    device_id: string;
    device_prefix: string;
    last_ingested_seq: number;
    expires_at: string;
  };
  server_time: string;
  open_audit_flags_count: number;
  pending_contingency_events_count: number;
}

export interface ContingencyEventIn {
  event_id: string;
  seq: number;
  event_type: 'attendance.check_in' | 'pos.cash_sale' | 'shift.arqueo_close' | 'shift.open';
  schema_version: number;
  actor_staff_id: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  client_recorded_at: string;
  clock_anchor_utc?: string | null;
  clock_monotonic_delta_ms?: number | null;
}

export interface IngestedEventResultDTO {
  event_id: string;
  seq: number;
  status: 'accepted' | 'flagged_audit' | 'rejected';
  reason_code?: string | null;
}

export interface IngestBatchResponse {
  ingested: IngestedEventResultDTO[];
  last_ingested_seq: number;
}

export interface RosterDeltaResponse {
  members: RosterMemberDTO[];
  removed_member_ids: string[];
  catalog?: CatalogItemDTO[] | null;
  registers: RegisterDTO[];
  next_cursor?: SyncCursorDTO | null;
  has_more: boolean;
  snapshot_required: boolean;
}

export class SyncApiError extends Error {
  readonly status: number;
  readonly body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'SyncApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  url: string,
  options: RequestInit = {},
  authToken?: string,
  branchId?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (branchId) {
    headers['X-Branch-ID'] = branchId;
  }

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // not JSON
    }
    const message =
      (body as { detail?: string })?.detail ||
      `Sync API error ${response.status}: ${response.statusText}`;
    throw new SyncApiError(response.status, message, body);
  }
  return response.json() as Promise<T>;
}

export async function postBootstrap(
  req: BootstrapRequest,
  bearerToken: string,
  branchId?: string,
  baseUrl = '/api/v1/sync',
): Promise<BootstrapResponse> {
  return request<BootstrapResponse>(
    `${baseUrl}/bootstrap`,
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
    bearerToken,
    branchId || req.branch_id,
  );
}

export async function getSyncStatus(
  deviceToken: string,
  baseUrl = '/api/v1/sync',
): Promise<SyncStatusResponse> {
  return request<SyncStatusResponse>(
    `${baseUrl}/status`,
    { method: 'GET' },
    deviceToken,
  );
}

export async function postContingencyEvents(
  batch: { events: ContingencyEventIn[] },
  deviceToken: string,
  baseUrl = '/api/v1/sync',
): Promise<IngestBatchResponse> {
  return request<IngestBatchResponse>(
    `${baseUrl}/contingency-events`,
    {
      method: 'POST',
      body: JSON.stringify(batch),
    },
    deviceToken,
  );
}

export async function getRosterDelta(
  params: { cursor?: string | null; limit?: number },
  deviceToken: string,
  baseUrl = '/api/v1/sync',
): Promise<RosterDeltaResponse> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const queryString = query.toString();
  const url = `${baseUrl}/roster-delta${queryString ? `?${queryString}` : ''}`;
  return request<RosterDeltaResponse>(url, { method: 'GET' }, deviceToken);
}
