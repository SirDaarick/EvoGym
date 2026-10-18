import type { DemoState, LedgerEvent, Money, PaymentMethod } from '../domain/models';

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

const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });
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

export function getMexicoCityDateKey(timestamp: string): string | null {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : DATE_FORMATTER.format(date);
}

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

interface SourceReference { family: FinanceSourceFamily; memberId?: string | null; memberName?: string | null; method?: PaymentMethod; status: string; label: string }

function sourceReferences(state: DemoState): Map<string, SourceReference> {
  const refs = new Map<string, SourceReference>();
  for (const item of state.payments ?? []) refs.set(item.id, { family: 'membership', memberId: item.memberId, method: item.method, status: item.status, label: item.planName });
  for (const item of state.sales ?? []) refs.set(item.id, { family: item.kind, memberId: item.memberId, memberName: item.memberName, method: item.method, status: item.status, label: item.description });
  for (const item of state.supplementSales ?? []) refs.set(item.id, { family: 'supplement', memberId: item.memberId, memberName: item.memberName, method: item.method, status: item.status, label: item.name });
  for (const item of state.gloveRentals ?? []) refs.set(item.id, { family: 'glove', memberId: item.memberId, memberName: item.memberName, method: item.method, status: item.status, label: `Glove rental ${item.gloveId}` });
  for (const item of state.lockerRentals ?? []) refs.set(item.id, { family: 'locker', memberId: item.memberId, memberName: item.memberName, method: item.method, status: item.status, label: `Locker rental ${item.lockerId}` });
  return refs;
}

function validAmount(value: number): value is number { return Number.isSafeInteger(value); }

function rowInRange(row: FinanceRow, range: FinanceDateRange): boolean {
  return row.dateKey >= range.from && row.dateKey <= range.to;
}

function resolveMember(state: DemoState, source?: SourceReference, event?: LedgerEvent): string | null {
  const id = event?.memberId ?? source?.memberId;
  return source?.memberName ?? (id ? state.members.find(member => member.id === id)?.name ?? null : null);
}

function makeRow(state: DemoState, ref: string, id: string, recordedAt: string, amount: number, method: PaymentMethod | null,
  family: FinanceSourceFamily, status: string, subtype: FinanceRowSubtype, description: string, orphan = false, source?: SourceReference, event?: LedgerEvent): FinanceRow | null {
  const dateKey = getMexicoCityDateKey(recordedAt);
  if (!dateKey || !Number.isSafeInteger(amount)) return null;
  return { id, sourceFamily: family, sourceReference: ref, memberLabel: resolveMember(state, source, event), method, status, recordedAt, dateKey, amountMinor: amount, subtype, orphan, description };
}

