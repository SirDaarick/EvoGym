import { describe, expect, it } from 'vitest';
import { cashCountTotal, parseCashQuantity } from './cashDenominations';
import { closeShift } from './shiftOperations';
import { createDemoState } from './adapter';

describe('illustrative denomination count', () => {
  it('calculates exact centavo subtotals including fractional coins', () => {
    expect(cashCountTotal([{ valueMinor: 20000, quantity: 2 }, { valueMinor: 50, quantity: 3 }])).toBe(40150);
    expect(parseCashQuantity('')).toBe(0);
    expect(parseCashQuantity(' 2 ')).toBe(2);
  });
  it('rejects unsafe or non-integer quantities and arithmetic', () => {
    for (const value of ['-1', '1.5', 'Infinity', 'NaN', '1e2', '9007199254740992']) expect(parseCashQuantity(value)).toBeNull();
    for (const quantity of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER]) expect(cashCountTotal([{ valueMinor: 10000, quantity }])).toBeNull();
    expect(cashCountTotal([{ valueMinor: 3, quantity: 1 }])).toBeNull();
    expect(cashCountTotal([{ valueMinor: 50, quantity: 1 }, { valueMinor: 50, quantity: 1 }])).toBeNull();
    expect(cashCountTotal([{ valueMinor: 100000, quantity: 90071992547 }, { valueMinor: 50000, quantity: 1 }])).toBeNull();
  });
  it('snapshots a validated count without mutating old/manual records', () => {
    const state = createDemoState();
    const rows = [{ valueMinor: 50000, quantity: 1 }];
    const closed = closeShift(state, 50000, rows);
    expect(closed.result.status).toBe('ok');
    rows[0].quantity = 2;
    expect(closed.state.shifts[0].cashDenominations?.[0].quantity).toBe(1);
    expect(state.shifts[0].cashDenominations).toBeUndefined();
    expect(closeShift(state, 50000).state.shifts[0].cashDenominations).toBeUndefined();
    expect(closeShift(state, 40000, rows).result.status).toBe('error');
    expect(closeShift(state, 0, [{ valueMinor: 50, quantity: -1 }]).state).toBe(state);
  });
});
