import type { ApiRequest } from './shiftsApi';

export interface PayrollItem {
  profile_id: string; full_name: string; base_minor: number; advances_minor: number; net_minor: number; daily_minor: number;
  paid: { payment_method: 'cash' | 'transfer'; paid_at: string } | null;
  advance_payment_method?: 'cash' | 'transfer' | null;
}
export interface PayrollWeek { items: PayrollItem[]; base_minor: number; advances_minor: number; net_minor: number }
export interface PayrollTarget { branch_id: string; staff_profile_id: string; week_start: string }

async function json<T>(request: ApiRequest, path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init);
  if (!response.ok) throw new Error(response.status === 409 ? 'La nómina cambió. Actualiza e intenta nuevamente.' :
    response.status === 422 ? 'Revisa el importe y los datos de la nómina.' : 'No se pudo completar la operación de nómina.');
  return response.json() as Promise<T>;
}

function post(body: unknown, key: string): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) };
}

export const getPayrollWeek = (request: ApiRequest, branch: string, week: string) =>
  json<PayrollWeek>(request, `/api/v1/admin/payroll/weeks/${encodeURIComponent(week)}?branch_id=${encodeURIComponent(branch)}`);
export const recordPayrollAdvance = (request: ApiRequest, body: PayrollTarget & { amount_minor: number; notes?: string; payment_method: 'cash' | 'transfer' }, key: string) =>
  json<unknown>(request, '/api/v1/admin/payroll/advances', post(body, key));
export const payPayrollWeek = (request: ApiRequest, body: PayrollTarget & { payment_method: 'cash' | 'transfer' }, key: string) =>
  json<unknown>(request, '/api/v1/admin/payroll/payments', post(body, key));

export function branchPayrollDate(timeZone: string, now = new Date()): { weekStart: string; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  const local = new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00Z`);
  const weekday = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - weekday);
  return { weekStart: local.toISOString().slice(0, 10), weekday };
}

export interface PayrollHistoryItem extends PayrollItem { paid_minor: number; outflow_minor: number }
export interface PayrollHistoryTotals { base_minor: number; advances_minor: number; net_minor: number; paid_minor: number; outflow_minor: number }
export interface PayrollHistoryWeek extends PayrollHistoryTotals {
  week_start: string; branch_id: string; branch_name: string; items: PayrollHistoryItem[];
}
export interface PayrollHistory extends PayrollHistoryTotals {
  from: string; to: string; branches: { id: string; name: string }[]; weeks: PayrollHistoryWeek[];
}

export const getPayrollHistory = (request: ApiRequest, from: string, to: string, branchId?: string) => {
  const params = new URLSearchParams({ from, to, ...(branchId ? { branch_id: branchId } : {}) });
  return json<PayrollHistory>(request, `/api/v1/admin/payroll/history?${params}`);
};
