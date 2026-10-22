import { useEffect, useState } from 'react';
import type { PlanComposition, PlanService, PurchasedPlanSnapshot } from '../domain/models';

export interface Plan {
  id: string;
  name: string;
  amountMinor: number;
  referenceAmountMinor?: number;
  applicability: string;
  restriction?: string;
  kind: 'membership' | 'visit';
  active?: boolean;
  revision?: number;
  composition?: PlanComposition;
  sourceLabel?: string;
  legacy?: boolean;
}

const LEGACY_PLANS: Plan[] = [
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



const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const membership = (
  id: string, name: string, amountMinor: number, sourceLabel: string, services: PlanService[],
  value = 1, unit: PlanComposition['period']['unit'] = 'month',
  eligibility: PlanComposition['conditions']['eligibility'] = 'general', restriction?: string,
): Plan => ({
  id, name, amountMinor, sourceLabel, kind: 'membership', active: true, revision: 1,
  applicability: `${services.length ? services.map(service => service === 'box-kids' ? 'Box Kids' : service === 'gym' ? 'Gym' : 'Box').join(' + ') : 'Actividad pendiente de confirmar'} · ${value} ${unit === 'month' ? 'mes(es)' : unit === 'year' ? 'año(s)' : unit === 'day' ? 'día(s)' : 'semana(s)'}. Fechas efectivas pendientes.`,
  restriction,
  composition: {
    services, serviceStatus: services.length ? 'confirmed' : 'pending',
    period: { value, unit, expiryRule: unit === 'month' || unit === 'year' ? 'calendar' : 'pending' },
    conditions: { eligibility, notes: restriction ?? '' },
  },
});

// Operative workbook: BITACORA!AN5:AO25. Locker is not a membership.
export const INITIAL_PLANS: Plan[] = [
  membership('gym-month', 'Gym mensual', 50000, 'GYM', ['gym']),
  membership('box-month', 'Box mensual', 50000, 'BOX', ['box']),
  membership('combo-month-old', 'Gym + Box mensual · tarifa anterior', 65000, 'GYM Y BOX (Viejo)', ['gym', 'box'], 1, 'month', 'legacy', 'Elegibilidad de tarifa anterior pendiente; no concede renovación automática.'),
  membership('combo-month', 'Gym + Box mensual', 75000, 'GYM Y BOX (Nuevo)', ['gym', 'box']),
  membership('gym-student', 'Gym estudiante', 40000, 'GYM ESTUDIANTES', ['gym'], 1, 'month', 'student', 'Validación de estudiante pendiente.'),
  membership('box-student', 'Box estudiante', 40000, 'BOX ESTUDIANTES', ['box'], 1, 'month', 'student', 'Validación de estudiante pendiente.'),
  membership('gym-week', 'Gym semana', 15000, 'SEMANA GYM', ['gym'], 8, 'day'),
  membership('box-week', 'Box semana', 15000, 'SEMANA BOX', ['box'], 1, 'week'),
  membership('combo-week', 'Gym + Box semana', 20000, 'SEMANA GYB', ['gym', 'box'], 1, 'week'),
  membership('custom-fortnight', '15 días · actividad por confirmar', 25000, '15 DIAS', [], 15, 'day', 'custom', 'Actividad y reglas de vigencia pendientes de confirmar.'),
  ...(['gym', 'box', 'combo'] as const).flatMap(area => {
    const label = area === 'gym' ? 'Gym' : area === 'box' ? 'Box' : 'Gym + Box';
    const source = area === 'combo' ? 'GYB' : area.toUpperCase();
    const services: PlanService[] = area === 'combo' ? ['gym', 'box'] : [area];
    return [
      membership(`${area}-quarter`, `${label} trimestral`, area === 'combo' ? 175000 : 120000, `3 MESES ${source}`, services, 3),
      membership(`${area}-semester`, `${label} semestral`, area === 'combo' ? 330000 : 250000, `6 MESES ${source}`, services, 6),
      membership(`${area}-annual`, `${label} anual`, area === 'combo' ? 610000 : 450000, `ANUALIDAD ${source}`, services, 1, 'year'),
    ];
  }),
  { ...membership('box-kids', 'Box kids', 35000, 'BOX KIDS', ['box-kids'], 1, 'month', 'kids', 'Elegibilidad de edad no validada.'), applicability: 'Niños de 5 a 9 años (nota previa no validada). Fechas efectivas pendientes.' },
  ...LEGACY_PLANS.filter(plan => ['box-scholarship', 'trial-class'].includes(plan.id)).map(plan => ({ ...plan, legacy: true, revision: 1 })),
  ...LEGACY_PLANS.filter(plan => plan.kind === 'visit').map(plan => ({ ...plan, revision: 1 })),
];

const STORAGE_KEY = 'evogym_plan_catalog';
const STORAGE_VERSION = 2;
let storageIssue = '';
let migrationNotice = '';

function getStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

function isComposition(value: unknown): value is PlanComposition {
  if (!value || typeof value !== 'object') return false;
  const c = value as PlanComposition;
  return Array.isArray(c.services) && c.services.every(service => ['gym', 'box', 'box-kids'].includes(service))
    && new Set(c.services).size === c.services.length
    && ['confirmed', 'pending'].includes(c.serviceStatus)
    && (c.serviceStatus !== 'confirmed' || c.services.length > 0)
    && Boolean(c.period) && Number.isSafeInteger(c.period.value) && c.period.value > 0
    && ['day', 'week', 'month', 'year', 'session'].includes(c.period.unit)
    && ['calendar', 'pending'].includes(c.period.expiryRule)
    && Boolean(c.conditions) && ['general', 'student', 'kids', 'legacy', 'custom'].includes(c.conditions.eligibility)
    && typeof c.conditions.notes === 'string';
}

function isPlan(value: unknown): value is Plan {
  if (!value || typeof value !== 'object') return false;
  const p = value as Plan;
  return typeof p.id === 'string' && Boolean(p.id.trim()) && typeof p.name === 'string' && Boolean(p.name.trim())
    && Number.isSafeInteger(p.amountMinor) && p.amountMinor > 0
    && (p.referenceAmountMinor === undefined || (Number.isSafeInteger(p.referenceAmountMinor) && p.referenceAmountMinor > 0))
    && typeof p.applicability === 'string' && Boolean(p.applicability.trim())
    && ['membership', 'visit'].includes(p.kind)
    && (p.active === undefined || typeof p.active === 'boolean')
    && (p.restriction === undefined || typeof p.restriction === 'string')
    && (p.revision === undefined || (Number.isSafeInteger(p.revision) && p.revision > 0))
    && (p.composition === undefined || isComposition(p.composition))
    && (p.sourceLabel === undefined || typeof p.sourceLabel === 'string');
}

function sameLegacySeed(plan: Plan, seed: Plan): boolean {
  return (['id', 'name', 'amountMinor', 'applicability', 'restriction', 'kind', 'active'] as const)
    .every(key => plan[key] === seed[key]) && plan.composition === undefined && plan.revision === undefined && plan.referenceAmountMinor === undefined;
}

function loadPersistedPlans(): Plan[] {
  storageIssue = '';
  migrationNotice = '';
  try {
    const storage = getStorage();
    if (!storage) throw new Error('storage');
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return clone(INITIAL_PLANS);
    const parsed: unknown = JSON.parse(raw);
    const legacy = Array.isArray(parsed);
    const envelope = parsed as { version?: number; plans?: unknown };
    const items: unknown = legacy ? parsed : envelope.version === STORAGE_VERSION ? envelope.plans : null;
    if (!Array.isArray(items) || !items.every(isPlan) || new Set(items.map(plan => plan.id)).size !== items.length) throw new Error('schema');
    if (!legacy) return clone(items);
    const preserved: string[] = [];
    const migrated = items.map(plan => {
      const previous = LEGACY_PLANS.find(seed => seed.id === plan.id);
      const current = INITIAL_PLANS.find(seed => seed.id === plan.id);
      if (previous && current && sameLegacySeed(plan, previous)) return clone(current);
      if (current) preserved.push(plan.name);
      return { ...clone(plan), revision: plan.revision ?? 1 };
    });
    for (const seed of INITIAL_PLANS) {
      if (!migrated.some(plan => plan.id === seed.id)) migrated.push(clone(seed));
    }
    if (preserved.length) migrationNotice = `Se conservaron ajustes previos sin reemplazar sus precios: ${preserved.join(', ')}. Revisa sus condiciones antes de vender.`;
    return migrated;
  } catch {
    storageIssue = 'No se pudo leer el catálogo guardado o su versión no es compatible. No se sobrescribirá: respalda y revisa los datos locales antes de guardar.';
    return clone(INITIAL_PLANS);
  }
}

let currentPlans = loadPersistedPlans();
// Compatibility readers receive detached data; writes go through the store.
export const plans: Plan[] = clone(currentPlans);
const listeners = new Set<() => void>();
function notify() {
  plans.splice(0, plans.length, ...clone(currentPlans));
  listeners.forEach(listener => listener());
}

function commit(next: Plan[]) {
  if (storageIssue) throw new Error(storageIssue);
  const storage = getStorage();
  if (!storage) throw new Error('No se puede guardar: el almacenamiento local no está disponible.');
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, plans: next })); }
  catch { throw new Error('No se pudo guardar el plan. Revisa el espacio y los permisos de almacenamiento e inténtalo de nuevo.'); }
  currentPlans = clone(next);
  notify();
}

