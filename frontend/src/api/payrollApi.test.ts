import { describe, expect, it, vi } from 'vitest';
import { branchPayrollDate } from './payrollApi';

describe('branch payroll date', () => {
  it('uses the branch date when UTC has crossed into the next week', () => {
    const instant = new Date('2026-11-02T02:00:00Z');
    expect(branchPayrollDate('America/Mexico_City', instant)).toEqual({ weekStart: '2026-10-26', weekday: 6 });
    expect(branchPayrollDate('UTC', instant)).toEqual({ weekStart: '2026-11-02', weekday: 0 });
  });
});

describe('payroll history client', () => {
  it('requests the range and optional branch', async () => {
    const { getPayrollHistory } = await import('./payrollApi');
    const request = vi.fn(async () => new Response('{"weeks":[]}'));
    await getPayrollHistory(request as never, '2026-10-01', '2026-10-31', 'b1');
    expect(request).toHaveBeenCalledWith('/api/v1/admin/payroll/history?from=2026-10-01&to=2026-10-31&branch_id=b1', undefined);
  });
});
