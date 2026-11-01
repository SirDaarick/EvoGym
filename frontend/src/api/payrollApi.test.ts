import { describe, expect, it } from 'vitest';
import { branchPayrollDate } from './payrollApi';

describe('branch payroll date', () => {
  it('uses the branch date when UTC has crossed into the next week', () => {
    const instant = new Date('2026-11-02T02:00:00Z');
    expect(branchPayrollDate('America/Mexico_City', instant)).toEqual({ weekStart: '2026-10-26', weekday: 6 });
    expect(branchPayrollDate('UTC', instant)).toEqual({ weekStart: '2026-11-02', weekday: 0 });
  });
});
