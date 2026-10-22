import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getActivePlans,
  reloadPlans,
  getPlanStorageIssue,
  getPlanList,
  INITIAL_PLANS,
  plans,
  resetPlans,
  savePlan,
  togglePlanActive,
  updatePlan,
  useActivePlans,
  usePlans,
  type Plan,
} from './plans';

describe('plan store and management', () => {
  beforeEach(() => {
    resetPlans();
  });

  describe('initial plans and defaults', () => {
    it('preserves existing offers and adds the operative catalog', () => {
      expect(INITIAL_PLANS.length).toBeGreaterThan(0);
      for (const plan of INITIAL_PLANS) {
        expect(plan.active).toBe(true);
      }
    });

    it('provides static plans array for backward compatibility', () => {
      expect(plans.length).toBe(INITIAL_PLANS.length);
      expect(plans.find(p => p.id === 'gym-month')?.amountMinor).toBe(50000);
    });

    it('getPlanList and getActivePlans return initial plans', () => {
      const all = getPlanList();
      const active = getActivePlans();
      expect(all.length).toBe(INITIAL_PLANS.length);
      expect(active.length).toBe(INITIAL_PLANS.length);
    });
  });

  describe('plan CRUD operations', () => {
    it('creates a new plan with auto-generated id and active=true', () => {
      const newPlan = savePlan({
        name: 'Plan Personalizado Cross',
        amountMinor: 85000,
        applicability: 'Acceso total con entrenador personal.',
        kind: 'membership',
      });

      expect(newPlan.id).toBeDefined();
      expect(newPlan.id.length).toBeGreaterThan(0);
      expect(newPlan.active).toBe(true);
      expect(newPlan.name).toBe('Plan Personalizado Cross');
      expect(newPlan.amountMinor).toBe(85000);

      const all = getPlanList();
      expect(all.find(p => p.id === newPlan.id)).toBeDefined();

      const active = getActivePlans();
      expect(active.find(p => p.id === newPlan.id)).toBeDefined();
    });

    it('creates a plan with explicit id', () => {
      const created = savePlan({
        id: 'box-special-promo',
        name: 'Box Promo Fin de Año',
        amountMinor: 30000,
        applicability: 'Box ilimitado por 1 mes.',
        kind: 'membership',
      });

      expect(created.id).toBe('box-special-promo');
      expect(getPlanList().find(p => p.id === 'box-special-promo')).toBeDefined();
    });

    it('updates an existing plan details', () => {
      const updated = updatePlan('gym-month', {
        amountMinor: 55000,
        applicability: 'Una área: Gym renovado.',
      });

      expect(updated).toBeDefined();
      expect(updated?.amountMinor).toBe(55000);
      expect(updated?.applicability).toBe('Una área: Gym renovado.');

      const fetched = getPlanList().find(p => p.id === 'gym-month');
      expect(fetched?.amountMinor).toBe(55000);
      expect(fetched?.applicability).toBe('Una área: Gym renovado.');
    });

    it('returns undefined when updating a non-existent plan', () => {
      const result = updatePlan('non-existent-plan-id', { amountMinor: 10000 });
      expect(result).toBeUndefined();
    });

    it('toggles plan active status and excludes inactive plans from getActivePlans', () => {
      const toggled = togglePlanActive('gym-month');
      expect(toggled).toBeDefined();
      expect(toggled?.active).toBe(false);

      const activePlans = getActivePlans();
      expect(activePlans.find(p => p.id === 'gym-month')).toBeUndefined();

      const allPlans = getPlanList();
      const inactivePlan = allPlans.find(p => p.id === 'gym-month');
      expect(inactivePlan).toBeDefined();
      expect(inactivePlan?.active).toBe(false);

      // Toggle back to active
      const restored = togglePlanActive('gym-month');
      expect(restored?.active).toBe(true);
      expect(getActivePlans().find(p => p.id === 'gym-month')).toBeDefined();
    });

    it('returns undefined when toggling a non-existent plan', () => {
      const result = togglePlanActive('non-existent-plan-id');
      expect(result).toBeUndefined();
    });

    it('resets plans back to initial defaults', () => {
      savePlan({
        name: 'Plan Temporal',
        amountMinor: 20000,
        applicability: 'Temporal',
        kind: 'visit',
      });
      togglePlanActive('box-month');

      resetPlans();

      const all = getPlanList();
      expect(all.length).toBe(INITIAL_PLANS.length);
      expect(all.find(p => p.name === 'Plan Temporal')).toBeUndefined();
      expect(all.find(p => p.id === 'box-month')?.active).toBe(true);
    });
  });

  describe('reactive hooks', () => {
    it('usePlans reflects changes when a plan is added or updated', () => {
      const { result } = renderHook(() => usePlans());
      const initialCount = result.current.length;

      act(() => {
        savePlan({
          name: 'Pase Sabatino',
          amountMinor: 15000,
          applicability: 'Sábados',
          kind: 'visit',
        });
      });

      expect(result.current.length).toBe(initialCount + 1);
      expect(result.current.some(p => p.name === 'Pase Sabatino')).toBe(true);
    });

    it('useActivePlans excludes inactive plans reactively', () => {
      const { result } = renderHook(() => useActivePlans());
      const initialActiveCount = result.current.length;

      act(() => {
        togglePlanActive('visit-single');
      });

      expect(result.current.length).toBe(initialActiveCount - 1);
      expect(result.current.some(p => p.id === 'visit-single')).toBe(false);

      act(() => {
        togglePlanActive('visit-single');
      });

      expect(result.current.length).toBe(initialActiveCount);
      expect(result.current.some(p => p.id === 'visit-single')).toBe(true);
    });
  });
});

