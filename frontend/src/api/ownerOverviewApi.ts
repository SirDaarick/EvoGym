import type { AuthenticatedRequest } from './membershipCheckoutApi';

export interface OwnerOverviewResponse {
  period: { from: string; to: string; branch_id: string; timezone: string };
  pulse: { confirmed_minor: number; alerts_count: number };
  finances: { cash_minor: number; card_minor: number; confirmed_count: number; pending_transfer_minor: number;
    pending_transfer_count: number; shift_discrepancies: { shift_id: string; difference_minor: number }[];
    count_discrepancies: { shift_id: string; product: string; expected_quantity: number; physical_quantity: number }[] };
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
