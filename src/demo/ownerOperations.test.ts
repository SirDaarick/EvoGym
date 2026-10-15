import { describe, expect, it } from 'vitest';
import { createDemoState } from './adapter';
import { collectMembership } from './operations';
import { registerSale } from './salesOperations';
import { closeShift } from './shiftOperations';
import { ownerHistory, ownerSummary, localDateKey } from './ownerOperations';

describe('owner read models', () => {
  it('totals confirmed cash/card only and keeps float and pending transfer separate', () => {
    let state = createDemoState();
    state = collectMembership(state, { id: 'member-cash', memberId: 'demo-001', planId: 'gym-month', method: 'cash' }).state;
    state = registerSale(state, { id: 'visit-card', kind: 'visit', area: 'COMBO', quantity: 1, method: 'card' }).state;
    state = registerSale(state, { id: 'transfer', kind: 'product', productId: 'demo-water', quantity: 1, method: 'transfer' }).state;
    state = closeShift(state, 99000).state;
    const summary = ownerSummary(state, { from: '2020-01-01', to: '2030-12-31' });
    expect(summary.cashMinor).toBe(50000);
    expect(summary.cardMinor).toBe(10000);
    expect(summary.confirmedMinor).toBe(60000);
    expect(summary.transferPendingMinor).toBe(2000);
    expect(summary.shiftDiscrepancies[0].cashDifferenceMinor).toBe(1000);
  });
  it('filters traceable history by reporting date, category and method', () => {
    let state = createDemoState();
    state = collectMembership(state, { id: 'membership', memberId: 'demo-001', planId: 'gym-month', method: 'cash' }).state;
    state = registerSale(state, { id: 'visit-card', kind: 'visit', area: 'BOX', quantity: 1, method: 'card' }).state;
    const date = localDateKey(state.sales[0].recordedAt);
    const filtered = ownerHistory(state, { from: date, to: date, category: 'visit', method: 'card' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('visit-card');
    expect(filtered[0].shiftId).toBe('demo-shift-01');
    expect(ownerHistory(state, { from: '2020-01-01', to: '2020-01-02' })).toHaveLength(0);
  });
  it('uses Mexico City reporting dates rather than slicing UTC timestamps', () => {
    expect(localDateKey('2026-10-09T03:00:00Z')).toBe('2026-10-08');
  });
});
