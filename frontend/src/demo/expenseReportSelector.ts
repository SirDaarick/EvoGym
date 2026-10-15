import type { DemoState, ExpenseRecord, Money } from '../domain/models';
import { formatMoney } from './adapter';
import {
  DEFAULT_FIXED_COSTS,
  getFixedCosts,
  type FixedCostsConfig,
} from './fixedCostsStore';
import {
  INITIAL_STAFF,
  getStaffList,
  type StaffProfile,
} from '../features/staff/staffStore';

export type ExpenseCategoryKey =
  | 'consumibles'
  | 'limpieza'
  | 'mantenimiento_piso'
  | 'mantenimiento_peso'
  | 'mantenimiento_cardio'
  | 'mantenimiento_box'
  | 'servicios'
  | 'general';

export type ExpenseCategoryLabel =
  | 'Consumibles'
  | 'Limpieza'
  | 'Mantenimiento: Piso'
  | 'Mantenimiento: Peso'
  | 'Mantenimiento: Cardio'
  | 'Mantenimiento: Box'
  | 'Servicios'
  | 'General';

export interface ExpenseCategoryConfig {
  key: ExpenseCategoryKey;
  label: ExpenseCategoryLabel;
  color: string;
}

export const EXPENSE_CATEGORIES: Record<ExpenseCategoryKey, ExpenseCategoryConfig> = {
  consumibles: {
    key: 'consumibles',
    label: 'Consumibles',
    color: '#2455A4', // Accessible Blue
  },
  limpieza: {
    key: 'limpieza',
    label: 'Limpieza',
    color: '#0284C7', // Sky Cyan
  },
  mantenimiento_piso: {
    key: 'mantenimiento_piso',
    label: 'Mantenimiento: Piso',
    color: '#9A3412', // Terracotta
  },
  mantenimiento_peso: {
    key: 'mantenimiento_peso',
    label: 'Mantenimiento: Peso',
    color: '#D97706', // Amber
  },
  mantenimiento_cardio: {
    key: 'mantenimiento_cardio',
    label: 'Mantenimiento: Cardio',
    color: '#EA580C', // Orange-red
  },
  mantenimiento_box: {
    key: 'mantenimiento_box',
    label: 'Mantenimiento: Box',
    color: '#DC2626', // Red
  },
  servicios: {
    key: 'servicios',
    label: 'Servicios',
    color: '#FC6C06', // Official EGC Orange
  },
  general: {
    key: 'general',
    label: 'General',
    color: '#6B7280', // Technical Neutral Gray
  },
};

export interface StaffPayrollItem {
  id: string;
  name: string;
  roleDescription?: string;
  monthlySalaryMinor: Money;
  weeklySalaryMinor: Money;
  dailySalaryMinor: Money;
  monthlySalaryFormatted: string;
  weeklySalaryFormatted: string;
  dailySalaryFormatted: string;
}

export interface ServicesBreakdown {
  aguaMinor: Money;
  luzMinor: Money;
  internetMinor: Money;
  basuraMinor: Money;
  aguaFormatted: string;
  luzFormatted: string;
  internetFormatted: string;
  basuraFormatted: string;
}

export interface FixedCostsSummary {
  rentMinor: Money;
  payrollMinor: Money;
  servicesMinor: Money;
  totalFixedMonthlyMinor: Money;
  dailyBreakEvenMinor: Money;
  perShiftBreakEvenMinor: Money;
  weeklyBreakEvenMinor: Money;
  rentFormatted: string;
  payrollFormatted: string;
  servicesFormatted: string;
  totalFixedMonthlyFormatted: string;
  dailyBreakEvenFormatted: string;
  perShiftBreakEvenFormatted: string;
  weeklyBreakEvenFormatted: string;
  servicesBreakdown: ServicesBreakdown;
  staffPayroll: StaffPayrollItem[];
}

