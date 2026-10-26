export interface AdminSecurityAlert {
  id: string;
  staff_id: string;
  login_identifier: string;
  occurred_at: string;
  locked_until: string;
}

export interface AdminSecurityAlertPage {
  alerts: AdminSecurityAlert[];
  next_cursor: string | null;
}

export interface AdminSecurityAlertAcknowledgement {
  id: string;
  acknowledged_at: string;
  acknowledged_by: string;
}

export class AdminSecurityAlertsApiError extends Error {
  constructor(readonly status?: number) {
    super(status === 401 ? 'Your Admin session could not be verified.'
      : status === 403 ? 'Employee-management permission is required.'
        : 'Lockout alerts could not be loaded. Check your Admin session and try again.');
    this.name = 'AdminSecurityAlertsApiError';
  }
}

type AdminRequest = (path: string, init?: RequestInit) => Promise<Response>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
}

async function json(request: AdminRequest, path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try { response = await request(path, init); } catch { throw new AdminSecurityAlertsApiError(); }
  if (!response.ok) throw new AdminSecurityAlertsApiError(response.status);
  try { return await response.json() as unknown; } catch { throw new AdminSecurityAlertsApiError(); }
}

function parseAlert(row: unknown): AdminSecurityAlert {
  if (!isRecord(row) || !validUuid(row.id) || !validUuid(row.staff_id) ||
      typeof row.login_identifier !== 'string' || !row.login_identifier ||
      !validDate(row.occurred_at) || !validDate(row.locked_until)) throw new AdminSecurityAlertsApiError();
  return { id: row.id, staff_id: row.staff_id, login_identifier: row.login_identifier,
    occurred_at: row.occurred_at, locked_until: row.locked_until };
}

export async function listAdminSecurityAlerts(request: AdminRequest, options: { limit?: number; cursor?: string } = {}): Promise<AdminSecurityAlertPage> {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (options.cursor !== undefined && !validUuid(options.cursor))) {
    throw new AdminSecurityAlertsApiError();
  }
  const query = new URLSearchParams({ limit: String(limit) });
  if (options.cursor) query.set('cursor', options.cursor);
  const body = await json(request, `/api/v1/admin/security-alerts?${query.toString()}`);
  if (!isRecord(body) || !Array.isArray(body.alerts) ||
      (body.next_cursor !== null && !validUuid(body.next_cursor))) throw new AdminSecurityAlertsApiError();
  return { alerts: body.alerts.map(parseAlert), next_cursor: body.next_cursor as string | null };
}

export async function acknowledgeAdminSecurityAlert(request: AdminRequest, alertId: string): Promise<AdminSecurityAlertAcknowledgement> {
  if (!validUuid(alertId)) throw new AdminSecurityAlertsApiError();
  const body = await json(request, `/api/v1/admin/security-alerts/${alertId}/acknowledge`, { method: 'POST' });
  if (!isRecord(body) || body.id !== alertId || !validDate(body.acknowledged_at) || !validUuid(body.acknowledged_by)) {
    throw new AdminSecurityAlertsApiError();
  }
  return { id: alertId, acknowledged_at: body.acknowledged_at, acknowledged_by: body.acknowledged_by };
}
