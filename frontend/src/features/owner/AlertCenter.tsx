import { formatMoney } from '@/shared/formatters/money';
import { ALERT_CATEGORY_CONFIG, type AlertCategory, type AlertPeriod } from '@/domain/alerts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Chart } from '@tanstack/charts/react';
import { defineChart } from '@tanstack/charts';
import { pie, polar, radialArc } from '@tanstack/charts/polar';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert01Icon, Cash01Icon, CreditCardIcon } from '@hugeicons/core-free-icons';

import { Badge, Button, EmptyState, PageHeader, Panel, TableRegion } from '../../shared/ui';
import { useOptionalDemo } from '../../demo/DemoProvider';
import { getOperationalAlerts, type OperationalAlert } from '../../demo/alertCenterSelector';
import {
  acknowledgeAdminSecurityAlert,
  AdminSecurityAlertsApiError,
  listAdminSecurityAlerts,
  type AdminSecurityAlert,
} from '../../api/adminSecurityAlertsApi';
import { useOptionalAdminSession } from '../auth/AdminSessionProvider';
import { listBranches, listPurchaseCostAlerts, type AuthenticatedRequest, type BranchItem, type PurchaseCostAlert } from '../../api/inventoryApi';
import {
  listRentalAlerts,
  reviewRentalAlert,
  type RentalCancellationDTO,
} from '../../api/rentalsApi';
import {
  getOwnerOverview,
  getOwnerOverviewAlerts,
  type AttendanceCorrectionAlert,
  type DebtOverrideCheckInAlert,
  type InventoryWasteAlert,
  type OwnerOverviewAlert,
  type OverviewShiftDiscrepancy,
  type SalesAlert,
  type SalesAlertSubtype,
} from '../../api/ownerOverviewApi';
import './AlertCenter.css';

type LiveAlertCategory =
  | 'sales'
  | 'inventory_waste'
  | 'rentals'
  | 'security'
  | 'debt_override_checkin'
  | 'attendance_correction';

type AlertFilterCategory = AlertCategory | 'all' | LiveAlertCategory;

type UnifiedCategory = AlertCategory | LiveAlertCategory;

interface UnifiedAlertRow {
  id: string;
  category: UnifiedCategory;
  categoryLabel: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: string;
  shiftId?: string;
  title: string;
  detail: string;
  responsible: string;
  impactMinor: number;
  impactFormatted: string;
  targetRoute?: string;
  filterTarget?: LiveAlertCategory;
  actionLabel: string;
}

interface ChartSlice {
  category: UnifiedCategory;
  count: number;
  label: string;
  shortLabel: string;
  percent: number;
  color: string;
}

const LIVE_CATEGORY_META: Record<
  LiveAlertCategory,
  { label: string; shortLabel: string; color: string; severity: 'critical' | 'warning' | 'info' }
> = {
  sales: { label: 'Ventas', shortLabel: 'Ventas', color: '#8B5CF6', severity: 'warning' },
  inventory_waste: { label: 'Mermas de inventario', shortLabel: 'Mermas', color: '#F59E0B', severity: 'warning' },
  rentals: { label: 'Cancelaciones de casilleros', shortLabel: 'Casilleros', color: '#FC6C06', severity: 'warning' },
  debt_override_checkin: { label: 'Entradas con adeudo', shortLabel: 'Adeudos', color: '#D97706', severity: 'warning' },
  attendance_correction: { label: 'Correcciones de asistencia', shortLabel: 'Asistencia', color: '#2455A4', severity: 'info' },
  security: { label: 'Seguridad / Bloqueos', shortLabel: 'Seguridad', color: '#A32222', severity: 'critical' },
};

const EMPTY_DEMO_RESULT = {
  totalCount: 0,
  alerts: [] as OperationalAlert[],
  categoryCounts: [],
  kpis: { cashImpactMinor: 0, pendingTransfersMinor: 0 },
};

const PERIOD_OPTIONS: { id: 'today' | 'week' | 'month' | 'all'; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'all', label: 'Todo' },
];

const SALES_SUBTYPE_LABELS: Record<SalesAlertSubtype, string> = {
  pending_payment: 'Pago pendiente',
  pending_transfer: 'Transferencia pendiente',
  product_refund: 'Devolución',
  failed_payment: 'Cobro fallido',
  sale_cancellation: 'Venta cancelada',
};

function salesSubtypeLabel(alert: SalesAlert): string {
  return alert.subtype_label || SALES_SUBTYPE_LABELS[alert.subtype] || 'Venta';
}

