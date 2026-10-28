import type { Plan } from '../demo/plans';
import type { PlanService } from '../domain/models';

export type CatalogRequest = (path: string, init?: RequestInit) => Promise<Response>;
export interface CatalogService { id: string; code: string; name: string; status: string }
export interface CatalogPlanVersion {
  id?: string; plan_id?: string; version_number?: number; name: string; price_minor: number; currency: string;
  reference_amount_minor: number | null; duration_value: number | null; duration_unit: 'day' | 'month' | 'year' | null;
  entitlement_mode: 'period' | 'single_entry'; eligibility_type: string | null;
  restriction_notes: string | null; is_active?: boolean; services: { service_id: string; service_code?: string; service_name?: string; session_limit: number | null }[];
}
export interface CatalogPlan {
  id: string; code: string; name: string; kind: 'membership' | 'visit'; status: string;
  current_version: CatalogPlanVersion | null; versions: CatalogPlanVersion[];
}
const TERMS_PREFIX = 'evogym-plan-terms:v1:';
type PlanTerms = { applicability: string; restriction: string; conditionNotes: string; eligibility: PlanCompositionEligibility; expiryRule: 'calendar' | 'pending' };
type PlanCompositionEligibility = NonNullable<Plan['composition']>['conditions']['eligibility'];
const eligibilities: PlanCompositionEligibility[] = ['general', 'student', 'kids', 'legacy', 'custom'];

