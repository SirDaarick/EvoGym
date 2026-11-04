import type { Money, PaymentMethod } from './models';
import { getMexicoCityDateKey } from '../shared/formatters/date';

export interface FinanceDateRange { from: string; to: string }
export type FinanceSourceFamily = 'membership' | 'product' | 'visit' | 'supplement' | 'glove' | 'locker' | 'extra' | 'expense' | 'unknown';
export type FinanceRowSubtype = 'collection' | 'refund' | 'extra' | 'expense' | 'pending';

export interface FinanceRow {
  id: string;
  sourceFamily: FinanceSourceFamily;
  sourceReference: string;
  memberLabel: string | null;
  method: PaymentMethod | null;
  status: string;
  recordedAt: string;
  dateKey: string;
  amountMinor: Money;
  subtype: FinanceRowSubtype;
  orphan: boolean;
  description: string;
}

export interface FinanceSourceTotal { sourceFamily: FinanceSourceFamily; amountMinor: Money; count: number }
export interface FinanceTotals {
  grossMinor: Money;
  refundsMinor: Money;
  netMinor: Money;
  extrasMinor: Money;
  expensesMinor: Money;
  balanceMinor: Money;
  pendingMinor: Money;
}
export interface FinanceProjection {
  range: FinanceDateRange;
  rangeValid: boolean;
  rows: FinanceRow[];
  totals: FinanceTotals;
  bySource: FinanceSourceTotal[];
  issues: FinanceProjectionIssue[];
}
export interface FinanceProjectionIssue { id: string; sourceFamily: FinanceSourceFamily; reason: 'invalid-amount' | 'invalid-timestamp' | 'total-overflow' }
export interface FinanceTimeBin { key: string; inflowMinor: Money; outflowMinor: Money; hasData: boolean }

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86400000;

function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2200) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dayNumber(key: string): number { return Date.parse(`${key}T00:00:00Z`) / DAY_MS; }
function dateFromDayNumber(day: number): string { return new Date(day * DAY_MS).toISOString().slice(0, 10); }

export function isValidFinanceRange(range: FinanceDateRange): boolean {
  if (!range || !validDateKey(range.from) || !validDateKey(range.to)) return false;
  const length = dayNumber(range.to) - dayNumber(range.from) + 1;
  return length > 0 && length <= MAX_RANGE_DAYS;
}

export function getCurrentCalendarMonthRange(demoClock: string): FinanceDateRange {
  const today = getMexicoCityDateKey(demoClock) ?? '2026-10-01';
  const [year, month] = today.split('-');
  return { from: `${year}-${month}-01`, to: today };
}

export function getPreviousComparableRange(range: FinanceDateRange): FinanceDateRange {
  if (!isValidFinanceRange(range)) return { from: range?.from ?? '', to: range?.to ?? '' };
  const length = dayNumber(range.to) - dayNumber(range.from) + 1;
  const to = dayNumber(range.from) - 1;
  return { from: dateFromDayNumber(to - length + 1), to: dateFromDayNumber(to) };
}

export function getFinanceComparison(current: number, previous: number): { deltaMinor: number; deltaPercent: number | null; comparable: boolean } {
  const deltaMinor = current - previous;
  return { deltaMinor, deltaPercent: previous === 0 ? null : (deltaMinor / Math.abs(previous)) * 100, comparable: previous !== 0 };
}

export function getFinanceTimeBins(rows: FinanceRow[], range: FinanceDateRange): FinanceTimeBin[] {
  if (!isValidFinanceRange(range)) return [];
  const length = dayNumber(range.to) - dayNumber(range.from) + 1;
  const bins: FinanceTimeBin[] = Array.from({ length }, (_, index) => ({ key: dateFromDayNumber(dayNumber(range.from) + index), inflowMinor: 0, outflowMinor: 0, hasData: false }));
  const binByKey = new Map(bins.map(bin => [bin.key, bin]));
  for (const row of rows) {
    const bin = binByKey.get(row.dateKey);
    if (!bin || row.subtype === 'pending') continue;
    bin.hasData = true;
    if (row.amountMinor < 0) bin.outflowMinor += Math.abs(row.amountMinor);
    else bin.inflowMinor += row.amountMinor;
  }
  return bins;
}