describe('saved plan composition contract', () => {
  beforeEach(() => { vi.restoreAllMocks(); resetPlans(); });
  it('reproduces all twenty operative membership prices, excluding legacy extras', () => {
    const expected: Record<string, number> = {
      'gym-month': 50000, 'box-month': 50000, 'combo-month-old': 65000, 'combo-month': 75000,
      'gym-student': 40000, 'box-student': 40000, 'gym-week': 15000, 'box-week': 15000,
      'combo-week': 20000, 'custom-fortnight': 25000, 'gym-quarter': 120000, 'box-quarter': 120000,
      'combo-quarter': 175000, 'gym-semester': 250000, 'box-semester': 250000, 'combo-semester': 330000,
      'gym-annual': 450000, 'box-annual': 450000, 'combo-annual': 610000, 'box-kids': 35000,
    };
    const memberships = getActivePlans().filter(plan => plan.kind === 'membership' && plan.sourceLabel);
    expect(Object.fromEntries(memberships.map(plan => [plan.id, plan.amountMinor]))).toEqual(expected);
    expect(memberships.every(plan => plan.composition && plan.revision === 1)).toBe(true);
    expect(memberships.find(plan => plan.id === 'custom-fortnight')?.composition?.serviceStatus).toBe('pending');
  });

  it('deep clones composition and advances revision without changing earlier snapshots', () => {
    resetPlans();
    const before = getPlanList().find(plan => plan.id === 'gym-month')!;
    const original = JSON.parse(JSON.stringify(before));
    before.composition!.services.push('box');
    before.composition!.period.value = 9;
    expect(getPlanList().find(plan => plan.id === before.id)).toEqual(original);
    const updated = updatePlan(before.id, { amountMinor: 55000 })!;
    expect(updated.revision).toBe(2);
    expect(original.amountMinor).toBe(50000);
  });
});


