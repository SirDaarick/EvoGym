import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getActivePlans,
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
    it('initializes with all default plans active', () => {
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
