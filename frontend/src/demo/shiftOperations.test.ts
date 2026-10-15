import { describe, expect, it } from 'vitest';
import { createDemoState } from './adapter';
import { closeShift } from './shiftOperations';

describe('closeShift', () => {
  it('stores optional closing notes on the closed shift', () => {
    const state = createDemoState();
    const transaction = closeShift(state, 50000, undefined, 'Drawer balanced');

    expect(transaction.result.status).toBe('ok');
    expect(transaction.state.shifts.find(shift => shift.id === state.currentShiftId)).toMatchObject({
      status: 'closed',
      closingNotes: 'Drawer balanced',
    });
  });
});
