export type AlertCategory = 'cash_difference' | 'waste' | 'expense' | 'pending_transfer' | 'return';
export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertPeriod = 'today' | 'week' | 'month' | 'all' | { from: string; to: string };

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