export function getPlanStorageIssue() { return storageIssue || migrationNotice; }
export function getPlanList(): Plan[] { return clone(currentPlans); }
export function getActivePlans(): Plan[] { return clone(currentPlans.filter(plan => plan.active !== false)); }
export function reloadPlans(): void { currentPlans = loadPersistedPlans(); notify(); }
export function snapshotPlan(plan: Plan): PurchasedPlanSnapshot {
  return clone({ planId: plan.id, revision: plan.revision ?? 1, name: plan.name, amountMinor: plan.amountMinor, referenceAmountMinor: plan.referenceAmountMinor,
    applicability: plan.applicability, restriction: plan.restriction, composition: plan.composition });
}

export function savePlan(input: Omit<Plan, 'id'> & { id?: string }): Plan {
  const id = input.id?.trim() || `plan-${crypto.randomUUID()}`;
  const previous = currentPlans.find(plan => plan.id === id);
  const saved: Plan = { ...clone(input), id, name: input.name.trim(), active: input.active ?? true, revision: (previous?.revision ?? 0) + 1 };
  if (!isPlan(saved)) throw new Error('Revisa nombre, precio, periodo y servicios del plan.');
  const next = previous ? currentPlans.map(plan => plan.id === id ? saved : plan) : [...currentPlans, saved];
  commit(next);
  return clone(saved);
}

export function updatePlan(id: string, updates: Partial<Plan>): Plan | undefined {
  const existing = currentPlans.find(plan => plan.id === id);
  return existing ? savePlan({ ...existing, ...updates, id }) : undefined;
}
export function togglePlanActive(id: string): Plan | undefined {
  const existing = currentPlans.find(plan => plan.id === id);
  return existing ? updatePlan(id, { active: existing.active === false }) : undefined;
}
export function resetPlans(): void {
  const storage = getStorage();
  if (storage) storage.removeItem(STORAGE_KEY);
  storageIssue = '';
  migrationNotice = '';
  currentPlans = clone(INITIAL_PLANS);
  notify();
}
export function subscribePlans(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function usePlans(): Plan[] {
  const [items, setItems] = useState(getPlanList);
  useEffect(() => subscribePlans(() => setItems(getPlanList())), []);
  return items;
}
export function useActivePlans(): Plan[] {
  const [items, setItems] = useState(getActivePlans);
  useEffect(() => subscribePlans(() => setItems(getActivePlans())), []);
  return items;
}
