import type { DemoState } from '../domain/models';
import { formatMoney } from './adapter';

export type AlertCategory = 'cash_difference' | 'waste' | 'expense' | 'pending_transfer' | 'return';
export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertPeriod = 'today' | 'week' | 'month' | 'all' | { from: string; to: string };

export interface OperationalAlert {
  id: string;
  category: AlertCategory;
  categoryLabel: string;
  severity: AlertSeverity;
  timestamp: string;
  shiftId?: string;
  title: string;
  detail: string;
  responsible: string;
  impactMinor: number;
  impactFormatted: string;
  targetRoute: string;
  actionLabel: string;
}

export interface CategorySummary {
  category: AlertCategory;
  label: string;
  count: number;
  amountMinor: number;
  percent: number;
  color: string;
}

export interface OperationalAlertsResult {
  alerts: OperationalAlert[];
  totalCount: number;
  kpis: {
    totalAlerts: number;
    cashImpactMinor: number;
    pendingTransfersMinor: number;
    totalImpactMinor: number;
  };
  categoryCounts: CategorySummary[];
}

export const ALERT_CATEGORY_CONFIG: Record<
  AlertCategory,
  { label: string; shortLabel: string; color: string; severity: AlertSeverity }
> = {
  cash_difference: {
    label: 'Diferencia en caja',
    shortLabel: 'Caja',
    color: '#A32222',
    severity: 'critical',
  },
  waste: {
    label: 'Merma de inventario',
    shortLabel: 'Merma',
    color: '#F59E0B',
    severity: 'warning',
  },
  expense: {
    label: 'Gasto de caja',
    shortLabel: 'Gasto',
    color: '#2455A4',
    severity: 'info',
  },
  pending_transfer: {
    label: 'Transferencia pendiente',
    shortLabel: 'Transferencia',
    color: '#FC6C06',
    severity: 'warning',
  },
  return: {
    label: 'Devolución',
    shortLabel: 'Devolución',
    color: '#8B5CF6',
    severity: 'warning',
  },
};

const mexicoCityDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function localDateKey(timestamp: string | Date): string {
  const dateObj = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (Number.isNaN(dateObj.getTime())) return '';
  const parts = mexicoCityDateFormatter.formatToParts(dateObj);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function matchesPeriod(
  timestamp: string,
  period: AlertPeriod,
  refDate: Date
): boolean {
  if (period === 'all') return true;

  const alertDateStr = localDateKey(timestamp);
  if (!alertDateStr) return false;

  if (typeof period === 'object') {
    return alertDateStr >= period.from && alertDateStr <= period.to;
  }

  const refDateStr = localDateKey(refDate);
  const refMs = Date.parse(`${refDateStr}T00:00:00Z`);
  const alertMs = Date.parse(`${alertDateStr}T00:00:00Z`);
  const diffDays = Math.round((refMs - alertMs) / (24 * 60 * 60 * 1000));

  if (period === 'today') {
    return alertDateStr === refDateStr;
  }

  if (period === 'week') {
    return diffDays >= 0 && diffDays <= 7;
  }

  if (period === 'month') {
    return diffDays >= 0 && diffDays <= 30;
  }

  return true;
}

export function getOperationalAlerts(
  state: DemoState,
  period: AlertPeriod = 'all',
  referenceDate?: string | Date
): OperationalAlertsResult {
  const refDate = referenceDate
    ? typeof referenceDate === 'string'
      ? new Date(referenceDate)
      : referenceDate
    : state.demoClock
    ? new Date(state.demoClock)
    : new Date();

  const rawAlerts: OperationalAlert[] = [];

  // 1. Cash discrepancies from closed shifts
  for (const shift of state.shifts ?? []) {
    if (
      shift.status === 'closed' &&
      shift.cashDifferenceMinor !== undefined &&
      shift.cashDifferenceMinor !== 0
    ) {
      const timestamp = shift.closedAt ?? shift.openedAt;
      const isDeficit = shift.cashDifferenceMinor < 0;
      const differenceAbsFormatted = formatMoney(Math.abs(shift.cashDifferenceMinor));
      const noteText = shift.closingNotes ? ` · ${shift.closingNotes}` : '';

      rawAlerts.push({
        id: `alert-shift-${shift.id}`,
        category: 'cash_difference',
        categoryLabel: ALERT_CATEGORY_CONFIG.cash_difference.label,
        severity: ALERT_CATEGORY_CONFIG.cash_difference.severity,
        timestamp,
        shiftId: shift.id,
        title: `Descuadre en ${shift.id}`,
        detail: `${isDeficit ? 'Faltante' : 'Sobrante'} de ${differenceAbsFormatted} MXN en arqueo (${shift.window})${noteText}`,
        responsible: `Turno ${shift.id}`,
        impactMinor: shift.cashDifferenceMinor,
        impactFormatted: `${isDeficit ? '-' : '+'}${differenceAbsFormatted} MXN`,
        targetRoute: '/owner/shifts',
        actionLabel: 'Revisar turno',
      });
    }
  }

  // 2. Inventory waste from StockMovements
  for (const movement of state.stockMovements ?? []) {
    if (movement.kind === 'waste') {
      const product = state.products?.find(p => p.id === movement.productId);
      const productName = product?.name ?? movement.productId;
      const unitPriceMinor = product?.priceMinor ?? 0;
      const impactMinor = unitPriceMinor * movement.quantity;
      const formattedImpact = `${formatMoney(impactMinor)} MXN`;

      rawAlerts.push({
        id: `alert-waste-${movement.id}`,
        category: 'waste',
        categoryLabel: ALERT_CATEGORY_CONFIG.waste.label,
        severity: ALERT_CATEGORY_CONFIG.waste.severity,
        timestamp: movement.recordedAt,
        shiftId: movement.shiftId,
        title: `Merma de ${productName}`,
        detail: movement.reason
          ? `${movement.quantity} ${movement.quantity === 1 ? 'unidad descartada' : 'unidades descartadas'} por merma (${productName}). Motivo: ${movement.reason}.`
          : `${movement.quantity} ${movement.quantity === 1 ? 'unidad descartada' : 'unidades descartadas'} por merma o rotura (${productName}).`,
        responsible: movement.shiftId ? `Turno ${movement.shiftId}` : 'Inventario general',
        impactMinor,
        impactFormatted: formattedImpact,
        targetRoute: '/owner/inventory',
        actionLabel: 'Revisar inventario',
      });
    }
  }

  // 3. Unplanned cash expenses from state.expenses
  for (const expense of state.expenses ?? []) {
    const formattedImpact = `${formatMoney(expense.amountMinor)} MXN`;

    rawAlerts.push({
      id: `alert-expense-${expense.id}`,
      category: 'expense',
      categoryLabel: ALERT_CATEGORY_CONFIG.expense.label,
      severity: ALERT_CATEGORY_CONFIG.expense.severity,
      timestamp: expense.recordedAt,
      shiftId: expense.shiftId,
      title: `Gasto: ${expense.concept}`,
      detail: `Salida de efectivo autorizada para ${expense.concept}.`,
      responsible: expense.payeeName,
      impactMinor: expense.amountMinor,
      impactFormatted: formattedImpact,
      targetRoute: '/owner/shifts',
      actionLabel: 'Revisar turno',
    });
  }

  // 4. Pending transfers from state.sales
  for (const sale of state.sales ?? []) {
    if (sale.method === 'transfer' && sale.status === 'pending') {
      const formattedImpact = `${formatMoney(sale.amountMinor)} MXN`;

      rawAlerts.push({
        id: `alert-sale-${sale.id}`,
        category: 'pending_transfer',
        categoryLabel: ALERT_CATEGORY_CONFIG.pending_transfer.label,
        severity: ALERT_CATEGORY_CONFIG.pending_transfer.severity,
        timestamp: sale.recordedAt,
        shiftId: sale.shiftId,
        title: `Transferencia pendiente (${sale.description})`,
        detail: `Venta por transferencia bancaria pendiente de confirmación (${sale.quantity} uds).`,
        responsible: 'Mostrador / Recepción',
        impactMinor: sale.amountMinor,
        impactFormatted: formattedImpact,
        targetRoute: '/owner/history',
        actionLabel: 'Verificar transferencia',
      });
    }
  }

  // 5. Pending transfers from state.payments (membership payments)
  for (const payment of state.payments ?? []) {
    if (payment.method === 'transfer' && payment.status === 'pending') {
      const member = state.members?.find(m => m.id === payment.memberId);
      const memberName = member?.name ?? payment.memberId;
      const formattedImpact = `${formatMoney(payment.amountMinor)} MXN`;

      rawAlerts.push({
        id: `alert-payment-${payment.id}`,
        category: 'pending_transfer',
        categoryLabel: ALERT_CATEGORY_CONFIG.pending_transfer.label,
        severity: ALERT_CATEGORY_CONFIG.pending_transfer.severity,
        timestamp: payment.recordedAt,
        shiftId: payment.shiftId,
        title: `Transferencia suscripción (${payment.planName})`,
        detail: `Pago de membresía ${payment.planName} para ${memberName} no confirmado.`,
        responsible: memberName,
        impactMinor: payment.amountMinor,
        impactFormatted: formattedImpact,
        targetRoute: '/owner/history',
        actionLabel: 'Verificar transferencia',
      });
    }
  }

  // 5. Customer Returns / Devoluciones
  for (const sale of state.sales ?? []) {
    if (sale.refundedAt) {
      const member = state.members?.find(m => m.id === sale.memberId);
      const memberName = member?.name ?? sale.memberName ?? 'Socio';
      const formattedImpact = `-${formatMoney(sale.amountMinor)} MXN`;

      rawAlerts.push({
        id: `alert-return-sale-${sale.id}`,
        category: 'return',
        categoryLabel: ALERT_CATEGORY_CONFIG.return.label,
        severity: ALERT_CATEGORY_CONFIG.return.severity,
        timestamp: sale.refundedAt,
        shiftId: sale.shiftId,
        title: `Devolución de producto: ${sale.description}`,
        detail: `Devolución para ${memberName}. Reembolso de ${formatMoney(sale.amountMinor)} MXN.${sale.refundReason ? ` Motivo: ${sale.refundReason}.` : ''}`,
        responsible: memberName,
        impactMinor: -sale.amountMinor,
        impactFormatted: formattedImpact,
        targetRoute: '/owner/history',
        actionLabel: 'Ver historial',
      });
    }
  }

  for (const sup of state.supplementSales ?? []) {
    if (sup.refundedAt) {
      const member = state.members?.find(m => m.id === sup.memberId);
      const memberName = member?.name ?? sup.memberName ?? 'Socio';
      const formattedImpact = `-${formatMoney(sup.amountMinor)} MXN`;

      rawAlerts.push({
        id: `alert-return-sup-${sup.id}`,
        category: 'return',
        categoryLabel: ALERT_CATEGORY_CONFIG.return.label,
        severity: ALERT_CATEGORY_CONFIG.return.severity,
        timestamp: sup.refundedAt,
        shiftId: sup.shiftId,
        title: `Devolución de suplemento: ${sup.name}`,
        detail: `Devolución para ${memberName}. Reembolso de ${formatMoney(sup.amountMinor)} MXN.${sup.refundReason ? ` Motivo: ${sup.refundReason}.` : ''}`,
        responsible: memberName,
        impactMinor: -sup.amountMinor,
        impactFormatted: formattedImpact,
        targetRoute: '/owner/history',
        actionLabel: 'Ver historial',
      });
    }
  }

  for (const payment of state.payments ?? []) {
    if (payment.refundedAt) {
      const member = state.members?.find(m => m.id === payment.memberId);
      const memberName = member?.name ?? 'Socio';
      const formattedImpact = `-${formatMoney(payment.amountMinor)} MXN`;

      rawAlerts.push({
        id: `alert-return-pay-${payment.id}`,
        category: 'return',
        categoryLabel: ALERT_CATEGORY_CONFIG.return.label,
        severity: ALERT_CATEGORY_CONFIG.return.severity,
        timestamp: payment.refundedAt,
        shiftId: payment.shiftId,
        title: `Devolución de membresía: ${payment.planName}`,
        detail: `Cancelación y reembolso de membresía para ${memberName}. Reembolso de ${formatMoney(payment.amountMinor)} MXN.${payment.refundReason ? ` Motivo: ${payment.refundReason}.` : ''}`,
        responsible: memberName,
        impactMinor: -payment.amountMinor,
        impactFormatted: formattedImpact,
        targetRoute: '/owner/history',
        actionLabel: 'Ver historial',
      });
    }
  }

  // Other refund ledger events (lockers, gloves)
  for (const event of state.ledger ?? []) {
    if (event.id.startsWith('refund-event-')) {
      const alreadyHandled = rawAlerts.some(a => a.id.includes(event.paymentId));
      if (!alreadyHandled) {
        const member = state.members?.find(m => m.id === event.memberId);
        const memberName = member?.name ?? 'Socio';
        const formattedImpact = `-${formatMoney(Math.abs(event.amountMinor))} MXN`;

        rawAlerts.push({
          id: `alert-${event.id}`,
          category: 'return',
          categoryLabel: ALERT_CATEGORY_CONFIG.return.label,
          severity: ALERT_CATEGORY_CONFIG.return.severity,
          timestamp: event.recordedAt,
          shiftId: event.shiftId,
          title: 'Devolución de servicio',
          detail: `Devolución de servicio procesada para ${memberName}. Reembolso de ${formatMoney(Math.abs(event.amountMinor))} MXN.`,
          responsible: memberName,
          impactMinor: event.amountMinor,
          impactFormatted: formattedImpact,
          targetRoute: '/owner/history',
          actionLabel: 'Ver historial',
        });
      }
    }
  }

  // Filter alerts by period
  const filteredAlerts = rawAlerts.filter(alert =>
    matchesPeriod(alert.timestamp, period, refDate)
  );

  // Sort descending by timestamp (newest first)
  filteredAlerts.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  // Compute KPIs
  let cashImpactMinor = 0;
  let pendingTransfersMinor = 0;
  let totalImpactMinor = 0;

  const categoryAggregates: Record<AlertCategory, { count: number; amountMinor: number }> = {
    cash_difference: { count: 0, amountMinor: 0 },
    waste: { count: 0, amountMinor: 0 },
    expense: { count: 0, amountMinor: 0 },
    pending_transfer: { count: 0, amountMinor: 0 },
    return: { count: 0, amountMinor: 0 },
  };

  for (const alert of filteredAlerts) {
    const absImpact = Math.abs(alert.impactMinor);
    totalImpactMinor += absImpact;

    categoryAggregates[alert.category].count += 1;
    categoryAggregates[alert.category].amountMinor += absImpact;

    if (alert.category === 'cash_difference' || alert.category === 'expense' || alert.category === 'return') {
      cashImpactMinor += absImpact;
    } else if (alert.category === 'pending_transfer') {
      pendingTransfersMinor += absImpact;
    }
  }

  const totalCount = filteredAlerts.length;

  const categoryCounts: CategorySummary[] = (
    Object.keys(ALERT_CATEGORY_CONFIG) as AlertCategory[]
  )
    .filter(cat => categoryAggregates[cat].count > 0)
    .map(cat => ({
      category: cat,
      label: ALERT_CATEGORY_CONFIG[cat].label,
      count: categoryAggregates[cat].count,
      amountMinor: categoryAggregates[cat].amountMinor,
      percent: totalCount > 0 ? Math.round((categoryAggregates[cat].count / totalCount) * 100) : 0,
      color: ALERT_CATEGORY_CONFIG[cat].color,
    }));

  return {
    alerts: filteredAlerts,
    totalCount,
    kpis: {
      totalAlerts: totalCount,
      cashImpactMinor,
      pendingTransfersMinor,
      totalImpactMinor,
    },
    categoryCounts,
  };
}