function salesAlertDetailText(alert: SalesAlert, includeMember = true): string {
  const parts: string[] = [];
  if (includeMember && alert.member_name) {
    parts.push(`${alert.member_name}${alert.member_number ? ` (#${alert.member_number})` : ''}`);
  }
  if (alert.subtype === 'pending_payment' && alert.total_minor != null && alert.paid_minor != null) {
    parts.push(`Total: ${formatMoney(alert.total_minor)} · Abonado: ${formatMoney(alert.paid_minor)}`);
  } else if (alert.subtype === 'product_refund') {
    const payout = alert.payout_method === 'cash' ? 'Efectivo' : alert.payout_method === 'card' ? 'Tarjeta' : null;
    const disp = alert.disposition === 'restock' ? 'Reingreso a stock' : alert.disposition === 'waste' ? 'Merma' : null;
    if (payout) parts.push(`Reembolso: ${payout}`);
    if (disp) parts.push(disp);
  }
  if (alert.reason) {
    parts.push(alert.reason);
  }
  return parts.join(' · ') || 'Incidencia en venta';
}

function salesAlertAmountText(alert: SalesAlert): string {
  switch (alert.subtype) {
    case 'pending_payment':
      return `Saldo: ${formatMoney(alert.amount_minor)} MXN`;
    case 'pending_transfer':
      return `Por conciliar: ${formatMoney(alert.amount_minor)} MXN`;
    case 'product_refund':
      return `Devuelto: ${formatMoney(alert.amount_minor)} MXN`;
    case 'failed_payment':
      return `Fallido: ${formatMoney(alert.amount_minor)} MXN`;
    case 'sale_cancellation':
      return 'Sin cobro';
    default:
      return `${formatMoney(alert.amount_minor)} MXN`;
  }
}

function categoryTone(category: UnifiedCategory): 'error' | 'warning' | 'neutral' {
  switch (category) {
    case 'cash_difference':
    case 'security':
      return 'error';
    case 'waste':
    case 'sales':
    case 'inventory_waste':
    case 'pending_transfer':
    case 'return':
    case 'rentals':
    case 'debt_override_checkin':
      return 'warning';
    case 'expense':
    case 'attendance_correction':
    default:
      return 'neutral';
  }
}

function formatDateTime(timestamp: string): string {
  if (!timestamp) return '—';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(parsed);
  } catch {
    return timestamp;
  }
}

export interface AlertCenterProps {
  apiRequest?: AuthenticatedRequest;
  branchId?: string;
}

export function AlertCenter({ apiRequest: explicitRequest, branchId: explicitBranchId }: AlertCenterProps = {}) {
  const demoContext = useOptionalDemo();
  const adminSession = useOptionalAdminSession();
  const effectiveRequest = explicitRequest || (adminSession?.status === 'authenticated' ? adminSession.request : undefined);

  const isLiveMode = Boolean(effectiveRequest) && !demoContext;
  const [period, setPeriod] = useState<AlertPeriod>('today');
  const [selectedCategory, setSelectedCategory] = useState<AlertFilterCategory>('all');
  const [activeLegendCategory, setActiveLegendCategory] = useState<UnifiedCategory | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'timestamp', desc: true }]);
  const [refreshTick, setRefreshTick] = useState(0);

  // Live branch and rental alerts
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>(explicitBranchId ?? '');
  const [rentalAlerts, setRentalAlerts] = useState<RentalCancellationDTO[]>([]);
  const [rentalLoading, setRentalLoading] = useState(false);
  const [rentalMutatingId, setRentalMutatingId] = useState<string | null>(null);
  const [rentalError, setRentalError] = useState('');
  const rentalOperation = useRef(0);

  // Overview live alerts (debt overrides & staff attendance corrections)
  const [overviewAlerts, setOverviewAlerts] = useState<OwnerOverviewAlert[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');

  const refreshOverviewAlerts = useCallback(async () => {
    if (!effectiveRequest) {
      setOverviewAlerts([]);
      return;
    }
    setOverviewLoading(true);
    setOverviewError('');
    try {
      const page = await getOwnerOverviewAlerts(effectiveRequest, selectedBranchId || undefined);
      setOverviewAlerts(Array.isArray(page?.alerts) ? page.alerts : []);
    } catch {
      setOverviewAlerts([]);
      setOverviewError('No se pudieron cargar las alertas del negocio.');
    } finally {
      setOverviewLoading(false);
    }
  }, [effectiveRequest, selectedBranchId]);

  useEffect(() => {
    void refreshOverviewAlerts();
  }, [refreshOverviewAlerts]);

  const debtOverrideAlerts = useMemo(
    () => overviewAlerts.filter((a): a is DebtOverrideCheckInAlert => a.category === 'debt_override_checkin'),
    [overviewAlerts]
  );
  const attendanceCorrectionAlerts = useMemo(
    () => overviewAlerts.filter((a): a is AttendanceCorrectionAlert => a.category === 'attendance_correction'),
    [overviewAlerts]
  );

  // Flow B live debt alerts compatibility
  const [debtAlerts, setDebtAlerts] = useState<{ id: string; member_name: string; member_number: string; occurred_at: string }[]>([]);
  const [debtError, setDebtError] = useState(false);

  useEffect(() => {
    if (!effectiveRequest || !selectedBranchId) return;
    let active = true;
    setDebtAlerts([]);
    setDebtError(false);
    void effectiveRequest(`/api/v1/member-check-ins/branches/${encodeURIComponent(selectedBranchId)}/debt-alerts`)
      .then(response => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then(data => { if (active && Array.isArray(data)) setDebtAlerts(data); })
      .catch(() => { if (active) setDebtError(true); });
    return () => { active = false; };
  }, [effectiveRequest, selectedBranchId, refreshTick]);

  const wasteAlerts = useMemo(
    () => overviewAlerts.filter((a): a is InventoryWasteAlert => a.category === 'inventory_waste'),
    [overviewAlerts]
  );

  const salesAlerts = useMemo(
    () => overviewAlerts.filter((a): a is SalesAlert => a.category === 'sales'),
    [overviewAlerts]
  );
  const salesPendingCount = useMemo(
    () => salesAlerts.filter(a => a.subtype === 'pending_payment' || a.subtype === 'pending_transfer').length,
    [salesAlerts]
  );
  const salesRefundCount = useMemo(
    () => salesAlerts.filter(a => a.subtype === 'product_refund').length,
    [salesAlerts]
  );

  // Flow C purchase cost alerts and shift/inventory count discrepancies
  const [purchaseAlerts, setPurchaseAlerts] = useState<PurchaseCostAlert[]>([]);
  const [purchaseError, setPurchaseError] = useState('');
  const [shiftDiscrepancies, setShiftDiscrepancies] = useState<OverviewShiftDiscrepancy[]>([]);
  const [countDiscrepancies, setCountDiscrepancies] = useState<{ shift_id: string; product: string; expected_quantity: number | null; physical_quantity: number }[]>([]);
  const [pendingTransferMinor, setPendingTransferMinor] = useState(0);
  const [overviewDiscrepanciesError, setOverviewDiscrepanciesError] = useState('');

  useEffect(() => {
    if (!effectiveRequest || !selectedBranchId) return;
    let active = true;
    setPurchaseAlerts([]);
    setPurchaseError('');
    listPurchaseCostAlerts(effectiveRequest, selectedBranchId).then(items => {
      if (active) setPurchaseAlerts(Array.isArray(items) ? items : []);
    }).catch(() => { if (active) setPurchaseError('No se pudieron cargar las alertas de costos.'); });

    setShiftDiscrepancies([]);
    setCountDiscrepancies([]);
    setPendingTransferMinor(0);
    setOverviewDiscrepanciesError('');
    getOwnerOverview(effectiveRequest, { branchId: selectedBranchId }).then(overview => {
      if (active) {
        setShiftDiscrepancies(Array.isArray(overview?.finances?.shift_discrepancies) ? overview.finances.shift_discrepancies : []);
        setCountDiscrepancies(Array.isArray(overview?.finances?.count_discrepancies) ? overview.finances.count_discrepancies : []);
        setPendingTransferMinor(overview?.finances?.pending_transfer_minor ?? 0);
      }
    }).catch(() => {
      if (active) setOverviewDiscrepanciesError('No se pudieron cargar las discrepancias operativas.');
    });
    return () => { active = false; };
  }, [effectiveRequest, selectedBranchId, refreshTick]);

  useEffect(() => {
    if (!effectiveRequest) return;
    let active = true;
    void listBranches(effectiveRequest)
      .then(list => {
        if (!active) return;
        const safeBranches = Array.isArray(list) ? list : [];
        setBranches(safeBranches);
        setSelectedBranchId(prev => prev || safeBranches[0]?.id || '');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [effectiveRequest]);

  const refreshRentalAlerts = useCallback(async () => {
    if (!effectiveRequest || !selectedBranchId) {
      setRentalAlerts([]);
      return;
    }
    const current = ++rentalOperation.current;
    setRentalLoading(true);
    setRentalError('');
    try {
      const page = await listRentalAlerts(effectiveRequest, selectedBranchId);
      if (rentalOperation.current !== current) return;
      setRentalAlerts(Array.isArray(page?.items) ? page.items : []);
    } catch {
      if (rentalOperation.current !== current) return;
      setRentalAlerts([]);
      setRentalError('No se pudieron cargar las alertas de cancelaciones.');
    } finally {
      if (rentalOperation.current === current) setRentalLoading(false);
    }
  }, [effectiveRequest, selectedBranchId]);

  useEffect(() => {
    void refreshRentalAlerts();
  }, [refreshRentalAlerts]);

  const handleReviewAlert = async (alertId: string) => {
    if (!effectiveRequest || rentalMutatingId) return;
    const current = ++rentalOperation.current;
    setRentalMutatingId(alertId);
    setRentalError('');
    try {
      const updated = await reviewRentalAlert(effectiveRequest, alertId);
      if (rentalOperation.current !== current) return;
      setRentalAlerts(prev => prev.map(a => (a.id === alertId ? updated : a)));
    } catch {
      if (rentalOperation.current !== current) return;
      setRentalError('No se pudo confirmar la revisión de la alerta. Intenta de nuevo.');
    } finally {
      if (rentalOperation.current === current) setRentalMutatingId(null);
    }
  };

  // Admin security alerts integration
  const [securityAlerts, setSecurityAlerts] = useState<AdminSecurityAlert[]>([]);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityMutating, setSecurityMutating] = useState(false);
  const [securityError, setSecurityError] = useState('');
  const operation = useRef(0);

  const refreshSecurityAlerts = useCallback(async () => {
    if (!adminSession || adminSession.status !== 'authenticated') {
      setSecurityAlerts([]);
      return;
    }
    const current = ++operation.current;
    setSecurityLoading(true);
    setSecurityError('');
    try {
      const page = await listAdminSecurityAlerts(adminSession.request);
      if (operation.current !== current) return;
      setSecurityAlerts(Array.isArray(page?.alerts) ? page.alerts : []);
    } catch (reason) {
      if (operation.current !== current) return;
      setSecurityAlerts([]);
      setSecurityError(
        reason instanceof AdminSecurityAlertsApiError && reason.status === 403
          ? 'Alertas de seguridad no disponibles sin permisos de gestión de personal.'
          : 'No se pudieron cargar los bloqueos de seguridad.'
      );
    } finally {
      if (operation.current === current) setSecurityLoading(false);
    }
  }, [adminSession]);

  useEffect(() => {
    void refreshSecurityAlerts();
  }, [refreshSecurityAlerts]);

  const acknowledgeSecurity = async (alertId: string) => {
    if (!adminSession || securityMutating) return;
    const current = ++operation.current;
    setSecurityMutating(true);
    setSecurityError('');
    try {
      await acknowledgeAdminSecurityAlert(adminSession.request, alertId);
      if (operation.current !== current) return;
      const page = await listAdminSecurityAlerts(adminSession.request);
      if (operation.current !== current) return;
      setSecurityAlerts(Array.isArray(page?.alerts) ? page.alerts : []);
    } catch {
      if (operation.current !== current) return;
      setSecurityError('No se pudo confirmar la atención del bloqueo. Intenta de nuevo.');
    } finally {
      if (operation.current === current) setSecurityMutating(false);
    }
  };

  const demoResult = useMemo(
    () => (demoContext && !isLiveMode ? getOperationalAlerts(demoContext.state, period) : EMPTY_DEMO_RESULT),
    [demoContext, isLiveMode, period]
  );

  const liveUnifiedRows = useMemo<UnifiedAlertRow[]>(() => {
    if (!isLiveMode) return [];
    const rows: UnifiedAlertRow[] = [];

    for (const alert of salesAlerts) {
      const subtypeLabel = salesSubtypeLabel(alert);
      rows.push({
        id: `sales-${alert.id}`,
        category: 'sales',
        categoryLabel: LIVE_CATEGORY_META.sales.label,
        severity: alert.subtype === 'failed_payment' ? 'critical' : 'warning',
        timestamp: alert.occurred_at || '',
        title: `${subtypeLabel} · ${alert.items_summary || alert.product_name || 'Venta'}`,
        detail: `${salesAlertDetailText(alert)}${alert.branch_name ? ` · ${alert.branch_name}` : ''}`,
        responsible: alert.recorded_by_name || 'Recepción',
        impactMinor: alert.amount_minor ?? 0,
        impactFormatted: salesAlertAmountText(alert),
        filterTarget: 'sales',
        actionLabel: 'Ver venta',
      });
    }

    for (const alert of wasteAlerts) {
      const costMinor = alert.total_cost_minor ?? 0;
      const priceMinor = alert.total_price_minor ?? 0;
      const unitLabel = alert.product_unit || 'uds';
      const hasCost = costMinor > 0;
      rows.push({
        id: `waste-${alert.id}`,
        category: 'inventory_waste',
        categoryLabel: LIVE_CATEGORY_META.inventory_waste.label,
        severity: 'warning',
        timestamp: alert.occurred_at || '',
        title: alert.product_name,
        detail: `${alert.quantity} ${unitLabel} · ${alert.reason || 'Sin motivo registrado'}${alert.branch_name ? ` · ${alert.branch_name}` : ''}`,
        responsible: alert.recorded_by_name || 'Recepción',
        impactMinor: hasCost ? costMinor : priceMinor,
        impactFormatted: hasCost
          ? `Costo: ${formatMoney(costMinor)} MXN`
          : `Valor ref.: ${formatMoney(priceMinor)} MXN`,
        filterTarget: 'inventory_waste',
        actionLabel: 'Ver merma',
      });
    }

    for (const alert of debtOverrideAlerts) {
      rows.push({
        id: `debt-${alert.id}`,
        category: 'debt_override_checkin',
        categoryLabel: LIVE_CATEGORY_META.debt_override_checkin.label,
        severity: 'warning',
        timestamp: alert.occurred_at || '',
        title: `${alert.member_name}${alert.member_number ? ` (#${alert.member_number})` : ''}`,
        detail: `${alert.notes || 'Ingreso con adeudo autorizado'}${alert.branch_name ? ` · ${alert.branch_name}` : ''}`,
        responsible: alert.authorized_by_name || 'Recepción',
        impactMinor: 0,
        impactFormatted: 'Acceso autorizado',
        filterTarget: 'debt_override_checkin',
        actionLabel: 'Ver adeudo',
      });
    }

    for (const alert of attendanceCorrectionAlerts) {
      rows.push({
        id: `att-${alert.id}`,
        category: 'attendance_correction',
        categoryLabel: LIVE_CATEGORY_META.attendance_correction.label,
        severity: 'info',
        timestamp: alert.occurred_at || '',
        title: `Asistencia · ${alert.staff_member_name}`,
        detail: `${alert.reason || 'Corrección'}${alert.details ? ` · ${alert.details}` : ''}`,
        responsible: alert.corrected_by_name || 'Recepción',
        impactMinor: 0,
        impactFormatted: 'Registro ajustado',
        filterTarget: 'attendance_correction',
        actionLabel: 'Ver ajuste',
      });
    }

    for (const alert of rentalAlerts) {
      const refundMinor = alert.refund_amount_minor ?? 0;
      rows.push({
        id: `rental-${alert.id}`,
        category: 'rentals',
        categoryLabel: LIVE_CATEGORY_META.rentals.label,
        severity: 'warning',
        timestamp: alert.created_at || '',
        title: `Casillero ${alert.asset_code} · ${alert.member_name}`,
        detail: alert.reason || 'Cancelación de casillero',
        responsible: alert.actor_name || 'Recepción',
        impactMinor: refundMinor,
        impactFormatted: `${formatMoney(refundMinor)} MXN`,
        filterTarget: 'rentals',
        actionLabel: alert.reviewed ? 'Revisado' : 'Revisar',
      });
    }

    for (const alert of securityAlerts) {
      rows.push({
        id: `security-${alert.id}`,
        category: 'security',
        categoryLabel: LIVE_CATEGORY_META.security.label,
        severity: 'critical',
        timestamp: alert.locked_until || '',
        title: `Bloqueo · ${alert.login_identifier}`,
        detail: `Cuenta bloqueada hasta ${formatDateTime(alert.locked_until)}`,
        responsible: 'Personal de recepción',
        impactMinor: 0,
        impactFormatted: 'Bloqueo activo',
        filterTarget: 'security',
        actionLabel: 'Desbloquear',
      });
    }

    return rows;
  }, [isLiveMode, salesAlerts, wasteAlerts, debtOverrideAlerts, attendanceCorrectionAlerts, rentalAlerts, securityAlerts]);

  const summary = useMemo(() => {
    if (!isLiveMode) {
      return {
        totalCount: demoResult.totalCount,
        cashImpactMinor: demoResult.kpis.cashImpactMinor,
        pendingTransfersMinor: demoResult.kpis.pendingTransfersMinor,
      };
    }
    const wasteImpactMinor = wasteAlerts.reduce(
      (sum, alert) => sum + ((alert.total_cost_minor ?? 0) > 0 ? alert.total_cost_minor : (alert.total_price_minor ?? 0)),
      0
    );
    const shiftImpactMinor = shiftDiscrepancies.reduce(
      (sum, sd) => sum + Math.abs(sd.difference_minor),
      0
    );
    return {
      totalCount: liveUnifiedRows.length,
      cashImpactMinor: wasteImpactMinor + shiftImpactMinor,
      pendingTransfersMinor: pendingTransferMinor,
    };
  }, [isLiveMode, demoResult, wasteAlerts, shiftDiscrepancies, pendingTransferMinor, liveUnifiedRows.length]);

  const tableData = useMemo<UnifiedAlertRow[]>(() => {
    if (isLiveMode) {
      if (selectedCategory === 'all') return liveUnifiedRows;
      return [];
    }
    if (selectedCategory === 'all') {
      return demoResult.alerts;
    }
    return demoResult.alerts.filter(alert => alert.category === selectedCategory);
  }, [isLiveMode, liveUnifiedRows, demoResult.alerts, selectedCategory]);

  const slices = useMemo<ChartSlice[]>(() => {
    if (!isLiveMode) {
      return demoResult.categoryCounts.map(item => ({
        category: item.category,
        count: item.count,
        label: item.label,
        shortLabel: ALERT_CATEGORY_CONFIG[item.category].shortLabel,
        percent: item.percent,
        color: item.color,
      }));
    }
    const liveCategories: LiveAlertCategory[] = [
      'sales',
      'inventory_waste',
      'rentals',
      'debt_override_checkin',
      'attendance_correction',
      'security',
    ];
    const counts: Record<LiveAlertCategory, number> = {
      sales: salesAlerts.length,
      inventory_waste: wasteAlerts.length,
      rentals: rentalAlerts.length,
      debt_override_checkin: debtOverrideAlerts.length,
      attendance_correction: attendanceCorrectionAlerts.length,
      security: securityAlerts.length,
    };
    const total = liveUnifiedRows.length;
    if (total === 0) return [];
    return liveCategories
      .filter(cat => counts[cat] > 0)
      .map(cat => ({
        category: cat,
        count: counts[cat],
        label: LIVE_CATEGORY_META[cat].label,
        shortLabel: LIVE_CATEGORY_META[cat].shortLabel,
        percent: Math.round((counts[cat] / total) * 100),
        color: LIVE_CATEGORY_META[cat].color,
      }));
  }, [
    isLiveMode,
    demoResult.categoryCounts,
    salesAlerts.length,
    wasteAlerts.length,
    rentalAlerts.length,
    debtOverrideAlerts.length,
    attendanceCorrectionAlerts.length,
    securityAlerts.length,
    liveUnifiedRows.length,
  ]);

  const donutDefinition = useMemo(() => {
    if (!slices.length) return null;
    return defineChart({
      marks: [
        polar({
          inset: 6,
          radiusRatio: 0.94,
          marks: [
            radialArc(pie(slices, { value: 'count' }), {
              innerRadius: ({ radius }) => radius * 0.65,
              cornerRadius: 4,
              color: 'category',
              key: 'category',
            }),
          ],
          scales: { angle: null, radius: null },
        }),
      ],
      scales: { x: null, y: null },
      color: {
        domain: [
          'cash_difference',
          'waste',
          'expense',
          'pending_transfer',
          'return',
          'sales',
          'inventory_waste',
          'rentals',
          'security',
          'debt_override_checkin',
          'attendance_correction',
        ],
        range: [
          '#A32222',
          '#F59E0B',
          '#2455A4',
          '#FC6C06',
          '#8B5CF6',
          '#8B5CF6',
          '#F59E0B',
          '#FC6C06',
          '#A32222',
          '#D97706',
          '#2455A4',
        ],
      },
      keyboard: true,
    });
  }, [slices]);

  const columns = useMemo<ColumnDef<UnifiedAlertRow>[]>(
    () => [
      {
        accessorKey: 'timestamp',
        header: 'Fecha / Turno',
        cell: ({ row }) => (
          <div className="alert-date-cell">
            <span className="alert-date-time">{formatDateTime(row.original.timestamp)}</span>
            {row.original.shiftId && (
              <span className="alert-shift-tag">{row.original.shiftId}</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'category',
        header: 'Categoría',
        cell: ({ row }) => (
          <Badge tone={categoryTone(row.original.category)}>
            {row.original.categoryLabel}
          </Badge>
        ),
      },
      {
        accessorKey: 'detail',
        header: 'Detalle',
        cell: ({ row }) => (
          <div className="alert-detail-cell">
            <span className="alert-detail-title">{row.original.title}</span>
            <p className="alert-detail-text">{row.original.detail}</p>
          </div>
        ),
      },
      {
        accessorKey: 'responsible',
        header: 'Responsable',
        cell: ({ getValue }) => <span>{String(getValue() ?? '—')}</span>,
      },
      {
        accessorKey: 'impactMinor',
        header: 'Impacto',
        cell: ({ row }) => (
          <span
            className={`alert-impact-cell ${
              row.original.severity === 'critical'
                ? 'impact-critical'
                : 'impact-warning'
            }`}
          >
            {row.original.impactFormatted}
          </span>
        ),
      },
      {
        id: 'action',
        header: 'Acción',
        cell: ({ row }) =>
          row.original.targetRoute ? (
            <Link
              to={row.original.targetRoute}
              className="button button-secondary alert-action-btn"
            >
              {row.original.actionLabel}
            </Link>
          ) : row.original.filterTarget ? (
            <button
              type="button"
              className="button button-secondary alert-action-btn"
              onClick={() => setSelectedCategory(row.original.filterTarget!)}
            >
              {row.original.actionLabel}
            </button>
          ) : (
            <span className="alert-sub-text">—</span>
          ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (!demoContext && !effectiveRequest && adminSession?.status === 'restoring') {
    return (
      <div className="alert-center-container">
        <PageHeader
          eyebrow="PROPIETARIO · CENTRO DE CONTROL"
          title="Centro de alertas operativas"
          description="Consolidación de diferencias de caja, mermas de inventario, salidas de efectivo y transferencias bancarias pendientes de conciliación."
        />
        <Panel>
          <p className="alert-status-notice" role="status">Cargando centro de alertas…</p>
        </Panel>
      </div>
    );
  }

  if (!effectiveRequest && !demoContext) {
    if (adminSession) {
      return (
        <div className="alert-center-container">
          <PageHeader
            eyebrow="PROPIETARIO · CENTRO DE CONTROL"
            title="Centro de alertas operativas"
            description="Consolidación de diferencias de caja, mermas de inventario, salidas de efectivo y transferencias bancarias pendientes de conciliación."
          />
          <Panel>
            <p className="alert-status-notice" role="status">
              Inicia sesión como propietario para consultar el centro de alertas.
            </p>
          </Panel>
        </div>
      );
    }
    throw new Error('useDemo requires DemoProvider');
  }

  const isLiveLoading = isLiveMode && (overviewLoading || rentalLoading || securityLoading);
  const activeBranchLabel =
    (Array.isArray(branches) ? branches.find(branch => branch.id === selectedBranchId)?.name : undefined) ||
    selectedBranchId ||
    'Todas las sucursales';
  const activeLegendSlice = activeLegendCategory
    ? slices.find(item => item.category === activeLegendCategory) ?? null
    : null;

  const handleRefreshAll = () => {
    setRefreshTick(prev => prev + 1);
    void refreshOverviewAlerts();
    void refreshRentalAlerts();
    void refreshSecurityAlerts();
  };

  return (
    <div className="alert-center-container">
      <PageHeader
        eyebrow="PROPIETARIO · CENTRO DE CONTROL"
        title="Centro de alertas operativas"
        description="Consolidación de diferencias de caja, mermas de inventario, salidas de efectivo y transferencias bancarias pendientes de conciliación."
      />

      {isLiveMode ? (
        <Panel className="alert-live-toolbar">
          <div className="alert-live-toolbar-meta">
            <span className="alert-period-label">Sucursal</span>
            {branches.length > 1 ? (
              <select
                aria-label="Seleccionar sucursal de alertas"
                className="alert-branch-select"
                value={selectedBranchId}
                onChange={event => {
                  setSelectedBranchId(event.target.value);
                  setSelectedCategory('all');
                }}
              >
                {branches.map(branch => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{activeBranchLabel}</strong>
            )}
          </div>
          <div className="alert-live-toolbar-actions">
            <Button
              variant="secondary"
              disabled={isLiveLoading}
              onClick={handleRefreshAll}
            >
              {isLiveLoading ? 'Actualizando…' : 'Actualizar'}
            </Button>
          </div>
        </Panel>
      ) : (
        <Panel className="alert-period-bar">
          <p className="alert-period-label">Periodo a consultar</p>
          <div
            className="alert-period-group"
            role="group"
            aria-label="Seleccionar periodo de alertas"
          >
            {PERIOD_OPTIONS.map(option => (
              <button
                key={option.id}
                type="button"
                className={`alert-period-btn ${period === option.id ? 'active' : ''}`}
                aria-pressed={period === option.id}
                onClick={() => {
                  setPeriod(option.id);
                  setSelectedCategory('all');
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Panel>
      )}

      {/* Top Bento Row: Primary KPIs + Donut Chart */}
      <div className="alert-top-bento">
        <Panel className="alert-kpi-card">
          <div className="alert-kpi-header">
            <span className="alert-kpi-title">Alertas activas</span>
            <span className="alert-kpi-icon">
              <HugeiconsIcon icon={Alert01Icon} size={20} />
            </span>
          </div>
          <p className="alert-kpi-value">{summary.totalCount}</p>
          <p className="alert-kpi-note">
            {summary.totalCount === 1
              ? '1 evento operativo requiere atención.'
              : `${summary.totalCount} eventos operativos requieren atención.`}
          </p>
        </Panel>

        <Panel className="alert-kpi-card">
          <div className="alert-kpi-header">
            <span className="alert-kpi-title">Descuadres y gastos</span>
            <span className="alert-kpi-icon icon-danger">
              <HugeiconsIcon icon={Cash01Icon} size={20} />
            </span>
          </div>
          <p className="alert-kpi-value">
            {formatMoney(summary.cashImpactMinor)} MXN
          </p>
          <p className="alert-kpi-note">
            {isLiveMode
              ? 'Mermas y diferencias de arqueo registradas en sucursal.'
              : 'Salidas no programadas y faltantes observados en arqueo.'}
          </p>
          <Link to="/owner/shifts" className="alert-kpi-link">
            Revisar turnos →
          </Link>
        </Panel>

        <Panel className="alert-kpi-card">
          <div className="alert-kpi-header">
            <span className="alert-kpi-title">Transferencias pendientes</span>
            <span className="alert-kpi-icon icon-warning">
              <HugeiconsIcon icon={CreditCardIcon} size={20} />
            </span>
          </div>
          <p className="alert-kpi-value">
            {formatMoney(summary.pendingTransfersMinor)} MXN
          </p>
          <p className="alert-kpi-note">
            Fondos no acreditados ni conciliados con estado bancario.
          </p>
          <Link to="/owner/history" className="alert-kpi-link">
            Auditar historial →
          </Link>
        </Panel>

        <Panel className="alert-chart-card">
          <h2>Distribución por categoría</h2>
          <div className="alert-chart-body">
            <div
              className="alert-donut-wrap"
              aria-label={`Distribución de alertas: ${summary.totalCount} eventos`}
            >
              {donutDefinition ? (
                <Chart
                  definition={donutDefinition}
                  height={170}
                  ariaLabel="Distribución de alertas por categoría"
                />
              ) : (
                <div
                  className="alert-donut-empty"
                  role="img"
                  aria-label="Sin alertas registradas en este periodo"
                />
              )}
              <div className="alert-donut-center">
                <strong>{summary.totalCount}</strong>
                <span>{summary.totalCount === 1 ? 'alerta' : 'alertas'}</span>
              </div>
            </div>

            <div className="alert-chart-legend" aria-label="Desglose por categoría">
              {slices.map(item => (
                <button
                  key={item.category}
                  type="button"
                  className="alert-legend-item"
                  aria-pressed={selectedCategory === item.category}
                  onMouseEnter={() => setActiveLegendCategory(item.category)}
                  onMouseLeave={() => setActiveLegendCategory(null)}
                  onFocus={() => setActiveLegendCategory(item.category)}
                  onBlur={() => setActiveLegendCategory(null)}
                  onClick={() =>
                    setSelectedCategory(prev =>
                      prev === item.category ? 'all' : item.category
                    )
                  }
                  aria-label={`${item.shortLabel}: ${item.count} alertas, ${item.percent} por ciento`}
                >
                  <span
                    className="alert-legend-dot"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="alert-legend-label">{item.shortLabel}</span>
                  <strong>{item.count}</strong>
                  <span className="alert-legend-pct">{item.percent}%</span>
                </button>
              ))}
              {activeLegendSlice && (
                <p className="sr-only" role="status">
                  {activeLegendSlice.label} seleccionada
                </p>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {/* Live Secondary Operational KPIs */}
      {isLiveMode && (
        <div className="alert-live-kpis">
          <Panel className={`alert-kpi-card ${selectedCategory === 'security' ? 'alert-kpi-active' : ''}`}>
            <div className="alert-kpi-header">
              <h3 className="alert-kpi-heading">Bloqueos de seguridad</h3>
              <span className="alert-kpi-icon icon-danger">
                <HugeiconsIcon icon={Alert01Icon} size={20} />
              </span>
            </div>
            <p className="alert-kpi-value">{securityAlerts.length}</p>
            <p className="alert-kpi-note">
              {securityAlerts.length === 1
                ? '1 cuenta de personal bloqueada por intentos fallidos.'
                : `${securityAlerts.length} cuentas de personal bloqueadas por intentos fallidos.`}
            </p>
            <button
              type="button"
              className="alert-kpi-link"
              onClick={() => setSelectedCategory('security')}
            >
              Ver bloqueos →
            </button>
          </Panel>

          <Panel className={`alert-kpi-card ${selectedCategory === 'rentals' ? 'alert-kpi-active' : ''}`}>
            <div className="alert-kpi-header">
              <h3 className="alert-kpi-heading">Cancelaciones de casilleros</h3>
              <span className="alert-kpi-icon icon-warning">
                <HugeiconsIcon icon={Alert01Icon} size={20} />
              </span>
            </div>
            <p className="alert-kpi-value">{rentalAlerts.length}</p>
            <p className="alert-kpi-note">
              {rentalAlerts.filter(a => !a.reviewed).length === 1
                ? '1 cancelación pendiente de revisión.'
                : `${rentalAlerts.filter(a => !a.reviewed).length} cancelaciones pendientes de revisión.`}
            </p>
            <button
              type="button"
              className="alert-kpi-link"
              onClick={() => setSelectedCategory('rentals')}
            >
              Ver cancelaciones →
            </button>
          </Panel>

          <Panel className={`alert-kpi-card ${selectedCategory === 'debt_override_checkin' ? 'alert-kpi-active' : ''}`}>
            <div className="alert-kpi-header">
              <h3 className="alert-kpi-heading">Entradas con adeudo</h3>
              <span className="alert-kpi-icon icon-warning">
                <HugeiconsIcon icon={Alert01Icon} size={20} />
              </span>
            </div>
            <p className="alert-kpi-value">{debtOverrideAlerts.length}</p>
            <p className="alert-kpi-note">
              {debtOverrideAlerts.length === 1
                ? '1 socio ingresó con autorización excepcional por adeudo.'
                : `${debtOverrideAlerts.length} socios ingresaron con autorización excepcional por adeudo.`}
            </p>
            <button
              type="button"
              className="alert-kpi-link"
              onClick={() => setSelectedCategory('debt_override_checkin')}
            >
              Ver autorizaciones →
            </button>
          </Panel>

          <Panel className={`alert-kpi-card ${selectedCategory === 'attendance_correction' ? 'alert-kpi-active' : ''}`}>
            <div className="alert-kpi-header">
              <h3 className="alert-kpi-heading">Correcciones de asistencia</h3>
              <span className="alert-kpi-icon">
                <HugeiconsIcon icon={Alert01Icon} size={20} />
              </span>
            </div>
            <p className="alert-kpi-value">{attendanceCorrectionAlerts.length}</p>
            <p className="alert-kpi-note">
              {attendanceCorrectionAlerts.length === 1
                ? '1 corrección manual de asistencia realizada por recepción.'
                : `${attendanceCorrectionAlerts.length} correcciones manuales de asistencia realizadas por recepción.`}
            </p>
            <button
              type="button"
              className="alert-kpi-link"
              onClick={() => setSelectedCategory('attendance_correction')}
            >
              Ver correcciones →
            </button>
          </Panel>

          <Panel className={`alert-kpi-card ${selectedCategory === 'inventory_waste' ? 'alert-kpi-active' : ''}`}>
            <div className="alert-kpi-header">
              <h3 className="alert-kpi-heading">Mermas de inventario</h3>
              <span className="alert-kpi-icon icon-warning">
                <HugeiconsIcon icon={Alert01Icon} size={20} />
              </span>
            </div>
            <p className="alert-kpi-value">{wasteAlerts.length}</p>
            <p className="alert-kpi-note">
              {wasteAlerts.length === 1
                ? '1 registro de merma reportado por recepción.'
                : `${wasteAlerts.length} registros de merma reportados por recepción.`}
            </p>
            <button
              type="button"
              className="alert-kpi-link"
              onClick={() => setSelectedCategory('inventory_waste')}
            >
              Ver mermas →
            </button>
          </Panel>

          <Panel className={`alert-kpi-card ${selectedCategory === 'sales' ? 'alert-kpi-active' : ''}`}>
            <div className="alert-kpi-header">
              <h3 className="alert-kpi-heading">Ventas</h3>
              <span className="alert-kpi-icon icon-warning">
                <HugeiconsIcon icon={Cash01Icon} size={20} />
              </span>
            </div>
            <p className="alert-kpi-value">{salesAlerts.length}</p>
            <p className="alert-kpi-note">
              {salesAlerts.length === 0
                ? 'Sin pagos pendientes ni devoluciones registradas.'
                : salesAlerts.length - salesPendingCount - salesRefundCount > 0
                  ? `${salesPendingCount} ${salesPendingCount === 1 ? 'pendiente' : 'pendientes'} · ${salesRefundCount} ${salesRefundCount === 1 ? 'devolución' : 'devoluciones'} · ${salesAlerts.length - salesPendingCount - salesRefundCount} otras.`
                  : `${salesPendingCount} ${salesPendingCount === 1 ? 'pago pendiente' : 'pagos pendientes'} · ${salesRefundCount} ${salesRefundCount === 1 ? 'devolución' : 'devoluciones'}.`}
            </p>
            <button
              type="button"
              className="alert-kpi-link"
              onClick={() => setSelectedCategory('sales')}
            >
              Ver ventas →
            </button>
          </Panel>
        </div>
      )}

      {/* Table Section */}
      <Panel className="alert-table-card">
        <div className="alert-table-header">
          <div className="alert-table-title-row">
            <h2>Detalle de incidencias</h2>
            {selectedCategory !== 'all' && (
              <button
                type="button"
                className="alert-kpi-link"
                onClick={() => setSelectedCategory('all')}
              >
                Ver todas ({summary.totalCount})
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div
            className="alert-filter-pills"
            role="group"
            aria-label="Filtrar incidencias por categoría"
          >
            <button
              type="button"
              className={`alert-filter-pill ${selectedCategory === 'all' ? 'active' : ''}`}
              aria-pressed={selectedCategory === 'all'}
              onClick={() => setSelectedCategory('all')}
            >
              <span>Todos</span>
              <span className="alert-pill-count">{summary.totalCount}</span>
            </button>

            {isLiveMode ? (
              <>
                <button
                  type="button"
                  className={`alert-filter-pill ${selectedCategory === 'inventory_waste' ? 'active' : ''}`}
                  aria-pressed={selectedCategory === 'inventory_waste'}
                  onClick={() => setSelectedCategory('inventory_waste')}
                >
                  <span>Mermas de inventario</span>
                  <span className="alert-pill-count">{wasteAlerts.length}</span>
                </button>
                <button
                  type="button"
                  className={`alert-filter-pill ${selectedCategory === 'sales' ? 'active' : ''}`}
                  aria-pressed={selectedCategory === 'sales'}
                  onClick={() => setSelectedCategory('sales')}
                >
                  <span>Ventas</span>
                  <span className="alert-pill-count">{salesAlerts.length}</span>
                </button>
                <button
                  type="button"
                  className={`alert-filter-pill ${selectedCategory === 'rentals' ? 'active' : ''}`}
                  aria-pressed={selectedCategory === 'rentals'}
                  onClick={() => setSelectedCategory('rentals')}
                >
                  <span>Cancelaciones de casilleros</span>
                  <span className="alert-pill-count">{rentalAlerts.length}</span>
                </button>
                <button
                  type="button"
                  className={`alert-filter-pill ${selectedCategory === 'debt_override_checkin' ? 'active' : ''}`}
                  aria-pressed={selectedCategory === 'debt_override_checkin'}
                  onClick={() => setSelectedCategory('debt_override_checkin')}
                >
                  <span>Entradas con adeudo</span>
                  <span className="alert-pill-count">{debtOverrideAlerts.length}</span>
                </button>
                <button
                  type="button"
                  className={`alert-filter-pill ${selectedCategory === 'attendance_correction' ? 'active' : ''}`}
                  aria-pressed={selectedCategory === 'attendance_correction'}
                  onClick={() => setSelectedCategory('attendance_correction')}
                >
                  <span>Correcciones de asistencia</span>
                  <span className="alert-pill-count">{attendanceCorrectionAlerts.length}</span>
                </button>
                <button
                  type="button"
                  className={`alert-filter-pill ${selectedCategory === 'security' ? 'active' : ''}`}
                  aria-pressed={selectedCategory === 'security'}
                  onClick={() => setSelectedCategory('security')}
                >
                  <span>Seguridad / Bloqueos</span>
                  <span className="alert-pill-count">{securityAlerts.length}</span>
                </button>
              </>
            ) : (
              (Object.keys(ALERT_CATEGORY_CONFIG) as AlertCategory[]).map(cat => {
                const count = demoResult.alerts.filter(a => a.category === cat).length;
                if (count === 0 && selectedCategory !== cat) return null;
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`alert-filter-pill ${selectedCategory === cat ? 'active' : ''}`}
                    aria-pressed={selectedCategory === cat}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    <span>{ALERT_CATEGORY_CONFIG[cat].label}</span>
                    <span className="alert-pill-count">{count}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {overviewError && (
          <p role="alert" className="alert-error-notice">
            {overviewError}
          </p>
        )}

        {rentalError && (selectedCategory === 'all' || selectedCategory === 'rentals') && (
          <p role="alert" className="alert-error-notice">
            {rentalError}
          </p>
        )}

        {securityError && (selectedCategory === 'all' || selectedCategory === 'security') && (
          <p role="alert" className="alert-error-notice">
            {securityError}
          </p>
        )}

        {selectedCategory === 'debt_override_checkin' ? (
          overviewLoading && debtOverrideAlerts.length === 0 ? (
            <p className="alert-status-notice" role="status">Cargando entradas con adeudo…</p>
          ) : debtOverrideAlerts.length === 0 ? (
            <EmptyState title="Sin entradas con adeudo">
              No hay autorizaciones excepcionales de acceso con deuda registradas.
            </EmptyState>
          ) : (
            <TableRegion label="Entradas con adeudo autorizadas">
              <table className="alert-table">
                <caption>
                  Alertas de accesos excepcionales con adeudo autorizados por personal de recepción.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Socio</th>
                    <th scope="col">Sucursal</th>
                    <th scope="col">Autorizado por</th>
                    <th scope="col">Fecha y hora</th>
                    <th scope="col">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {debtOverrideAlerts.map(alert => (
                    <tr key={alert.id}>
                      <td>
                        <div className="alert-detail-cell">
                          <span className="alert-detail-title">{alert.member_name}</span>
                          {alert.member_number && (
                            <span className="alert-sub-text">#{alert.member_number}</span>
                          )}
                        </div>
                      </td>
                      <td>{alert.branch_name || activeBranchLabel || '—'}</td>
                      <td>
                        <strong>{alert.authorized_by_name}</strong>
                      </td>
                      <td>
                        <time dateTime={alert.occurred_at}>
                          {formatDateTime(alert.occurred_at)}
                        </time>
                      </td>
                      <td>{alert.notes || 'Acceso concedido con deuda pendiente'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
          )
        ) : selectedCategory === 'attendance_correction' ? (
          overviewLoading && attendanceCorrectionAlerts.length === 0 ? (
            <p className="alert-status-notice" role="status">Cargando correcciones de asistencia…</p>
          ) : attendanceCorrectionAlerts.length === 0 ? (
            <EmptyState title="Sin correcciones de asistencia">
              No hay correcciones de asistencia registradas por recepción en este periodo.
            </EmptyState>
          ) : (
            <TableRegion label="Correcciones de asistencia">
              <table className="alert-table">
                <caption>
                  Ajustes manuales y correcciones de asistencia de personal registrados por recepción.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Colaborador</th>
                    <th scope="col">Sucursal</th>
                    <th scope="col">Corregido por</th>
                    <th scope="col">Motivo y detalle</th>
                    <th scope="col">Fecha y hora</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceCorrectionAlerts.map(alert => (
                    <tr key={alert.id}>
                      <td>
                        <div className="alert-detail-cell">
                          <span className="alert-detail-title">{alert.staff_member_name}</span>
                          <span className="alert-sub-text">Personal de sucursal</span>
                        </div>
                      </td>
                      <td>{alert.branch_name || activeBranchLabel || '—'}</td>
                      <td>
                        <strong>{alert.corrected_by_name}</strong>
                      </td>
                      <td>
                        <span>{alert.reason}</span>
                        {alert.details && (
                          <p className="alert-detail-text">{alert.details}</p>
                        )}
                      </td>
                      <td>
                        <time dateTime={alert.occurred_at}>
                          {formatDateTime(alert.occurred_at)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
          )
        ) : selectedCategory === 'inventory_waste' ? (
          overviewLoading && wasteAlerts.length === 0 ? (
            <p className="alert-status-notice" role="status">Cargando mermas de inventario…</p>
          ) : wasteAlerts.length === 0 ? (
            <EmptyState title="Sin mermas de inventario">
              No hay mermas de inventario registradas por recepción en este periodo.
            </EmptyState>
          ) : (
            <TableRegion label="Mermas de inventario">
              <table className="alert-table">
                <caption>
                  Registros de merma de inventario capturados por recepción en la sucursal.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Producto</th>
                    <th scope="col">Cantidad</th>
                    <th scope="col">Valor</th>
                    <th scope="col">Sucursal</th>
                    <th scope="col">Registrado por</th>
                    <th scope="col">Motivo u observaciones</th>
                    <th scope="col">Fecha y hora</th>
                  </tr>
                </thead>
                <tbody>
                  {wasteAlerts.map(alert => (
                    <tr key={alert.id}>
                      <td>
                        <div className="alert-detail-cell">
                          <span className="alert-detail-title">{alert.product_name}</span>
                          <span className="alert-sub-text">{alert.product_unit || 'uds'}</span>
                        </div>
                      </td>
                      <td>{alert.quantity}</td>
                      <td>
                        {(alert.total_cost_minor ?? 0) > 0 ? (
                          <span>Costo: {formatMoney(alert.total_cost_minor)} MXN</span>
                        ) : (
                          <span>Valor ref.: {formatMoney(alert.total_price_minor ?? 0)} MXN</span>
                        )}
                      </td>
                      <td>{alert.branch_name || activeBranchLabel || '—'}</td>
                      <td>
                        <strong>{alert.recorded_by_name || 'Recepción'}</strong>
                      </td>
                      <td>{alert.reason || 'Sin motivo registrado'}</td>
                      <td>
                        <time dateTime={alert.occurred_at}>
                          {formatDateTime(alert.occurred_at)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
          )
        ) : selectedCategory === 'sales' ? (
          overviewLoading && salesAlerts.length === 0 ? (
            <p className="alert-status-notice" role="status">Cargando alertas de ventas…</p>
          ) : salesAlerts.length === 0 ? (
            <EmptyState title="Sin alertas de ventas">
              No hay ventas con pagos pendientes, transferencias por conciliar ni devoluciones registradas.
            </EmptyState>
          ) : (
            <TableRegion label="Ventas">
              <table className="alert-table">
                <caption>
                  Ventas con pagos pendientes, transferencias por conciliar, devoluciones e incidencias de cobro.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Tipo</th>
                    <th scope="col">Venta / Socio</th>
                    <th scope="col">Monto</th>
                    <th scope="col">Sucursal</th>
                    <th scope="col">Responsable</th>
                    <th scope="col">Detalle</th>
                    <th scope="col">Fecha y hora</th>
                  </tr>
                </thead>
                <tbody>
                  {salesAlerts.map(alert => (
                    <tr key={alert.id}>
                      <td>
                        <div className="alert-detail-cell">
                          <Badge tone={alert.subtype === 'failed_payment' ? 'error' : 'warning'}>
                            {salesSubtypeLabel(alert)}
                          </Badge>
                          <span className="alert-sub-text">
                            {alert.order_kind === 'membership' ? 'Membresía' : 'Producto'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="alert-detail-cell">
                          <span className="alert-detail-title">{alert.items_summary || alert.product_name || 'Venta'}</span>
                          <span className="alert-sub-text">
                            {alert.member_name
                              ? `${alert.member_name}${alert.member_number ? ` (#${alert.member_number})` : ''}`
                              : 'Cliente de mostrador'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <strong>{salesAlertAmountText(alert)}</strong>
                      </td>
                      <td>{alert.branch_name || activeBranchLabel || '—'}</td>
                      <td>
                        <strong>{alert.recorded_by_name || 'Recepción'}</strong>
                      </td>
                      <td>{salesAlertDetailText(alert, false)}</td>
                      <td>
                        <time dateTime={alert.occurred_at}>
                          {formatDateTime(alert.occurred_at)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
          )
        ) : selectedCategory === 'rentals' ? (
          rentalLoading && rentalAlerts.length === 0 ? (
            <p className="alert-status-notice" role="status">Cargando cancelaciones de casilleros…</p>
          ) : rentalAlerts.length === 0 ? (
            <EmptyState title="Sin cancelaciones de casilleros">
              No hay alertas de cancelación de casilleros pendientes o registradas en esta sucursal.
            </EmptyState>
          ) : (
            <TableRegion label="Cancelaciones de casilleros">
              <table className="alert-table">
                <caption>
                  Cancelaciones de casilleros registradas por recepción con cálculo proporcional y saldo devuelto.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Socio</th>
                    <th scope="col">Casillero</th>
                    <th scope="col">Motivo</th>
                    <th scope="col">Devolución</th>
                    <th scope="col">Estado</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {rentalAlerts.map(alert => (
                    <tr key={alert.id}>
                      <td>
                        <div className="alert-detail-cell">
                          <span className="alert-detail-title">{alert.member_name}</span>
                          <span className="alert-sub-text">#{alert.member_number}</span>
                        </div>
                      </td>
                      <td>
                        <strong>{alert.asset_code}</strong>
                      </td>
                      <td>{alert.reason}</td>
                      <td>
                        {formatMoney(alert.refund_amount_minor ?? 0)} MXN ({alert.refund_method === 'cash' ? 'Efectivo' : 'Saldo a favor'})
                      </td>
                      <td>
                        {alert.reviewed ? (
                          <Badge tone="success">Revisado</Badge>
                        ) : (
                          <Badge tone="warning">Pendiente</Badge>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {alert.reviewed ? (
                          <span className="alert-sub-text">
                            Revisado por {alert.reviewed_by_name ?? 'Admin'}
                          </span>
                        ) : (
                          <Button
                            variant="secondary"
                            disabled={rentalMutatingId === alert.id}
                            onClick={() => void handleReviewAlert(alert.id)}
                            aria-label={`Marcar como revisado ${alert.asset_code}`}
                          >
                            {rentalMutatingId === alert.id ? 'Guardando…' : 'Marcar como revisado'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
          )
        ) : selectedCategory === 'security' ? (
          securityLoading && securityAlerts.length === 0 ? (
            <p className="alert-status-notice" role="status">Cargando bloqueos de seguridad…</p>
          ) : securityAlerts.length === 0 ? (
            <EmptyState title="Sin bloqueos de seguridad">
              No hay cuentas de personal bloqueadas en este momento.
            </EmptyState>
          ) : (
            <TableRegion label="Bloqueos de seguridad">
              <table className="alert-table">
                <caption>
                  Cuentas de personal bloqueadas por intentos fallidos de autenticación.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Usuario / Identificador</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Bloqueado hasta</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {securityAlerts.map(alert => (
                    <tr key={alert.id}>
                      <td>
                        <div className="alert-detail-cell">
                          <span className="alert-detail-title">{alert.login_identifier}</span>
                          <span className="alert-sub-text">Personal de recepción</span>
                        </div>
                      </td>
                      <td>
                        <Badge tone="error">Bloqueado</Badge>
                      </td>
                      <td>
                        <time dateTime={alert.locked_until}>
                          {formatDateTime(alert.locked_until)}
                        </time>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Button
                          variant="secondary"
                          disabled={securityMutating}
                          onClick={() => void acknowledgeSecurity(alert.id)}
                          aria-label={`Acknowledge lockout for ${alert.login_identifier}`}
                        >
                          {securityMutating ? 'Confirmando…' : 'Desbloquear / Reconocer'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
          )
        ) : isLiveLoading && tableData.length === 0 ? (
          <p className="alert-status-notice" role="status">Cargando incidencias operativas…</p>
        ) : tableData.length === 0 ? (
          <EmptyState title="Sin alertas registradas">
            No se observaron diferencias de caja, mermas, gastos no planificados ni
            transferencias pendientes para los criterios seleccionados.
          </EmptyState>
        ) : (
          <TableRegion label="Centro de alertas operativas">
            <table className="alert-table">
              <caption>
                Alertas operativas del periodo · Montos expresados en moneda nacional (MXN).
              </caption>
              <thead>
                {table.getHeaderGroups().map(group => (
                  <tr key={group.id}>
                    {group.headers.map(header => (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={
                          header.column.getIsSorted() === 'asc'
                            ? 'ascending'
                            : header.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : 'none'
                        }
                      >
                        <button
                          type="button"
                          className="alert-sort-btn"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {header.column.getIsSorted() === 'asc'
                            ? ' ↑'
                            : header.column.getIsSorted() === 'desc'
                            ? ' ↓'
                            : ''}
                        </button>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map(row => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        )}
      </Panel>

      {/* Secondary Branch Audit Signals (Live Only) */}
      {isLiveMode && (debtAlerts.length > 0 || debtError || selectedBranchId) && (
        <div className="alert-audit-grid">
          {(debtAlerts.length > 0 || debtError) && (
            <section className="panel alert-audit-card" aria-label="Entradas confirmadas con adeudo">
              <h2>Entradas confirmadas con adeudo</h2>
              {debtError && (
                <p role="alert" className="alert-error-notice">
                  No se pudieron cargar las entradas con adeudo.
                </p>
              )}
              {debtAlerts.length > 0 && (
                <ul className="alert-audit-list">
                  {debtAlerts.map(alert => (
                    <li key={alert.id} className="alert-audit-item">
                      <span>{alert.member_name} · {alert.member_number} · {alert.occurred_at}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {selectedBranchId && (
            <Panel className="alert-audit-card">
              <h2>Aumentos de costo de inventario</h2>
              {purchaseError && (
                <p role="alert" className="alert-error-notice">{purchaseError}</p>
              )}
              {purchaseAlerts.length > 0 ? (
                <ul className="alert-audit-list purchase-cost-alerts-list">
                  {purchaseAlerts.map(alert => (
                    <li key={`${alert.purchase_id}:${alert.product_id}`} className="alert-audit-item purchase-cost-alert-item">
                      <span>
                        {alert.product_name}: {formatMoney(alert.previous_cost_minor)} → {formatMoney(alert.unit_cost_minor)}
                      </span>
                      <time className="purchase-alert-timestamp alert-audit-time" dateTime={alert.recorded_at}>
                        ({formatDateTime(alert.recorded_at)})
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                !purchaseError && <p className="muted">No hay alertas de aumento de costo registradas.</p>
              )}
            </Panel>
          )}

          {selectedBranchId && (
            <Panel className="alert-audit-card">
              <h2>Diferencias de efectivo en turnos</h2>
              {overviewDiscrepanciesError && (
                <p role="alert" className="alert-error-notice">{overviewDiscrepanciesError}</p>
              )}
              {shiftDiscrepancies.length > 0 ? (
                <ul className="alert-audit-list shift-discrepancies-list">
                  {shiftDiscrepancies.map(sd => (
                    <li key={sd.shift_id} className="alert-audit-item shift-discrepancy-item">
                      <span>Turno {sd.register_name ? `(${sd.register_name})` : sd.shift_id}: </span>
                      <strong className={sd.difference_minor < 0 ? 'alert-amount-negative' : 'alert-amount-positive'}>
                        {sd.difference_minor < 0 ? 'Faltante: ' : 'Sobrante: '}
                        {formatMoney(Math.abs(sd.difference_minor))} MXN
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : (
                !overviewDiscrepanciesError && <p className="muted">No hay diferencias de efectivo registradas.</p>
              )}
            </Panel>
          )}

          {selectedBranchId && (
            <Panel className="alert-audit-card">
              <h2>Diferencias de conteo de inventario</h2>
              {overviewDiscrepanciesError && (
                <p role="alert" className="alert-error-notice">{overviewDiscrepanciesError}</p>
              )}
              {countDiscrepancies.length > 0 ? (
                <ul className="alert-audit-list count-discrepancies-list">
                  {countDiscrepancies.map((cd, index) => {
                    const diff = cd.physical_quantity - (cd.expected_quantity ?? 0);
                    return (
                      <li key={`${cd.shift_id}:${cd.product}:${index}`} className="alert-audit-item count-discrepancy-item">
                        <span>
                          {cd.product}: Esperado {cd.expected_quantity ?? '—'}, contado {cd.physical_quantity}
                        </span>
                        <strong className={diff < 0 ? 'alert-amount-negative' : 'alert-amount-positive'}>
                          ({diff > 0 ? `+${diff}` : diff})
                        </strong>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                !overviewDiscrepanciesError && <p className="muted">No hay discrepancias de conteo registradas.</p>
              )}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
