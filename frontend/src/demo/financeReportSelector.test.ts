import { describe, expect, it } from 'vitest';
import type { DemoState, LedgerEvent } from '../domain/models';
import { createDemoState } from './adapter';
import {
  getCurrentCalendarMonthRange,
  getFinanceComparison,
  getFinanceProjection,
  getFinanceTimeBins,
  getPreviousComparableRange,
  type FinanceDateRange,
} from './financeReportSelector';

const range: FinanceDateRange = { from: '2026-10-01', to: '2026-10-31' };

function baseState(overrides: Partial<DemoState> = {}): DemoState {
  return { ...createDemoState(), demoClock: '2026-10-18T12:00:00-06:00', ledger: [], payments: [], sales: [],
    gloveRentals: [], lockerRentals: [], supplementSales: [], expenses: [], extras: [], ...overrides };
}

function event(id: string, paymentId: string, amountMinor: number, recordedAt = '2026-10-10T12:00:00-06:00', kind: LedgerEvent['kind'] = 'product'): LedgerEvent {
  return { id, paymentId, amountMinor, recordedAt, shiftId: 'shift-1', kind, method: 'cash' };
}

describe('financeReportSelector', () => {
  it('uses ledger as the sole confirmed source across all six business families', () => {
    const state = baseState({
      payments: [{ id: 'mem-1', memberId: 'demo-001', planId: 'p', planName: 'Plan', amountMinor: 1000, method: 'cash', status: 'paid', recordedAt: '2026-10-10T12:00:00-06:00', shiftId: 'shift-1', effectiveDates: null }],
      sales: [
        { id: 'product-1', kind: 'product', description: 'Product', quantity: 1, unitPriceMinor: 200, amountMinor: 200, method: 'cash', status: 'confirmed', shiftId: 'shift-1', recordedAt: '2026-10-10T12:00:00-06:00' },
        { id: 'visit-1', kind: 'visit', description: 'Visit', quantity: 1, unitPriceMinor: 300, amountMinor: 300, method: 'card', status: 'confirmed', shiftId: 'shift-1', recordedAt: '2026-10-10T12:00:00-06:00' },
      ],
      supplementSales: [{ id: 'supp-1', supplementId: 's', name: 'Scoop', scoops: 1, unitPriceMinor: 400, amountMinor: 400, method: 'cash', status: 'confirmed', shiftId: 'shift-1', recordedAt: '2026-10-10T12:00:00-06:00' }],
      gloveRentals: [{ id: 'glove-1', gloveId: 'g', memberId: 'demo-001', memberName: 'Mariana López', shiftId: 'shift-1', priceMinor: 500, method: 'cash', status: 'paid', rentedAt: '2026-10-10T12:00:00-06:00' }],
      lockerRentals: [{ id: 'locker-1', lockerId: 'l', memberId: 'demo-001', memberName: 'Mariana López', shiftId: 'shift-1', priceMinor: 600, method: 'cash', status: 'paid', rentedAt: '2026-10-10T12:00:00-06:00', expiresAt: '2026-11-10T12:00:00-06:00' }],
      ledger: [event('e1', 'mem-1', 1000, undefined, 'membership'), event('e2', 'product-1', 200), event('e3', 'visit-1', 300, undefined, 'visit'), event('e4', 'supp-1', 400), event('e5', 'glove-1', 500), event('e6', 'locker-1', 600)],
    });
    const report = getFinanceProjection(state, range);
    expect(report.rows.map(row => row.sourceFamily)).toEqual(['membership', 'product', 'visit', 'supplement', 'glove', 'locker']);
    expect(report.totals.grossMinor).toBe(3000);
    expect(report.totals.balanceMinor).toBe(3000);
  });

  it('keeps cross-period refunds on their ledger date and does not erase a refunded source sale', () => {
    const state = baseState({
      sales: [{ id: 'sale', kind: 'product', description: 'Refunded later', quantity: 1, unitPriceMinor: 1000, amountMinor: 1000, method: 'cash', status: 'confirmed', shiftId: 'shift-1', recordedAt: '2026-09-30T23:30:00-06:00', refundedAt: '2026-10-02T01:00:00-06:00' }],
      ledger: [event('sale-event', 'sale', 1000, '2026-09-30T23:30:00-06:00'), event('refund', 'sale', -1000, '2026-10-02T01:00:00-06:00')],
    });
    const report = getFinanceProjection(state, range);
    expect(report.rows.map(row => [row.subtype, row.amountMinor])).toEqual([['refund', -1000]]);
    expect(report.totals.refundsMinor).toBe(1000);
  });

  it('retains the original positive event when a sale and its refund share the selected period', () => {
    const state = baseState({
      sales: [{ id: 'same-period', kind: 'product', description: 'Returned', quantity: 1, unitPriceMinor: 1000, amountMinor: 1000, method: 'cash', status: 'confirmed', shiftId: 'shift-1', recordedAt: '2026-10-10T12:00:00-06:00', refundedAt: '2026-10-11T12:00:00-06:00' }],
      ledger: [event('original', 'same-period', 1000, '2026-10-10T12:00:00-06:00'), event('refund', 'same-period', -1000, '2026-10-11T12:00:00-06:00')],
    });
    const projection = getFinanceProjection(state, range);
    expect(projection.rows.map(row => row.amountMinor)).toEqual([1000, -1000]);
    expect(projection.totals).toMatchObject({ grossMinor: 1000, refundsMinor: 1000, netMinor: 0, balanceMinor: 0 });
  });

  it('separates pending transfers, extras and cash expenses from confirmed collections', () => {
    const state = baseState({
      payments: [{ id: 'pending', memberId: 'demo-001', planId: 'p', planName: 'Plan', amountMinor: 700, method: 'transfer', status: 'pending', recordedAt: '2026-10-10T12:00:00-06:00', shiftId: 'shift-1', effectiveDates: null }],
      ledger: [event('pending-event', 'pending', 700, undefined, 'membership')],
      extras: [{ id: 'x', concept: 'Cash change', staffName: 'Staff', amountMinor: 200, shiftId: 'shift-1', recordedAt: '2026-10-10T12:00:00-06:00' }],
      expenses: [{ id: 'out', concept: 'Cleaning', payeeName: 'Vendor', amountMinor: 300, shiftId: 'shift-1', recordedAt: '2026-10-10T12:00:00-06:00' }],
      shifts: [{ id: 'shift-1', window: '06:00–14:00', openedAt: '2026-10-10T06:00:00-06:00', status: 'open', openingCashMinor: 99999 }],
    });
    const report = getFinanceProjection(state, range);
    expect(report.rows.map(row => row.subtype).sort()).toEqual(['expense', 'extra', 'pending']);
    expect(report.totals.pendingMinor).toBe(700);
    expect(report.totals.balanceMinor).toBe(-100);
  });

  it('flags orphan ledger evidence, ignores unconfirmed source-only prices, and keeps zero comparison non-comparable', () => {
    const state = baseState({ sales: [{ id: 'not-confirmed', kind: 'product', description: 'No ledger', quantity: 1, unitPriceMinor: 900, amountMinor: 900, method: 'cash', status: 'confirmed', shiftId: 'shift-1', recordedAt: '2026-10-10T12:00:00-06:00' }], ledger: [event('orphan-event', 'missing', 123)] });
    const report = getFinanceProjection(state, range);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].orphan).toBe(true);
    expect(report.totals.grossMinor).toBe(123);
    expect(getFinanceComparison(0, 0).deltaPercent).toBeNull();
  });

  it('validates inclusive calendar ranges and builds comparable calendar periods safely', () => {
    expect(getCurrentCalendarMonthRange('2024-02-29T23:55:00-06:00')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(getCurrentCalendarMonthRange('2026-10-18T12:00:00-06:00')).toEqual({ from: '2026-10-01', to: '2026-10-18' });
    expect(getCurrentCalendarMonthRange('2026-01-01T00:05:00-06:00')).toEqual({ from: '2026-01-01', to: '2026-01-01' });
    expect(getCurrentCalendarMonthRange('2026-12-31T23:55:00-06:00')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(getCurrentCalendarMonthRange('2026-12-01T00:30:00+14:00')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(getPreviousComparableRange({ from: '2026-10-01', to: '2026-10-18' })).toEqual({ from: '2026-09-13', to: '2026-09-30' });
    expect(getFinanceProjection(baseState(), { from: '2026-02-30', to: '2026-03-01' }).rangeValid).toBe(false);
    expect(getFinanceProjection(baseState(), { from: '2024-01-01', to: '2025-01-01' }).rangeValid).toBe(false);
    expect(getFinanceProjection(baseState({ ledger: [event('before-midnight', 'orphan-a', 1, '2026-10-01T05:59:59.999Z'), event('at-midnight', 'orphan-b', 1, '2026-10-01T06:00:00.000Z')] }), { from: '2026-10-01', to: '2026-10-01' }).rows.map(row => row.id)).toEqual(['at-midnight']);
  });

  it('keeps signed cent totals reconciled with daily chart buckets', () => {
    const state = baseState({ ledger: [event('plus', 'a', 101), event('minus', 'b', -51)], extras: [
      { id: 'negative-extra', concept: 'Cash adjustment', staffName: 'Staff', amountMinor: -40, shiftId: 'shift-1', recordedAt: '2026-10-10T13:00:00-06:00' },
    ] });
    const report = getFinanceProjection(state, range);
    const bins = getFinanceTimeBins(report.rows, range);
    expect(report.totals.balanceMinor).toBe(10);
    expect(bins.reduce((sum, bin) => sum + bin.inflowMinor, 0)).toBe(101);
    expect(bins.reduce((sum, bin) => sum + bin.outflowMinor, 0)).toBe(91);
    expect(bins.reduce((sum, bin) => sum + bin.inflowMinor - bin.outflowMinor, 0)).toBe(report.totals.balanceMinor);
  });

  it('reports malformed persisted amounts and timestamps instead of manufacturing zero-value rows', () => {
    const state = baseState({ ledger: [
      event('fractional', 'a', 1.5), event('not-a-number', 'b', Number.NaN), event('unsafe', 'c', Number.MAX_SAFE_INTEGER + 1),
      event('invalid-time', 'd', 25, 'not-a-date'),
    ] });
    const projection = getFinanceProjection(state, range);
    expect(projection.rows).toHaveLength(0);
    expect(projection.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'fractional', reason: 'invalid-amount' }),
      expect.objectContaining({ id: 'not-a-number', reason: 'invalid-amount' }),
      expect.objectContaining({ id: 'unsafe', reason: 'invalid-amount' }),
      expect.objectContaining({ id: 'invalid-time', reason: 'invalid-timestamp' }),
    ]));
  });

  it('excludes a row that would overflow aggregate totals and exposes the diagnostic', () => {
    const state = baseState({ ledger: [event('first-max', 'a', Number.MAX_SAFE_INTEGER), event('overflow', 'b', 1)] });
    const projection = getFinanceProjection(state, range);
    expect(projection.rows.map(row => row.id)).toEqual(['first-max']);
    expect(projection.totals.balanceMinor).toBe(Number.MAX_SAFE_INTEGER);
    expect(projection.issues).toContainEqual({ id: 'overflow', sourceFamily: 'unknown', reason: 'total-overflow' });
  });
});
