import type { DemoState, ExpenseRecord, Money } from '../domain/models';
import { formatMoney } from '../shared/formatters/money';
import { formatExpenseDate, formatExpenseTime, localDateKey } from '../shared/formatters/date';
import {
  EXPENSE_CATEGORIES,
  classifyExpenseConcept,
  type ExpenseCategoryConfig,
  type ExpenseCategoryKey,
  type ExpenseCategoryLabel,
  type ExpenseMethod,
} from '../domain/expenses';
import { INITIAL_STAFF, type StaffProfile } from '../domain/staff';

export {
  EXPENSE_CATEGORIES,
  classifyExpenseConcept,
  formatExpenseDate,
  formatExpenseTime,
  localDateKey,
};
export type { ExpenseCategoryConfig, ExpenseCategoryKey, ExpenseCategoryLabel };

// The staff roster lives in a feature store; it registers itself here so demo code
// does not depend upward on features/. Defaults to the seed roster until registered.
let staffSource: () => StaffProfile[] = () => INITIAL_STAFF;
export function setDefaultStaffSource(source: () => StaffProfile[]): void {
  staffSource = source;
}
const getStaffList = (): StaffProfile[] => staffSource();
import {
  DEFAULT_FIXED_COSTS,
  getFixedCosts,
  type FixedCostsConfig,
} from './fixedCostsStore';


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
  method?: ExpenseMethod;
  origin?: 'shift' | 'business';
  voucherReference?: string | null;
  evidenceUrl?: string | null;
  voided?: boolean;
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

    const categoryLabel = exp.category ? EXPENSE_CATEGORIES[exp.category].label : classifyExpenseConcept(exp.concept);
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