describe('catalog persistence and migration', () => {
  beforeEach(() => { vi.restoreAllMocks(); resetPlans(); });

  it('migrates untouched legacy seeds, appends missing source plans and preserves customized entries', () => {
    localStorage.setItem('evogym_plan_catalog', JSON.stringify([
      { id: 'gym-semester', name: 'Gym semestral', amountMinor: 230000, applicability: 'Individual; una sola área. Semestre.', kind: 'membership', active: true },
      { id: 'box-semester', name: 'Box semestral', amountMinor: 210000, applicability: 'Precio acordado', kind: 'membership', active: true },
      { id: 'custom', name: 'Plan propio', amountMinor: 99000, applicability: 'Especial', kind: 'membership', active: false },
    ]));
    reloadPlans();
    expect(getPlanList().find(plan => plan.id === 'gym-semester')?.amountMinor).toBe(250000);
    expect(getPlanList().find(plan => plan.id === 'box-semester')?.amountMinor).toBe(210000);
    expect(getPlanList().find(plan => plan.id === 'custom')?.active).toBe(false);
    expect(getPlanList().find(plan => plan.id === 'combo-annual')?.amountMinor).toBe(610000);
    expect(getPlanStorageIssue()).toContain('ajustes previos');
    updatePlan('custom', { name: 'Plan propio actualizado' });
    expect(JSON.parse(localStorage.getItem('evogym_plan_catalog')!).version).toBe(2);
    reloadPlans();
    expect(getPlanList().find(plan => plan.id === 'box-semester')?.amountMinor).toBe(210000);
    expect(getPlanList().find(plan => plan.id === 'custom')?.name).toBe('Plan propio actualizado');
  });

  it.each(['{broken', JSON.stringify({ version: 99, plans: [] }), JSON.stringify([{ id: 'bad' }])])('does not overwrite unreadable or unsupported storage: %s', raw => {
    localStorage.setItem('evogym_plan_catalog', raw);
    reloadPlans();
    expect(getPlanStorageIssue()).toContain('No se pudo leer');
    expect(() => updatePlan('gym-month', { amountMinor: 60000 })).toThrow();
    expect(localStorage.getItem('evogym_plan_catalog')).toBe(raw);
    resetPlans();
  });

  it('does not falsely report success or mutate memory on a storage quota error', () => {
    const before = getPlanList();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    expect(() => updatePlan('gym-month', { amountMinor: 60000 })).toThrow('No se pudo guardar');
    expect(getPlanList()).toEqual(before);
    spy.mockRestore();
  });

  it('persists a composed custom plan, reloads it and protects both returned and input nested objects', () => {
    const input = { ...getPlanList().find(plan => plan.id === 'gym-month')!, id: 'custom-combo', name: 'Combinación guardada' };
    input.composition!.services.push('box');
    const saved = savePlan(input);
    input.composition!.conditions.notes = 'Mutation';
    saved.composition!.period.value = 9;
    reloadPlans();
    const stored = getPlanList().find(plan => plan.id === saved.id)!;
    expect(stored.composition?.services).toEqual(['gym', 'box']);
    expect(stored.composition?.period.value).toBe(1);
    expect(stored.composition?.conditions.notes).toBe('');
  });
});

it('keeps an explicit reference price through persistence, migration and snapshot projection', async () => {
  resetPlans();
  const plan = getPlanList().find(plan => plan.id === 'gym-month')!;
  const { snapshotPlan } = await import('./plans');
  const saved = savePlan({ ...plan, referenceAmountMinor: 65000 });
  reloadPlans();
  expect(getPlanList().find(plan => plan.id === saved.id)?.referenceAmountMinor).toBe(65000);
  expect(snapshotPlan(saved).referenceAmountMinor).toBe(65000);
  localStorage.setItem('evogym_plan_catalog', JSON.stringify([{ ...plan, revision: undefined, composition: undefined, referenceAmountMinor: 70000 }]));
  reloadPlans();
  expect(getPlanList().find(plan => plan.id === saved.id)?.referenceAmountMinor).toBe(70000);
  resetPlans();
});

it('refuses invalid references but keeps legacy snapshots free of invented reference prices', async () => {
  resetPlans();
  const { snapshotPlan } = await import('./plans');
  const initial = getPlanList().find(plan => plan.id === 'gym-month')!;
  expect(snapshotPlan(initial)).not.toHaveProperty('referenceAmountMinor');
  for (const invalid of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => updatePlan(initial.id, { referenceAmountMinor: invalid })).toThrow();
  }
  localStorage.setItem('evogym_plan_catalog', JSON.stringify([{
    id: 'gym-month', name: 'Gym mensual', amountMinor: 50000,
    applicability: 'Una área: Gym. Mensual por fechas de calendario.', kind: 'membership', active: true,
    referenceAmountMinor: 70000,
  }]));
  reloadPlans();
  expect(getPlanList().find(plan => plan.id === initial.id)?.referenceAmountMinor).toBe(70000);
  resetPlans();
});