export function computeFixedCostsSummary(
  fixedConfig: FixedCostsConfig = getFixedCosts(),
  staffList: StaffProfile[] = getStaffList()
): FixedCostsSummary {
  const activeStaff = staffList.filter(s => s.active && s.role !== 'OWNER');

  const staffPayroll: StaffPayrollItem[] = activeStaff.map(member => {
    const monthlySalaryMinor = member.salaryMinor ?? 0;
    const weeklySalaryMinor = Math.round(monthlySalaryMinor / 4);
    const dailySalaryMinor = Math.round(weeklySalaryMinor / 5);
    return {
      id: member.id,
      name: member.name,
      monthlySalaryMinor,
      weeklySalaryMinor,
      dailySalaryMinor,
      monthlySalaryFormatted: formatMoney(monthlySalaryMinor),
      weeklySalaryFormatted: formatMoney(weeklySalaryMinor),
      dailySalaryFormatted: formatMoney(dailySalaryMinor),
    };
  });

  const totalPayrollMinor = staffPayroll.reduce((sum, s) => sum + s.monthlySalaryMinor, 0);
  const rentMinor = fixedConfig.rentMinor;
  const servicesMinor =
    fixedConfig.aguaMinor +
    fixedConfig.luzMinor +
    fixedConfig.internetMinor +
    fixedConfig.basuraMinor;
  const totalFixedMonthlyMinor = rentMinor + totalPayrollMinor + servicesMinor;

  const dailyBreakEvenMinor = Math.round(totalFixedMonthlyMinor / 20);
  const weeklyBreakEvenMinor = Math.round(totalFixedMonthlyMinor / 4);
  const perShiftBreakEvenMinor = Math.round(dailyBreakEvenMinor / 2);

  const servicesBreakdown: ServicesBreakdown = {
    aguaMinor: fixedConfig.aguaMinor,
    luzMinor: fixedConfig.luzMinor,
    internetMinor: fixedConfig.internetMinor,
    basuraMinor: fixedConfig.basuraMinor,
    aguaFormatted: formatMoney(fixedConfig.aguaMinor),
    luzFormatted: formatMoney(fixedConfig.luzMinor),
    internetFormatted: formatMoney(fixedConfig.internetMinor),
    basuraFormatted: formatMoney(fixedConfig.basuraMinor),
  };

  return {
    rentMinor,
    payrollMinor: totalPayrollMinor,
    servicesMinor,
    totalFixedMonthlyMinor,
    dailyBreakEvenMinor,
    perShiftBreakEvenMinor,
    weeklyBreakEvenMinor,
    rentFormatted: formatMoney(rentMinor),
    payrollFormatted: formatMoney(totalPayrollMinor),
    servicesFormatted: formatMoney(servicesMinor),
    totalFixedMonthlyFormatted: formatMoney(totalFixedMonthlyMinor),
    dailyBreakEvenFormatted: formatMoney(dailyBreakEvenMinor),
    perShiftBreakEvenFormatted: formatMoney(perShiftBreakEvenMinor),
    weeklyBreakEvenFormatted: formatMoney(weeklyBreakEvenMinor),
    servicesBreakdown,
    staffPayroll,
  };
}

export const MASTER_FIXED_COSTS: FixedCostsSummary = computeFixedCostsSummary(
  DEFAULT_FIXED_COSTS,
  INITIAL_STAFF
);

export const MASTER_STAFF_PAYROLL: StaffPayrollItem[] = MASTER_FIXED_COSTS.staffPayroll;

export interface MajorCostBlock {
  name: string;
  label: string;
  type: 'fixed' | 'variable';
  amountMinor: Money;
  amount: number;
  amountFormatted: string;
  percent: number;
  color: string;
}

export type ExpensePeriod = 'week' | 'month' | 'all' | 'custom';

export interface DateRange {
  from: string;
  to: string;
}

export type ExpensePeriodInput =
  | ExpensePeriod
  | DateRange
  | { period: ExpensePeriod; customRange?: DateRange };

