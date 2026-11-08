import type { AuthenticatedRequest } from './membershipCheckoutApi';

export interface OverviewTerminalRow { terminal_id: string | null; terminal_name: string | null; count: number; amount_minor: number }
export interface OverviewMethodRow { method: 'cash' | 'transfer' | 'card' | 'credit'; label: string; count: number; gross_minor: number;
  refunds_minor: number; amount_minor: number; terminals?: OverviewTerminalRow[] }
export interface OverviewShiftDiscrepancy { shift_id: string; difference_minor: number; register_id?: string;
  register_name?: string | null; opened_at?: string | null; closed_at?: string | null }
export interface OverviewCancellations { total_count: number; product_sales: { count: number };
  product_refunds: { count: number; amount_minor: number };
  rental_cancellations: { count: number; refund_amount_minor: number; cancelled_debt_minor: number; unreviewed_count: number } }
export interface OverviewDeposits { held_minor: number; refunded_minor: number; retained_minor: number }

export interface OwnerOverviewResponse {
  period: { from: string; to: string; branch_id: string; timezone: string };
  pulse: { confirmed_minor: number; alerts_count: number };
  finances: { cash_minor: number; card_minor: number; confirmed_count: number; pending_transfer_minor: number;
    pending_transfer_count: number; shift_discrepancies: OverviewShiftDiscrepancy[];
    count_discrepancies: { shift_id: string; product: string; expected_quantity: number | null; physical_quantity: number }[];
    by_method?: OverviewMethodRow[]; deposits?: OverviewDeposits };
  cancellations?: OverviewCancellations;
  members: { total_members: number; active_members: number; active_percent: number; median_tenure_months: number;
    expiring_soon_count: number; expired_count: number };
  attendance: { live_occupancy_count: number; gym_capacity: number; peak_hour: number | null; valley_hour: number | null;
    total_check_ins: number; memberships_sold_count: number; memberships_renewed_count: number };
  inventory: { active_products_count: number; low_stock_count: number; retail_units_sold: number; retail_revenue_minor: number };
  staff: { next_payday: string; days_until_payday: number; estimated_payroll_minor: number; staff_on_duty_count: number; staff_absent_count: number };
  alerts: { total_count: number; category_counts: { category: string; count: number }[] };
}

export async function getOwnerOverview(request: AuthenticatedRequest, period?: { from: string; to: string; branchId?: string }): Promise<OwnerOverviewResponse> {
  const params = new URLSearchParams();
  if (period) {
    params.set('from', period.from);
    params.set('to', period.to);
    if (period.branchId) params.set('branch_id', period.branchId);
  }
  const query = params.toString();
  const response = await request(`/api/v1/owner/overview${query ? `?${query}` : ''}`);
  if (!response.ok) throw new Error('No se pudo cargar el resumen del negocio.');
  return response.json() as Promise<OwnerOverviewResponse>;
}

/** Formats a shift window ("04 nov, 09:00 – 18:30") in the branch timezone; empty when the API sent no times. */
export function formatShiftWindow(openedAt: string | null | undefined, closedAt: string | null | undefined, timezone: string): string {
  const parse = (value: string | null | undefined) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };
  const opened = parse(openedAt), closed = parse(closedAt);
  if (!opened && !closed) return '';
  const zone = { timeZone: timezone };
  const day = (d: Date) => {
    const parts = new Intl.DateTimeFormat('es-MX', { ...zone, day: '2-digit', month: 'short' }).formatToParts(d);
    const get = (type: string) => parts.find(part => part.type === type)?.value.replace('.', '') ?? '';
    return `${get('day')} ${get('month')}`;
  };
  const time = (d: Date) => new Intl.DateTimeFormat('es-MX', { ...zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  if (!opened) return `Cierre ${day(closed!)}, ${time(closed!)}`;
  if (!closed) return `${day(opened)}, ${time(opened)} – sin cierre`;
  return day(opened) === day(closed)
    ? `${day(opened)}, ${time(opened)} – ${time(closed)}`
    : `${day(opened)} ${time(opened)} – ${day(closed)} ${time(closed)}`;
}