async function call<T>(request: CatalogRequest, path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' ? (body as Record<string, unknown>).detail : body;
    const message = typeof detail === 'string' ? detail
      : detail && typeof detail === 'object' && typeof (detail as Record<string, unknown>).message === 'string' ? (detail as Record<string, unknown>).message as string
        : `No se pudo completar la solicitud al catálogo (${response.status}).`;
    throw new Error(message);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
export const listCatalogPlans = (request: CatalogRequest) => call<CatalogPlan[]>(request, '/api/v1/catalog/plans');
export const getCatalogPlan = (request: CatalogRequest, id: string) => call<CatalogPlan>(request, `/api/v1/catalog/plans/${encodeURIComponent(id)}`);
export const listCatalogServices = (request: CatalogRequest) => call<CatalogService[]>(request, '/api/v1/catalog/services');

function serviceIds(services: PlanService[], catalog: CatalogService[]) {
  return services.map(code => {
    const match = catalog.find(item => item.code === code && item.status === 'active');
    if (!match) throw new Error(`El servicio ${code} falta del catálogo o está inactivo.`);
    return { service_id: match.id, session_limit: null };
  });
}
function terms(notes: string | null, eligibility: string | null): PlanTerms {
  const defaults: PlanTerms = { applicability: '', restriction: '', conditionNotes: '', eligibility: eligibilities.includes(eligibility as PlanCompositionEligibility) ? eligibility as PlanCompositionEligibility : 'general', expiryRule: 'pending' };
  if (!notes?.startsWith(TERMS_PREFIX)) return { ...defaults, applicability: notes ?? '' };
  try {
    const value: unknown = JSON.parse(notes.slice(TERMS_PREFIX.length));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plan terms.');
    const data = value as Record<string, unknown>;
    return {
      applicability: typeof data.applicability === 'string' ? data.applicability : notes,
      restriction: typeof data.restriction === 'string' ? data.restriction : '',
      conditionNotes: typeof data.conditionNotes === 'string' ? data.conditionNotes : '',
      eligibility: eligibilities.includes(data.eligibility as PlanCompositionEligibility) ? data.eligibility as PlanCompositionEligibility : defaults.eligibility,
      expiryRule: data.expiryRule === 'calendar' ? 'calendar' : 'pending',
    };
  } catch { return { ...defaults, applicability: notes }; }
}
function serviceCode(link: CatalogPlanVersion['services'][number], catalog: CatalogService[]): PlanService | null {
  const code = link.service_code || catalog.find(item => item.id === link.service_id)?.code;
  return code === 'gym' || code === 'box' || code === 'box-kids' ? code : null;
}
export function toOwnerPlan(plan: CatalogPlan, catalogServices: CatalogService[]): Plan & { _raw: CatalogPlan } {
  const version = plan.current_version;
  const details = terms(version?.restriction_notes ?? null, version?.eligibility_type ?? null);
  const services: PlanService[] = version?.services.flatMap(link => { const service = serviceCode(link, catalogServices); return service ? [service] : []; }) ?? [];
  const unit = version?.entitlement_mode === 'single_entry' ? 'session' : version?.duration_unit ?? 'month';
  const value = version?.entitlement_mode === 'single_entry' ? 1 : version?.duration_unit === 'day' && version.duration_value === 7 ? 1 : version?.duration_value ?? 1;
  const displayUnit = version?.duration_unit === 'day' && version.duration_value === 7 ? 'week' : unit;
  return {
    id: plan.id, name: plan.name, amountMinor: version?.price_minor ?? 0,
    referenceAmountMinor: version?.reference_amount_minor ?? undefined,
    applicability: details.applicability, restriction: details.restriction || undefined,
    kind: plan.kind, active: plan.status === 'active',
    composition: version ? { services, serviceStatus: 'confirmed', period: { value, unit: displayUnit, expiryRule: details.expiryRule }, conditions: { eligibility: details.eligibility, notes: details.conditionNotes } } : undefined,
    _raw: plan,
  };
}

function canonical(value: CatalogPlanVersion) {
  return JSON.stringify({ name: value.name, price_minor: value.price_minor, currency: value.currency,
    reference_amount_minor: value.reference_amount_minor, duration_value: value.duration_value, duration_unit: value.duration_unit,
    entitlement_mode: value.entitlement_mode, eligibility_type: value.eligibility_type, restriction_notes: value.restriction_notes,
    services: [...value.services].map(link => ({ service_id: link.service_id, session_limit: link.session_limit })).sort((a, b) => a.service_id.localeCompare(b.service_id)) });
}
function assertRepresentable(current: CatalogPlanVersion, services: CatalogService[]) {
  if (current.currency !== 'MXN') throw new Error('Este plan usa una moneda no compatible; no se puede editar sin alterar sus términos.');
  if (current.is_active === false) throw new Error('La versión vigente está inactiva y no se puede editar desde este formulario.');
  if (current.eligibility_type !== null && !eligibilities.includes(current.eligibility_type as PlanCompositionEligibility)) throw new Error('La elegibilidad de la versión vigente no es compatible con este editor; no se modificó.');
  if (current.services.some(link => !serviceCode(link, services) || link.session_limit !== null)) throw new Error('El plan contiene servicios o límites no compatibles con este editor; no se modificó.');
}
function makeVersion(plan: Omit<Plan, 'id'>, services: CatalogService[], current?: CatalogPlanVersion, originalPlanName?: string): CatalogPlanVersion {
  const composition = plan.composition!;
  if (composition.period.unit === 'session' && composition.period.value !== 1) throw new Error('Una muestra o visita debe representar una sola entrada.');
  if (plan.kind === 'visit' && composition.period.unit !== 'session') throw new Error('Los pases por visita deben representar una sola entrada.');
  const single = composition.period.unit === 'session';
  const durationUnit = composition.period.unit === 'week' ? 'day' : composition.period.unit;
  const durationValue = composition.period.unit === 'week' ? composition.period.value * 7 : composition.period.value;
  const legacyNotesUnchanged = Boolean(current && !current.restriction_notes?.startsWith(TERMS_PREFIX)
    && plan.applicability === (current.restriction_notes ?? '') && !plan.restriction
    && !composition.conditions.notes && composition.conditions.eligibility === (current.eligibility_type ?? 'general'));
  const restrictionNotes = legacyNotesUnchanged ? current!.restriction_notes : TERMS_PREFIX + JSON.stringify({
    applicability: plan.applicability, restriction: plan.restriction ?? '', conditionNotes: composition.conditions.notes,
    eligibility: composition.conditions.eligibility, expiryRule: composition.period.expiryRule,
  });
  return {
    name: current && originalPlanName === plan.name ? current.name : plan.name, price_minor: plan.amountMinor, currency: 'MXN',
    reference_amount_minor: current?.reference_amount_minor === null && plan.referenceAmountMinor === plan.amountMinor ? null : plan.referenceAmountMinor ?? null,
    duration_value: single ? null : durationValue,
    duration_unit: single ? null : durationUnit === 'session' ? null : durationUnit,
    entitlement_mode: single ? 'single_entry' : 'period',
    eligibility_type: current?.eligibility_type === null && composition.conditions.eligibility === 'general' ? null : composition.conditions.eligibility,
    restriction_notes: restrictionNotes,
    services: serviceIds(composition.services, services),
  };
}
function matchingCreated(plan: CatalogPlan, input: CatalogPlanVersion, name: string, kind: CatalogPlan['kind']) {
  return plan.name === name && plan.kind === kind && plan.status === 'active' && plan.current_version?.is_active === true
    && canonical(plan.current_version) === canonical(input);
}

export async function saveCatalogPlan(request: CatalogRequest, input: Omit<Plan, 'id'>, services: CatalogService[], existing?: CatalogPlan, code?: string): Promise<void> {
  const composition = input.composition;
  if (!composition || composition.serviceStatus !== 'confirmed' || !composition.services.length) throw new Error('Selecciona al menos un servicio activo antes de guardar.');
  if (composition.period.unit === 'session' && composition.period.value !== 1) throw new Error('Una muestra o visita debe representar una sola entrada.');
  if (input.kind === 'visit' && composition.period.unit !== 'session') throw new Error('Los pases por visita deben representar una sola entrada.');
  if (existing && input.kind !== existing.kind) throw new Error('No se puede cambiar el tipo de un plan guardado.');
  const currentPlan = existing ? await getCatalogPlan(request, existing.id) : undefined;
  const current = currentPlan?.current_version;
  if (current) assertRepresentable(current, services);
  if (currentPlan?.status === 'archived') throw new Error('Los planes archivados no se pueden editar desde este formulario.');
  const version = makeVersion(input, services, current ?? undefined, currentPlan?.name);
  if (!currentPlan) {
    const createCode = code ?? `plan-${crypto.randomUUID().replaceAll('-', '')}`;
    const findCreated = async () => (await listCatalogPlans(request)).find(plan => plan.code === createCode);
    const prior = await findCreated();
    if (prior) {
      if (prior.current_version && matchingCreated(prior, version, input.name, input.kind)) return;
      throw new Error('Ya existe un plan con el código de esta publicación; verifica el catálogo antes de reintentar.');
    }
    try {
      await call(request, '/api/v1/catalog/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: createCode, name: input.name, kind: input.kind, initial_version: version }) });
    } catch (error) {
      try {
        const created = await findCreated();
        if (created?.current_version && matchingCreated(created, version, input.name, input.kind)) return;
      } catch { /* Keep the original failure; the stable code enables a safe lookup on retry. */ }
      throw error;
    }
    return;
  }
  const changed = !current || canonical(current) !== canonical(version);
  if (changed) await call(request, `/api/v1/catalog/plans/${currentPlan.id}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(version) });
  if (input.name !== currentPlan.name || (input.active ? 'active' : 'inactive') !== currentPlan.status) {
    try {
      await call(request, `/api/v1/catalog/plans/${currentPlan.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.name, status: input.active ? 'active' : 'inactive' }) });
    } catch (error) {
      if (changed) throw new Error(`Los términos se publicaron, pero no se pudo actualizar el nombre o estado. Reintentar no duplicará la versión. ${error instanceof Error ? error.message : ''}`);
      throw error;
    }
  }
}

export async function updateCatalogPlanStatus(request: CatalogRequest, id: string, active: boolean) {
  await call(request, `/api/v1/catalog/plans/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: active ? 'active' : 'inactive' }) });
}
