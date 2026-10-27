export type ApiRequest = (path: string, init?: RequestInit) => Promise<Response>;

export interface CashRegisterDTO {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  status: string;
  has_open_shift: boolean;
}

export interface InventorySnapshotDTO {
  snapshot_id: string;
  source_state: string;
  items: { product_id: string; name: string; unit: string; initialized: boolean; expected_quantity: number | null }[];
}

export interface ShiftDTO {
  id: string;
  cash_register_id: string;
  opened_by: string;
  opened_at: string;
  closed_at: string | null;
  status: 'open' | 'closing' | 'closed';
  opening_cash_minor: number;
  denomination_counts: { denomination_minor: number; quantity: number }[];
  closing_denomination_counts: { denomination_minor: number; quantity: number }[];
  inventory_review: { snapshot_id: string; observations: { product_id: string; code: string; name: string; unit: string; physical_quantity: number; reason: string | null; expected_quantity: number | null; initialized: boolean | null }[] } | null;
  expected_cash_at_close_minor: number | null;
  current_expected_cash_minor: number | null;
  counted_cash_minor: number | null;
  difference_minor: number | null;
  closing_notes: string | null;
}

export interface ShiftPageDTO { items: ShiftDTO[]; total: number; offset: number; limit: number; }
export interface ShiftSummaryDTO {
  shift_id: string;
  confirmed_minor: number;
  confirmed_cash_minor: number;
  pending_transfer_minor: number;
  payment_methods: { method: 'cash' | 'transfer'; count: number; amount_minor: number }[];
  activities: { family: string; count: number; amount_minor: number }[];
  payments: { id: string; description: string; method: 'cash' | 'transfer'; status: 'confirmed' | 'pending' | 'under_review'; amount_minor: number; recorded_at: string }[];
  expected_cash_minor: number;
}

export class ShiftApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'ShiftApiError'; }
}

async function requestJson<T>(request: ApiRequest, path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init);
  if (!response.ok) {
    const messages: Record<number, string> = { 401: 'La sesión expiró o fue revocada.', 403: 'No tienes autorización para consultar estos datos.', 404: 'No se encontró el turno solicitado.', 409: 'El turno cambió. Actualiza los datos e intenta nuevamente.', 422: 'Revisa los datos enviados e intenta nuevamente.' };
    throw new ShiftApiError(response.status, messages[response.status] ?? (response.status >= 500 ? 'El servidor no pudo completar la operación.' : `La solicitud falló (${response.status}).`));
  }
  return response.json() as Promise<T>;
}

export function listCashRegisters(request: ApiRequest): Promise<CashRegisterDTO[]> {
  return requestJson(request, '/api/v1/registers');
}

export function getShiftSnapshot(request: ApiRequest, registerId: string): Promise<InventorySnapshotDTO> {
  return requestJson(request, `/api/v1/registers/${encodeURIComponent(registerId)}/inventory-snapshots`, { method: 'POST' });
}

export function getCurrentShift(request: ApiRequest, registerId: string): Promise<ShiftDTO> {
  return requestJson(request, `/api/v1/shifts/current?register_id=${encodeURIComponent(registerId)}`);
}

export function getShiftHistory(request: ApiRequest, registerId: string, offset: number, limit = 50): Promise<ShiftPageDTO> {
  return requestJson(request, `/api/v1/shifts?register_id=${encodeURIComponent(registerId)}&offset=${offset}&limit=${limit}`);
}

export function getShift(request: ApiRequest, id: string): Promise<ShiftDTO> {
  return requestJson(request, `/api/v1/shifts/${encodeURIComponent(id)}`);
}

export function getShiftSummary(request: ApiRequest, id: string): Promise<ShiftSummaryDTO> {
  return requestJson(request, `/api/v1/shifts/${encodeURIComponent(id)}/summary`);
}

export function openShift(request: ApiRequest, payload: {
  cash_register_id: string;
  inventory_snapshot_id: string;
  opening_cash_minor?: number;
  denomination_counts?: { denomination_minor: number; quantity: number }[];
  inventory_observations: { product_id: string; physical_quantity: number; reason?: string }[];
}): Promise<ShiftDTO> {
  return requestJson(request, '/api/v1/shifts/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

export function closeShift(request: ApiRequest, id: string, payload: {
  counted_cash_minor?: number;
  denomination_counts?: { denomination_minor: number; quantity: number }[];
  closing_notes?: string;
}): Promise<ShiftDTO> {
  return requestJson(request, `/api/v1/shifts/${encodeURIComponent(id)}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}
