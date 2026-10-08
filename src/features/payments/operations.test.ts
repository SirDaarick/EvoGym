import { describe, expect, it } from 'vitest';
import { createDemoState } from '../../demo/adapter';
import { collectMembership, confirmedCollections } from '../../demo/operations';
import { plans } from '../../demo/plans';

describe('membership collection adapter', () => {
  const request = { id: 'payment-test', memberId: 'demo-001', planId: 'gym-month', method: 'cash' as const };
  it('records a full cash payment once without inventing access dates or spending credit', () => {
    const initial = createDemoState();
    initial.members[0].creditMinor = 12000;
    const first = collectMembership(initial, request);
    const second = collectMembership(first.state, request);
    expect(first.result.status).toBe('paid');
    expect(second.state.ledger).toHaveLength(1);
    expect(second.state.payments).toHaveLength(1);
    expect(second.state.members[0].lastPaymentId).toBe('payment-test');
    expect(second.state.members[0].creditMinor).toBe(12000);
    expect(second.state.members[0].membership).toEqual(initial.members[0].membership);
    expect(confirmedCollections(second.state, 'demo-shift-01')).toBe(50000);
  });
  it('keeps a transfer pending, without a confirmed event or access mutation', () => {
    const initial = createDemoState();
    const outcome = collectMembership(initial, { ...request, method: 'transfer' });
    expect(outcome.result.status).toBe('pending');
    expect(outcome.state.ledger).toHaveLength(0);
    expect(outcome.state.members).toEqual(initial.members);
  });
  it('uses the confirmed full card price for a combo membership', () => {
    const outcome = collectMembership(createDemoState(), { ...request, planId: 'combo-month', method: 'card' });
    expect(outcome.result.status).toBe('paid');
    expect(outcome.state.ledger[0].amountMinor).toBe(75000);
    expect(outcome.state.ledger[0].method).toBe('card');
  });
  it('preserves exact prices and disables restricted eligibility rather than assuming approval', () => {
    expect(plans.find(plan => plan.id === 'gym-week')?.amountMinor).toBe(15000);
    expect(plans.find(plan => plan.id === 'gym-annual')?.amountMinor).toBe(450000);
    expect(plans.find(plan => plan.id === 'box-scholarship')?.restriction).toBeTruthy();
    expect(plans.find(plan => plan.id === 'box-kids')?.applicability).toContain('5 a 9');
  });
  it('refuses unresolved eligibility, invalid records, and reuse of an id for another request', () => {
    const initial = createDemoState();
    expect(collectMembership(initial, { ...request, planId: 'box-scholarship' }).result.status).toBe('error');
    expect(collectMembership(initial, { ...request, memberId: 'missing' }).result.status).toBe('error');
    const first = collectMembership(initial, request);
    expect(collectMembership(first.state, { ...request, planId: 'combo-month' }).result.status).toBe('error');
  });
});
