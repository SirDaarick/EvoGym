import { useEffect, useState } from 'react';

export interface Plan {
  id: string;
  name: string;
  amountMinor: number;
  applicability: string;
  restriction?: string;
  kind: 'membership' | 'visit';
  active?: boolean;
}

// Prices confirmed by the owner interview; eligibility is not inferred from a name or age.
export const INITIAL_PLANS: Plan[] = [
  { id: 'gym-month', name: 'Gym mensual', amountMinor: 50000, applicability: 'Una área: Gym. Mensual por fechas de calendario.', kind: 'membership', active: true },
  { id: 'box-month', name: 'Box mensual', amountMinor: 50000, applicability: 'Una área: Box. Mensual por fechas de calendario.', kind: 'membership', active: true },
  { id: 'combo-month', name: 'Gym + Box mensual', amountMinor: 75000, applicability: 'Ambas áreas. Mensual por fechas de calendario.', kind: 'membership', active: true },
  ...(['gym', 'box'] as const).flatMap(area => [
    { id: `${area}-student`, name: `${area === 'gym' ? 'Gym' : 'Box'} estudiante`, amountMinor: 40000, applicability: 'Estudiante; una sola área.', restriction: 'Validación de estudiante pendiente.', kind: 'membership' as const, active: true },
    { id: `${area}-quarter`, name: `${area === 'gym' ? 'Gym' : 'Box'} trimestral`, amountMinor: 120000, applicability: 'Individual; una sola área. Trimestre.', kind: 'membership' as const, active: true },
    { id: `${area}-semester`, name: `${area === 'gym' ? 'Gym' : 'Box'} semestral`, amountMinor: 230000, applicability: 'Individual; una sola área. Semestre.', kind: 'membership' as const, active: true },
    { id: `${area}-annual`, name: `${area === 'gym' ? 'Gym' : 'Box'} anual`, amountMinor: 450000, applicability: 'Individual; una sola área. Año.', kind: 'membership' as const, active: true },
  ]),
  { id: 'box-scholarship', name: 'Box beca', amountMinor: 35000, applicability: 'Solo beca seleccionada por el entrenador de Box; no es una tarifa general.', restriction: 'Selección del entrenador no validada.', kind: 'membership', active: true },
  { id: 'box-kids', name: 'Box kids', amountMinor: 35000, applicability: 'Niños de 5 a 9 años.', restriction: 'Elegibilidad de edad no validada.', kind: 'membership', active: true },
  { id: 'gym-week', name: 'Gym semana', amountMinor: 15000, applicability: 'Gym; 8 días. Fechas efectivas pendientes.', kind: 'membership', active: true },
  { id: 'trial-class', name: 'Clase muestra', amountMinor: 10000, applicability: 'Clase muestra; una sesión.', kind: 'membership', active: true },
  { id: 'visit-single', name: 'Visita una área', amountMinor: 5000, applicability: 'Gym o Box; una visita.', kind: 'visit', active: true },
  { id: 'visit-combo', name: 'Visita Gym + Box', amountMinor: 10000, applicability: 'Ambas áreas; una visita.', kind: 'visit', active: true },
];

const STORAGE_KEY = 'evogym_plan_catalog';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage || window.sessionStorage || null;
  } catch {
    return null;
  }
}

function loadPersistedPlans(): Plan[] {
  const storage = getStorage();
  if (!storage) return INITIAL_PLANS.map(p => ({ ...p }));
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_PLANS.map(p => ({ ...p }));
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return INITIAL_PLANS.map(p => ({ ...p }));
    return parsed;
  } catch {
    return INITIAL_PLANS.map(p => ({ ...p }));
  }
}

let currentPlans: Plan[] = loadPersistedPlans();

// Static array export for backward compatibility
export const plans: Plan[] = [...currentPlans];

const listeners = new Set<() => void>();

function syncPlansArray(): void {
  plans.length = 0;
  plans.push(...currentPlans);
}

function notify(): void {
  syncPlansArray();
  listeners.forEach(fn => fn());
}

function persist(): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(currentPlans));
    } catch {
      // Storage unavailable or quota exceeded
    }
  }
}

export function getPlanList(): Plan[] {
  return currentPlans.map(p => ({ ...p }));
}

export function getActivePlans(): Plan[] {
  return currentPlans.filter(p => p.active !== false).map(p => ({ ...p }));
}

export function savePlan(plan: Omit<Plan, 'id'> & { id?: string }): Plan {
  const id = plan.id && plan.id.trim() ? plan.id.trim() : `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const existingIndex = currentPlans.findIndex(p => p.id === id);
  const saved: Plan = {
    ...plan,
    id,
    active: plan.active ?? true,
  };

  if (existingIndex >= 0) {
    currentPlans = [
      ...currentPlans.slice(0, existingIndex),
      saved,
      ...currentPlans.slice(existingIndex + 1),
    ];
  } else {
    currentPlans = [...currentPlans, saved];
  }

  persist();
  notify();
  return { ...saved };
}

export function updatePlan(id: string, updates: Partial<Plan>): Plan | undefined {
  const index = currentPlans.findIndex(p => p.id === id);
  if (index === -1) return undefined;

  const existing = currentPlans[index];
  const updated: Plan = {
    ...existing,
    ...updates,
    id, // Keep ID unchanged
  };

  currentPlans = [
    ...currentPlans.slice(0, index),
    updated,
    ...currentPlans.slice(index + 1),
  ];

  persist();
  notify();
  return { ...updated };
}

export function togglePlanActive(id: string): Plan | undefined {
  const plan = currentPlans.find(p => p.id === id);
  if (!plan) return undefined;
  return updatePlan(id, { active: plan.active === false ? true : false });
}

export function resetPlans(): void {
  currentPlans = INITIAL_PLANS.map(p => ({ ...p }));
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable
    }
  }
  notify();
}

export function subscribePlans(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePlans(): Plan[] {
  const [items, setItems] = useState<Plan[]>(getPlanList);

  useEffect(() => {
    return subscribePlans(() => {
      setItems(getPlanList());
    });
  }, []);

  return items;
}

export function useActivePlans(): Plan[] {
  const [items, setItems] = useState<Plan[]>(getActivePlans);

  useEffect(() => {
    return subscribePlans(() => {
      setItems(getActivePlans());
    });
  }, []);

  return items;
}
