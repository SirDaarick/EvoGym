import type { ApiRequest } from './shiftsApi';

export type ExpenseCategory = 'consumibles' | 'limpieza' | 'mantenimiento_piso' | 'mantenimiento_peso' | 'mantenimiento_cardio' | 'mantenimiento_box' | 'servicios' | 'general';
export type ExpenseMethod = 'cash' | 'transfer' | 'card';
export interface ExpenseInput { category: ExpenseCategory; concept: string; payee_name: string; amount_minor: number; voucher_reference?: string | null; evidence_key?: string | null }
export interface ExpenseDTO extends Omit<ExpenseInput, 'evidence_key'> {
  id: string; branch_id: string; shift_id: string | null; payment_method: ExpenseMethod;
  evidence_url: string | null; recorded_by_name: string; recorded_at: string;
  voided_at: string | null; voided_by_name: string | null; void_reason: string | null;
}
export interface CashContributionInput { concept: string; contributor_name: string; amount_minor: number }
export interface CashContributionDTO extends CashContributionInput { id: string; shift_id: string; recorded_by_name: string; recorded_at: string }
export interface MovementPage<T> { items: T[]; total_minor: number }

export class ExpenseApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); this.name = 'ExpenseApiError'; }
}

async function json<T>(request: ApiRequest, path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init);
  if (!response.ok) {
    let code: string | undefined;
    let backendMessage: string | undefined;
    try {
      const data = await response.json();
      code = data?.error?.code ?? data?.code;
      backendMessage = data?.error?.message ?? data?.message;
    } catch {
      // not JSON
    }
    if (code === 'purchase_cancellation_requires_review') {
      throw new ExpenseApiError(
        response.status,
        'Esta compra tiene productos que ya fueron vendidos o consumidos; requiere revisión de un administrador.',
        code,
      );
    }
    const messages: Record<number, string> = { 401: 'La sesión expiró o fue revocada.', 403: 'No tienes autorización para esta operación.', 409: 'El turno o el registro cambió. Actualiza e intenta nuevamente.', 422: 'Revisa los datos enviados e intenta nuevamente.', 501: 'La carga de fotos no está disponible.' };
    throw new ExpenseApiError(response.status, backendMessage || messages[response.status] || 'No se pudo completar la operación.', code);
  }
  return response.json() as Promise<T>;
}
function post(body: unknown, key?: string): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) };
}
const registerPath = (id: string) => `/api/v1/registers/${encodeURIComponent(id)}`;
export const createShiftExpense = (request: ApiRequest, id: string, body: ExpenseInput, key: string) =>
  json<ExpenseDTO>(request, `${registerPath(id)}/expenses`, post(body, key));
export const listShiftExpenses = (request: ApiRequest, id: string) =>
  json<MovementPage<ExpenseDTO>>(request, `${registerPath(id)}/expenses`);
export const createCashContribution = (request: ApiRequest, id: string, body: CashContributionInput, key: string) =>
  json<CashContributionDTO>(request, `${registerPath(id)}/cash-contributions`, post(body, key));
export const listCashContributions = (request: ApiRequest, id: string) =>
  json<MovementPage<CashContributionDTO>>(request, `${registerPath(id)}/cash-contributions`);
export const createBusinessExpense = (request: ApiRequest, body: ExpenseInput & { branch_id: string; payment_method: ExpenseMethod }, key: string) =>
  json<ExpenseDTO>(request, '/api/v1/admin/expenses', post(body, key));
export const listAdminExpenses = (request: ApiRequest, from: string, to: string, branchId?: string) => {
  const params = new URLSearchParams({ from, to, ...(branchId ? { branch_id: branchId } : {}) });
  return json<{ items: ExpenseDTO[]; branches: { id: string; name: string }[] }>(request, `/api/v1/admin/expenses?${params}`);
};
export const voidExpense = (request: ApiRequest, id: string, reason: string) =>
  json<ExpenseDTO>(request, `/api/v1/expenses/${encodeURIComponent(id)}/void`, post({ reason }));
export const requestEvidenceUpload = (request: ApiRequest, branchId: string, size: number) =>
  json<{ upload_url: string; evidence_key: string }>(request, '/api/v1/expenses/evidence-uploads', post({ branch_id: branchId, content_type: 'image/webp', file_size_bytes: size }));
export async function uploadEvidence(blob: Blob, url: string): Promise<void> {
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: blob });
  if (!response.ok) throw new ExpenseApiError(response.status, 'No se pudo subir la foto.');
}
