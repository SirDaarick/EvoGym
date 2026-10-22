import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from './adapter';
import { registerNewMember } from './newMemberRegistration';
import { resetPlans, updatePlan, reloadPlans } from './plans';

describe('new member registration', () => {
  beforeEach(resetPlans);
  it('records an anonymous visit with the catalog rate without a confirmation gate', () => {
    const state = createDemoState();
    const transaction = registerNewMember(state, {
      id: 'registration-visit-1', kind: 'visit', planId: 'visit-combo', area: 'COMBO', method: 'cash',
      confirmations: {},
    });

    expect(transaction.result.status).toBe('confirmed');
    if (transaction.result.status !== 'confirmed') return;
    expect(transaction.state.members).toHaveLength(state.members.length);
    expect(transaction.result.sale).toMatchObject({ kind: 'visit', area: 'COMBO', amountMinor: 10000 });
    expect(transaction.state.ledger.at(-1)).toMatchObject({ kind: 'visit', amountMinor: 10000 });
  });

  it('records a card visit without an acknowledgement checkbox', () => {
    const state = createDemoState();
    const transaction = registerNewMember(state, {
      id: 'registration-visit-2', kind: 'visit', planId: 'visit-single', area: 'GYM', method: 'card',
      confirmations: {},
    });

    expect(transaction.result.status).toBe('confirmed');
    expect(transaction.state.sales).toHaveLength(1);
  });

  it('requires a name but allows student pricing without a verification gate', () => {
    const state = createDemoState();
    const missingName = registerNewMember(state, {
      id: 'registration-student-1', kind: 'membership', planId: 'gym-student', method: 'cash',
      confirmations: {},
    });
    expect(missingName.result.status).toBe('error');
    expect(missingName.state).toBe(state);

    const eligible = registerNewMember(state, {
      id: 'registration-student-2', kind: 'membership', planId: 'gym-student', method: 'cash', name: 'Alex Demo',
      confirmations: {},
    });
    expect(eligible.result.status).toBe('confirmed');
    expect(eligible.state.members.at(-1)?.name).toBe('Alex Demo');
  });

  it('saves optional contact data and the MXN $100 trial class without activating membership access', () => {
    const state = createDemoState();
    const transaction = registerNewMember(state, {
      id: 'registration-trial-1', kind: 'membership', planId: 'trial-class', method: 'transfer',
      name: 'Ana Demo', phone: '5551234567', email: 'ana@example.test', confirmations: {},
    });

    expect(transaction.result).toMatchObject({ status: 'pending', amountMinor: 10000 });
    expect(transaction.state.members.at(-1)).toMatchObject({ name: 'Ana Demo', phone: '5551234567', email: 'ana@example.test', membership: null });
    expect(transaction.state.ledger).toHaveLength(state.ledger.length);
    expect(transaction.state.payments.at(-1)).toMatchObject({ planId: 'trial-class', amountMinor: 10000, status: 'pending', effectiveDates: null });
  });

  it('rejects a registration outside an open shift without partially creating a member', () => {
    const state = createDemoState();
    const closedState = { ...state, shifts: state.shifts.map(shift => ({ ...shift, status: 'closed' as const })) };
    const transaction = registerNewMember(closedState, {
      id: 'registration-no-shift', kind: 'membership', planId: 'gym-month', method: 'cash', name: 'Ana Demo',
      confirmations: { cashReceived: true },
    });

    expect(transaction.result.status).toBe('error');
    expect(transaction.state).toBe(closedState);
    expect(closedState.members).toHaveLength(state.members.length);
  });
});


it('registration snapshots keep earlier name, price and nested terms after edit and reload', () => {
  resetPlans();
  const first = registerNewMember(createDemoState(), { id: 'snapshot-registration-1', kind: 'membership', planId: 'gym-month', method: 'cash', name: 'Persona de prueba' });
  expect(first.result.status).toBe('confirmed');
  const snapshot = first.state.payments.at(-1)?.planSnapshot;
  expect(snapshot).toMatchObject({ revision: 1, name: 'Gym mensual', amountMinor: 50000, composition: { services: ['gym'], period: { value: 1 } } });
  updatePlan('gym-month', { name: 'Gym actualizado', amountMinor: 58000, composition: { services: ['gym', 'box'], serviceStatus: 'confirmed', period: { value: 3, unit: 'month', expiryRule: 'calendar' }, conditions: { eligibility: 'general', notes: 'Nuevas condiciones' } } });
  reloadPlans();
  const restoredState = JSON.parse(JSON.stringify(first.state));
  expect(restoredState.payments.at(-1).planSnapshot).toEqual(snapshot);
  const second = registerNewMember(restoredState, { id: 'snapshot-registration-2', kind: 'membership', planId: 'gym-month', method: 'cash', name: 'Otra persona' });
  expect(second.state.payments.at(-1)?.planSnapshot).toMatchObject({ revision: 2, name: 'Gym actualizado', amountMinor: 58000, composition: { services: ['gym', 'box'], period: { value: 3 } } });
  expect(second.state.payments[0].amountMinor).toBe(50000);
  expect(second.state.members.at(-1)?.membership).toBeNull();
  resetPlans();
});

it('keeps reference and actual prices immutable for registrations after catalog repricing', () => {
  resetPlans();
  updatePlan('gym-month', { referenceAmountMinor: 50000, amountMinor: 40000 });
  const request = { id: 'reference-registration-1', kind: 'membership' as const, planId: 'gym-month', method: 'cash' as const, name: 'Persona de prueba' };
  const first = registerNewMember(createDemoState(), request);
  expect(first.state.payments.at(-1)?.planSnapshot).toMatchObject({ referenceAmountMinor: 50000, amountMinor: 40000 });
  updatePlan('gym-month', { referenceAmountMinor: 100000, amountMinor: 80000 });
  reloadPlans();
  const state = JSON.parse(JSON.stringify(first.state));
  const second = registerNewMember(state, { ...request, id: 'reference-registration-2' });
  expect(second.state.payments[0]).toMatchObject({ amountMinor: 40000, planSnapshot: { referenceAmountMinor: 50000, amountMinor: 40000 } });
  expect(second.state.payments[1]).toMatchObject({ amountMinor: 80000, planSnapshot: { referenceAmountMinor: 100000, amountMinor: 80000 } });
  resetPlans();
});