export interface ExpenseReportItem {
  id: string;
  recordedAt: string;
  dateKey: string;
  formattedDate: string;
  formattedTime: string;
  shiftId: string;
  shiftWindow: string;
  concept: string;
  category: ExpenseCategoryLabel;
  categoryKey: ExpenseCategoryKey;
  payeeName: string;
  amountMinor: Money;
  amountFormatted: string;
}

export interface ExpenseCategorySummary {
  category: ExpenseCategoryLabel;
  categoryKey: ExpenseCategoryKey;
  totalMinor: Money;
  totalAmount: number;
  totalFormatted: string;
  count: number;
  percent: number;
  color: string;
}

export interface ExpenseShiftSummary {
  shiftId: string;
  shiftWindow: string;
  totalMinor: Money;
  totalAmount: number;
  totalFormatted: string;
  count: number;
}

export interface ExpenseReportKPIs {
  totalMinor: Money;
  count: number;
  averageMinor: Money;
  totalFormatted: string;
  averageFormatted: string;
  proratedFixedMinor: Money;
  proratedFixedFormatted: string;
  consolidatedTotalMinor: Money;
  consolidatedTotalFormatted: string;
  dailyBreakEvenMinor: Money;
  dailyBreakEvenFormatted: string;
  totalFixedMonthlyMinor: Money;
  totalFixedMonthlyFormatted: string;
}

export interface ExpenseReportResult {
  period: ExpensePeriod;
  dateRange: DateRange;
  kpis: ExpenseReportKPIs;
  fixedCosts: FixedCostsSummary;
  majorCostBlocks: MajorCostBlock[];
  categoryDistribution: ExpenseCategorySummary[];
  byShift: ExpenseShiftSummary[];
  items: ExpenseReportItem[];
}

const mexicoCityDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const displayDateFormatter = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const displayTimeFormatter = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function localDateKey(timestamp: string | Date): string {
  const dateObj = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (Number.isNaN(dateObj.getTime())) return '';
  const parts = mexicoCityDateFormatter.formatToParts(dateObj);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatExpenseDate(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return displayDateFormatter.format(d);
}

export function formatExpenseTime(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return `${displayTimeFormatter.format(d)} hrs`;
}

/**
 * Automatically classifies an expense concept into an Excel business category:
 * Consumibles | Limpieza | Mantenimiento: Piso | Mantenimiento: Peso | Mantenimiento: Cardio | Mantenimiento: Box | Servicios | General
 */
export function classifyExpenseConcept(concept: string): ExpenseCategoryLabel {
  const normalized = (concept || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // 1. Limpieza
  if (
    /cloro|jabon|detergente|trapeador|escoba|desinfectante|sanitizante|sanitas|aromatizante|franela|atomizador/.test(
      normalized
    ) ||
    (normalized.includes('limpieza') && !normalized.includes('mantenimiento'))
  ) {
    return 'Limpieza';
  }

  // 2. Mantenimiento subcategories
  // 2a. Mantenimiento: Box
  if (/costal|pera|box|boxeo|ring|guante/.test(normalized)) {
    return 'Mantenimiento: Box';
  }

  // 2b. Mantenimiento: Piso
  if (/piso|loseta|duela|caucho|tapete/.test(normalized)) {
    return 'Mantenimiento: Piso';
  }

  // 2c. Mantenimiento: Cardio
  if (/caminadora|eliptica|escaladora|banda|bicicleta|spinning|cardio|polea|cable/.test(normalized)) {
    return 'Mantenimiento: Cardio';
  }

  // 2d. Mantenimiento: Peso
  if (/mancuerna|disco|barra|rack|banco|peso|pesas|soldadura|herreria/.test(normalized)) {
    return 'Mantenimiento: Peso';
  }

  // Generic Mantenimiento fallback -> Mantenimiento: Peso
  if (/mantenimiento|reparacion|refaccion|tecnico|plomeria|cerrajeria|aire|clima|foco|balastra|tornillo/.test(normalized)) {
    return 'Mantenimiento: Peso';
  }

  // 3. Servicios
  if (
    /luz|cfe|electricidad|internet|telefono|telmex|servicio|gas|alestra|izzi|megacable|software|suscripcion|linea/.test(
      normalized
    )
  ) {
    return 'Servicios';
  }

  // 4. Consumibles
  if (
    /garrafon|agua|vaso|cafe|azucar|\bte\b|servilleta|insumo|papel|bolsa/.test(
      normalized
    )
  ) {
    return 'Consumibles';
  }

  // 5. General fallback
  return 'General';
}

function resolvePeriodAndRange(
  input: ExpensePeriodInput,
  refDate: Date
): { period: ExpensePeriod; dateRange: DateRange } {
  const refDateStr = localDateKey(refDate);

  if (typeof input === 'object' && 'from' in input && 'to' in input) {
    return {
      period: 'custom',
      dateRange: { from: input.from, to: input.to },
    };
  }

  const period: ExpensePeriod =
    typeof input === 'string'
      ? input
      : typeof input === 'object' && 'period' in input
      ? input.period
      : 'all';

  if (period === 'custom' && typeof input === 'object' && 'customRange' in input && input.customRange) {
    return {
      period: 'custom',
      dateRange: input.customRange,
    };
  }

  if (period === 'week') {
    const fromMs = refDate.getTime() - 7 * 24 * 60 * 60 * 1000;
    return {
      period: 'week',
      dateRange: { from: localDateKey(new Date(fromMs)), to: refDateStr },
    };
  }

  if (period === 'month') {
    const fromMs = refDate.getTime() - 30 * 24 * 60 * 60 * 1000;
    return {
      period: 'month',
      dateRange: { from: localDateKey(new Date(fromMs)), to: refDateStr },
    };
  }

  // 'all'
  return {
    period: 'all',
    dateRange: { from: '2020-01-01', to: refDateStr },
  };
}

function matchesPeriod(
  expenseDateKey: string,
  period: ExpensePeriod,
  dateRange: DateRange,
  refDate: Date
): boolean {
  if (period === 'all') return true;
  if (!expenseDateKey) return false;

  if (period === 'custom') {
    return expenseDateKey >= dateRange.from && expenseDateKey <= dateRange.to;
  }

  const refDateStr = localDateKey(refDate);
  const refMs = Date.parse(`${refDateStr}T00:00:00Z`);
  const expenseMs = Date.parse(`${expenseDateKey}T00:00:00Z`);
  const diffDays = Math.round((refMs - expenseMs) / (24 * 60 * 60 * 1000));

  if (period === 'week') {
    return diffDays >= 0 && diffDays <= 7;
  }

  if (period === 'month') {
    return diffDays >= 0 && diffDays <= 30;
  }

  return true;
}

/**
 * Pure selector that computes the expense report, fixed costs structure,
 * break-even KPIs, major cost blocks, category distribution,
 * and shift aggregations from DemoState.
 * Strict boundary: ONLY processes state.expenses for variable outflows.
 */
export interface ExpenseReportOptions {
  fixedCosts?: FixedCostsConfig;
  staff?: StaffProfile[];
}

export function getExpenseReport(
  state: DemoState,
  periodInput: ExpensePeriodInput = 'all',
  referenceDate?: string | Date,
  options?: ExpenseReportOptions
): ExpenseReportResult {
  const refDate = referenceDate
    ? typeof referenceDate === 'string'
      ? new Date(referenceDate)
      : referenceDate
    : state.demoClock
    ? new Date(state.demoClock)
    : new Date();

  const { period, dateRange } = resolvePeriodAndRange(periodInput, refDate);

  const fixedCosts = computeFixedCostsSummary(
    options?.fixedCosts ?? getFixedCosts(),
    options?.staff ?? getStaffList()
  );

  // Map of shifts for fast lookup of shift window
  const shiftMap = new Map<string, string>();
  for (const s of state.shifts ?? []) {
    shiftMap.set(s.id, s.window);
  }

  const rawExpenses = state.expenses ?? [];
  const items: ExpenseReportItem[] = [];

  for (const exp of rawExpenses) {
    const dateKey = localDateKey(exp.recordedAt);
    if (!matchesPeriod(dateKey, period, dateRange, refDate)) {
      continue;
    }

    const categoryLabel = classifyExpenseConcept(exp.concept);
    const categoryConfig = Object.values(EXPENSE_CATEGORIES).find(
      c => c.label === categoryLabel
    ) ?? EXPENSE_CATEGORIES.general;
    const categoryKey = categoryConfig.key;
    const shiftWindow = shiftMap.get(exp.shiftId) ?? exp.shiftId;

    items.push({
      id: exp.id,
      recordedAt: exp.recordedAt,
      dateKey,
      formattedDate: formatExpenseDate(exp.recordedAt),
      formattedTime: formatExpenseTime(exp.recordedAt),
      shiftId: exp.shiftId,
      shiftWindow,
      concept: exp.concept,
      category: categoryLabel,
      categoryKey,
      payeeName: exp.payeeName,
      amountMinor: exp.amountMinor,
      amountFormatted: formatMoney(exp.amountMinor),
    });
  }

  // Sort newest first
  items.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

  // Variable KPIs
  const totalMinor = items.reduce((sum, item) => sum + item.amountMinor, 0);
  const count = items.length;
  const averageMinor = count > 0 ? Math.round(totalMinor / count) : 0;

  // Fixed Costs Proration
  let proratedFixedMinor: Money = fixedCosts.totalFixedMonthlyMinor;
  let proratedPayrollMinor: Money = fixedCosts.payrollMinor;
  let proratedRentMinor: Money = fixedCosts.rentMinor;
  let proratedServicesMinor: Money = fixedCosts.servicesMinor;

  if (period === 'week') {
    proratedFixedMinor = fixedCosts.weeklyBreakEvenMinor;
    proratedPayrollMinor = Math.round(fixedCosts.payrollMinor / 4);
    proratedRentMinor = Math.round(fixedCosts.rentMinor / 4);
    proratedServicesMinor = Math.round(fixedCosts.servicesMinor / 4);
  } else if (period === 'month' || period === 'all') {
    proratedFixedMinor = fixedCosts.totalFixedMonthlyMinor;
    proratedPayrollMinor = fixedCosts.payrollMinor;
    proratedRentMinor = fixedCosts.rentMinor;
    proratedServicesMinor = fixedCosts.servicesMinor;
  } else if (period === 'custom') {
    const fromMs = Date.parse(`${dateRange.from}T00:00:00Z`);
    const toMs = Date.parse(`${dateRange.to}T00:00:00Z`);
    const days = Math.max(1, Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000)) + 1);
    proratedFixedMinor = days * fixedCosts.dailyBreakEvenMinor;
    proratedPayrollMinor = days * Math.round(fixedCosts.payrollMinor / 20);
    proratedRentMinor = days * Math.round(fixedCosts.rentMinor / 20);
    proratedServicesMinor = days * Math.round(fixedCosts.servicesMinor / 20);
  }

  const consolidatedTotalMinor = proratedFixedMinor + totalMinor;

  const kpis: ExpenseReportKPIs = {
    totalMinor,
    count,
    averageMinor,
    totalFormatted: formatMoney(totalMinor),
    averageFormatted: formatMoney(averageMinor),
    proratedFixedMinor,
    proratedFixedFormatted: formatMoney(proratedFixedMinor),
    consolidatedTotalMinor,
    consolidatedTotalFormatted: formatMoney(consolidatedTotalMinor),
    dailyBreakEvenMinor: fixedCosts.dailyBreakEvenMinor,
    dailyBreakEvenFormatted: fixedCosts.dailyBreakEvenFormatted,
    totalFixedMonthlyMinor: fixedCosts.totalFixedMonthlyMinor,
    totalFixedMonthlyFormatted: fixedCosts.totalFixedMonthlyFormatted,
  };

  // Major Cost Blocks for TanStack Charts comparison
  const majorCostBlocks: MajorCostBlock[] = [
    {
      name: 'Nómina',
      label: `Nómina de personal (${fixedCosts.staffPayroll.length} colaboradores)`,
      type: 'fixed',
      amountMinor: proratedPayrollMinor,
      amount: proratedPayrollMinor / 100,
      amountFormatted: formatMoney(proratedPayrollMinor),
      percent: consolidatedTotalMinor > 0 ? Math.round((proratedPayrollMinor / consolidatedTotalMinor) * 100) : 0,
      color: '#2563EB', // Blue
    },
    {
      name: 'Renta',
      label: 'Renta de instalaciones',
      type: 'fixed',
      amountMinor: proratedRentMinor,
      amount: proratedRentMinor / 100,
      amountFormatted: formatMoney(proratedRentMinor),
      percent: consolidatedTotalMinor > 0 ? Math.round((proratedRentMinor / consolidatedTotalMinor) * 100) : 0,
      color: '#D97706', // Amber
    },
    {
      name: 'Servicios',
      label: 'Servicios fijos (Luz, Agua, Red, Basura)',
      type: 'fixed',
      amountMinor: proratedServicesMinor,
      amount: proratedServicesMinor / 100,
      amountFormatted: formatMoney(proratedServicesMinor),
      percent: consolidatedTotalMinor > 0 ? Math.round((proratedServicesMinor / consolidatedTotalMinor) * 100) : 0,
      color: '#FC6C06', // EGC Orange
    },
    {
      name: 'Variables',
      label: 'Variables / Caja chica de turno',
      type: 'variable',
      amountMinor: totalMinor,
      amount: totalMinor / 100,
      amountFormatted: formatMoney(totalMinor),
      percent: consolidatedTotalMinor > 0 ? Math.round((totalMinor / consolidatedTotalMinor) * 100) : 0,
      color: '#10B981', // Emerald
    },
  ];

  // Category distribution for variable expenses
  const catSums: Partial<Record<ExpenseCategoryKey, { minor: number; count: number }>> = {};
  for (const item of items) {
    if (!catSums[item.categoryKey]) {
      catSums[item.categoryKey] = { minor: 0, count: 0 };
    }
    catSums[item.categoryKey]!.minor += item.amountMinor;
    catSums[item.categoryKey]!.count += 1;
  }

  const categoryDistribution: ExpenseCategorySummary[] = (
    Object.keys(catSums) as ExpenseCategoryKey[]
  )
    .filter(key => (catSums[key]?.count ?? 0) > 0)
    .map(key => {
      const config = EXPENSE_CATEGORIES[key] ?? EXPENSE_CATEGORIES.general;
      const minor = catSums[key]!.minor;
      const cnt = catSums[key]!.count;
      const pct = totalMinor > 0 ? Math.round((minor / totalMinor) * 100) : 0;

      return {
        category: config.label,
        categoryKey: key,
        totalMinor: minor,
        totalAmount: minor / 100,
        totalFormatted: formatMoney(minor),
        count: cnt,
        percent: pct,
        color: config.color,
      };
    })
    .sort((a, b) => b.totalMinor - a.totalMinor);

  // Shift breakdown
  const shiftSums = new Map<string, { totalMinor: number; count: number; shiftWindow: string }>();
  for (const item of items) {
    const existing = shiftSums.get(item.shiftId);
    if (existing) {
      existing.totalMinor += item.amountMinor;
      existing.count += 1;
    } else {
      shiftSums.set(item.shiftId, {
        totalMinor: item.amountMinor,
        count: 1,
        shiftWindow: item.shiftWindow,
      });
    }
  }

  const byShift: ExpenseShiftSummary[] = Array.from(shiftSums.entries())
    .map(([shiftId, data]) => ({
      shiftId,
      shiftWindow: data.shiftWindow,
      totalMinor: data.totalMinor,
      totalAmount: data.totalMinor / 100,
      totalFormatted: formatMoney(data.totalMinor),
      count: data.count,
    }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  return {
    period,
    dateRange,
    kpis,
    fixedCosts,
    majorCostBlocks,
    categoryDistribution,
    byShift,
    items,
  };
}