export function getFinanceProjection(state: DemoState, requestedRange: FinanceDateRange = getCurrentCalendarMonthRange(state.demoClock)): FinanceProjection {
  const rangeValid = isValidFinanceRange(requestedRange);
  const range = { from: requestedRange?.from ?? '', to: requestedRange?.to ?? '' };
  const emptyTotals: FinanceTotals = { grossMinor: 0, refundsMinor: 0, netMinor: 0, extrasMinor: 0, expensesMinor: 0, balanceMinor: 0, pendingMinor: 0 };
  if (!rangeValid) return { range, rangeValid, rows: [], totals: emptyTotals, bySource: [], issues: [] };

  const refs = sourceReferences(state);
  const rows: FinanceRow[] = [];
  const issues: FinanceProjectionIssue[] = [];
  for (const event of state.ledger ?? []) {
    const source = refs.get(event.paymentId);
    if (source?.status === 'pending') continue;
    const family = source?.family ?? (event.kind === 'membership' ? 'membership' : event.kind === 'visit' ? 'visit' : 'unknown');
    if (!validAmount(event.amountMinor)) { issues.push({ id: event.id, sourceFamily: family, reason: 'invalid-amount' }); continue; }
    const amount = event.amountMinor;
    const subtype: FinanceRowSubtype = amount < 0 ? 'refund' : 'collection';
    const row = makeRow(state, event.paymentId, event.id, event.recordedAt, amount, event.method, family,
      amount < 0 ? 'refunded' : (source?.status === 'paid' || source?.status === 'confirmed' ? source.status : 'confirmed'),
      subtype, source?.label ?? `Unmatched ledger event ${event.id}`, !source, source, event);
    if (!row) issues.push({ id: event.id, sourceFamily: family, reason: 'invalid-timestamp' });
    else if (rowInRange(row, range)) rows.push(row);
  }

  const pendingSources: { id: string; family: FinanceSourceFamily; memberId?: string | null; memberName?: string | null; method: PaymentMethod; status: string; label: string; recordedAt: string; amountMinor: number }[] = [
    ...(state.payments ?? []).filter(x => x.status === 'pending').map(x => ({ id: x.id, family: 'membership' as const, memberId: x.memberId, method: x.method, status: x.status, label: x.planName, recordedAt: x.recordedAt, amountMinor: x.amountMinor })),
    ...(state.sales ?? []).filter(x => x.status === 'pending').map(x => ({ id: x.id, family: x.kind, memberId: x.memberId, memberName: x.memberName, method: x.method, status: x.status, label: x.description, recordedAt: x.recordedAt, amountMinor: x.amountMinor })),
    ...(state.supplementSales ?? []).filter(x => x.status === 'pending').map(x => ({ id: x.id, family: 'supplement' as const, memberId: x.memberId, memberName: x.memberName, method: x.method, status: x.status, label: x.name, recordedAt: x.recordedAt, amountMinor: x.amountMinor })),
    ...(state.gloveRentals ?? []).filter(x => x.status === 'pending').map(x => ({ id: x.id, family: 'glove' as const, memberId: x.memberId, memberName: x.memberName, method: x.method, status: x.status, label: `Glove rental ${x.gloveId}`, recordedAt: x.rentedAt, amountMinor: x.priceMinor })),
    ...(state.lockerRentals ?? []).filter(x => x.status === 'pending').map(x => ({ id: x.id, family: 'locker' as const, memberId: x.memberId, memberName: x.memberName, method: x.method, status: x.status, label: `Locker rental ${x.lockerId}`, recordedAt: x.rentedAt, amountMinor: x.priceMinor })),
  ];
  for (const source of pendingSources) {
    if ((state.ledger ?? []).some(event => event.paymentId === source.id && refs.get(source.id)?.status !== 'pending')) continue;
    if (!validAmount(source.amountMinor)) { issues.push({ id: `pending:${source.id}`, sourceFamily: source.family, reason: 'invalid-amount' }); continue; }
    const ref: SourceReference = { ...source };
    const row = makeRow(state, source.id, `pending:${source.id}`, source.recordedAt, source.amountMinor, source.method,
      source.family, 'pending', 'pending', source.label, false, ref);
    if (!row) issues.push({ id: `pending:${source.id}`, sourceFamily: source.family, reason: 'invalid-timestamp' });
    else if (rowInRange(row, range)) rows.push(row);
  }
  for (const item of state.extras ?? []) {
    if (!validAmount(item.amountMinor)) { issues.push({ id: `extra:${item.id}`, sourceFamily: 'extra', reason: 'invalid-amount' }); continue; }
    const row = makeRow(state, item.id, `extra:${item.id}`, item.recordedAt, item.amountMinor, null, 'extra', 'recorded', 'extra', item.concept);
    if (!row) issues.push({ id: `extra:${item.id}`, sourceFamily: 'extra', reason: 'invalid-timestamp' });
    else if (rowInRange(row, range)) rows.push(row);
  }
  for (const item of state.expenses ?? []) {
    if (!validAmount(item.amountMinor)) { issues.push({ id: `expense:${item.id}`, sourceFamily: 'expense', reason: 'invalid-amount' }); continue; }
    const row = makeRow(state, item.id, `expense:${item.id}`, item.recordedAt, -Math.abs(item.amountMinor), null, 'expense', 'recorded', 'expense', `${item.concept} · ${item.payeeName}`);
    if (!row) issues.push({ id: `expense:${item.id}`, sourceFamily: 'expense', reason: 'invalid-timestamp' });
    else if (rowInRange(row, range)) rows.push(row);
  }

  rows.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
  const totals: FinanceTotals = { ...emptyTotals };
  const acceptedRows: FinanceRow[] = [];
  for (const row of rows) {
    const next = { ...totals };
    if (row.subtype === 'collection' && row.amountMinor > 0) next.grossMinor += row.amountMinor;
    if (row.subtype === 'refund') next.refundsMinor += Math.abs(row.amountMinor);
    if (row.subtype === 'extra') next.extrasMinor += row.amountMinor;
    if (row.subtype === 'expense') next.expensesMinor += Math.abs(row.amountMinor);
    if (row.subtype === 'pending') next.pendingMinor += row.amountMinor;
    next.netMinor = next.grossMinor - next.refundsMinor;
    next.balanceMinor = next.netMinor + next.extrasMinor - next.expensesMinor;
    if (Object.values(next).some(value => !Number.isSafeInteger(value))) {
      issues.push({ id: row.id, sourceFamily: row.sourceFamily, reason: 'total-overflow' });
      continue;
    }
    Object.assign(totals, next);
    acceptedRows.push(row);
  }
  rows.length = 0;
  rows.push(...acceptedRows);
  const bySource = new Map<FinanceSourceFamily, FinanceSourceTotal>();
  for (const row of rows) {
    if (row.subtype !== 'collection' && row.subtype !== 'refund') continue;
    const total = bySource.get(row.sourceFamily) ?? { sourceFamily: row.sourceFamily, amountMinor: 0, count: 0 };
    total.amountMinor += row.amountMinor;
    total.count++;
    bySource.set(row.sourceFamily, total);
  }
  return { range, rangeValid, rows, totals, bySource: [...bySource.values()].sort((a, b) => b.amountMinor - a.amountMinor), issues };
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
