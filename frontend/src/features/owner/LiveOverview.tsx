import { validPeriod, type ReportingPeriod } from '@/domain/reporting';
import { useEffect, useState } from 'react';
import type { AuthenticatedRequest } from '../../api/membershipCheckoutApi';
import { formatShiftWindow, getOwnerOverview, type OwnerOverviewResponse } from '../../api/ownerOverviewApi';
import { Notice, PageHeader } from '../../shared/ui';
import { OverviewView } from './Overview';

export function LiveOverview({ apiRequest }: { apiRequest: AuthenticatedRequest }) {
  const [period, setPeriod] = useState<ReportingPeriod | null>(null);
  const [data, setData] = useState<OwnerOverviewResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (period && !validPeriod(period)) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    setError('');
    void getOwnerOverview(apiRequest, period ?? undefined).then(result => {
      if (!active) return;
      setData(result);
      if (!period) setPeriod({ from: result.period.from, to: result.period.to });
    }).catch(() => { if (active) setError('No se pudo cargar el resumen del negocio.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiRequest, period?.from, period?.to]);

  if (!period || !data) return <div className="overview-page">
    <PageHeader eyebrow="PROPIETARIO · VISIÓN DEL PERIODO" title="Resumen del negocio" description="Cobros confirmados y diferencias observadas para revisar; no es un estado de resultados." />
    {loading && <p role="status">Cargando resumen…</p>}
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
  </div>;

  const { finances, members, attendance, inventory, alerts, staff } = data;
  const hour = (value: number | null) => value === null ? 'Sin datos' : `${String(value).padStart(2, '0')}:00`;
  return <OverviewView period={period} setPeriod={setPeriod} loading={loading} error={error} summary={validPeriod(period) && !loading && !error ? {
    confirmedMinor: data.pulse.confirmed_minor, confirmedCount: finances.confirmed_count,
    cashMinor: finances.cash_minor, cardMinor: finances.card_minor, transferPendingMinor: finances.pending_transfer_minor,
    shiftDiscrepancies: finances.shift_discrepancies.map(row => ({ id: row.shift_id, registerName: row.register_name ?? undefined,
      window: formatShiftWindow(row.opened_at, row.closed_at, data.period.timezone), cashDifferenceMinor: row.difference_minor })),
    byMethod: finances.by_method?.map(row => ({ method: row.method, label: row.label, count: row.count, grossMinor: row.gross_minor,
      refundsMinor: row.refunds_minor, amountMinor: row.amount_minor, terminals: row.terminals?.map(t => ({
        id: t.terminal_id ?? 'sin-terminal', name: t.terminal_name ?? 'Sin terminal asignada', count: t.count, amountMinor: t.amount_minor })) })),
    cancellations: data.cancellations && { totalCount: data.cancellations.total_count, productSales: data.cancellations.product_sales.count,
      productRefunds: { count: data.cancellations.product_refunds.count, amountMinor: data.cancellations.product_refunds.amount_minor },
      rental: { count: data.cancellations.rental_cancellations.count, refundMinor: data.cancellations.rental_cancellations.refund_amount_minor,
        cancelledDebtMinor: data.cancellations.rental_cancellations.cancelled_debt_minor,
        unreviewedCount: data.cancellations.rental_cancellations.unreviewed_count } },
    deposits: finances.deposits && { heldMinor: finances.deposits.held_minor, refundedMinor: finances.deposits.refunded_minor,
      retainedMinor: finances.deposits.retained_minor },
    countDiscrepancies: finances.count_discrepancies.map((row, index) => ({ id: `${row.shift_id}-${index}`,
      shiftId: row.shift_id, productName: row.product, variance: row.physical_quantity - row.expected_quantity })),
  } : null} attendance={{ liveOccupancyCount: attendance.live_occupancy_count, gymCapacity: attendance.gym_capacity,
    liveOccupancyPercent: attendance.gym_capacity ? Math.round(100 * attendance.live_occupancy_count / attendance.gym_capacity) : 0,
    peakHour: { label: hour(attendance.peak_hour) }, valleyHour: { label: hour(attendance.valley_hour) }, averageDurationMinutes: 0 }}
    memberAnalytics={{ activePercent: members.active_percent, activeMembers: members.active_members, totalMembers: members.total_members,
      tenure: { medianMonths: members.median_tenure_months }, expiringSoonCount: members.expiring_soon_count, expiredCount: members.expired_count }}
    inventory={{ kpis: { activeProductsCount: inventory.active_products_count, lowStockCount: inventory.low_stock_count,
      totalUnitsSold: inventory.retail_units_sold } }}
    alertsResult={{ totalCount: alerts.total_count, categoryCounts: alerts.category_counts.map(row => ({
      category: row.category, label: row.category, color: 'var(--color-warning, #d68b19)', count: row.count,
    })) }} gimiSummary={null} retailRevenueMinor={inventory.retail_revenue_minor}
    live={{ timezone: data.period.timezone, totalCheckIns: attendance.total_check_ins, sold: attendance.memberships_sold_count,
      renewed: attendance.memberships_renewed_count, payday: staff.next_payday, daysUntilPayday: staff.days_until_payday,
      payrollMinor: staff.estimated_payroll_minor, onDuty: staff.staff_on_duty_count, absent: staff.staff_absent_count }} />;
}
