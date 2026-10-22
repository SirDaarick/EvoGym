import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { formatMoney, parseMoney } from '../../demo/adapter';
import type { Plan } from '../../demo/plans';
import type { PlanComposition, PlanService } from '../../domain/models';
import { useIsDarkMode } from '../../shared/theme';
import { Button } from '../../shared/ui';
import Stepper, { Step } from '../catalog/react-bits/Stepper';

type PlanInput = Omit<Plan, 'id'>;
interface PlanEditorProps {
  plan?: Plan;
  onClose: () => void;
  onSave: (plan: PlanInput) => void;
}
const serviceOptions: { id: PlanService; label: string; detail: string }[] = [
  { id: 'gym', label: 'Gym', detail: 'Pesas y cardio' },
  { id: 'box', label: 'Box', detail: 'Entrenamiento de box' },
  { id: 'box-kids', label: 'Box Kids', detail: 'Modalidad infantil' },
];
const units: Record<PlanComposition['period']['unit'], string> = {
  day: 'Días', week: 'Semanas', month: 'Meses', year: 'Años', session: 'Sesiones',
};
const eligibilityLabels: Record<PlanComposition['conditions']['eligibility'], string> = {
  general: 'Público general', student: 'Estudiantes', kids: 'Box Kids', legacy: 'Tarifa anterior', custom: 'Condición particular',
};
const periodPresets: { label: string; value: number; unit: PlanComposition['period']['unit'] }[] = [
  { label: 'Semanal', value: 1, unit: 'week' },
  { label: '15 días', value: 15, unit: 'day' },
  { label: 'Mensual', value: 1, unit: 'month' },
  { label: 'Trimestral', value: 3, unit: 'month' },
  { label: 'Semestral', value: 6, unit: 'month' },
  { label: 'Anual', value: 1, unit: 'year' },
];

type PriceRatio = { numerator: bigint; denominator: bigint };
interface PricingDraft {
  reference: string;
  final: string;
  percentageDraft: string | null;
  ratio: PriceRatio | null;
  calculationInvalid: boolean;
}

// Percentages accept one decimal separator (dot or comma), not currency syntax.
function parsePercentage(value: string): PriceRatio | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized) || !Number.isFinite(Number(normalized)) || Number(normalized) <= 0) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return { numerator: BigInt(whole + fraction), denominator: 100n * 10n ** BigInt(fraction.length) };
}

function roundedMinor(reference: number, ratio: PriceRatio): number | null {
  const product = BigInt(reference) * ratio.numerator;
  const rounded = (2n * product + ratio.denominator) / (2n * ratio.denominator);
  return rounded > 0n && rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : null;
}

function displayedPercentage(final: number | null, reference: number | null): string {
  if (!final || !reference) return '';
  const denominator = BigInt(reference);
  let precision = 3;
  let scale = 1000n;
  const round = () => (2n * BigInt(final) * 100n * scale + denominator) / (2n * denominator);
  let scaled = round();
  while (scaled === 0n && precision < 18) {
    precision += 1;
    scale *= 10n;
    scaled = round();
  }
  const fraction = String(scaled % scale).padStart(precision, '0').replace(/0+$/, '');
  return `${scaled / scale}${fraction ? `.${fraction}` : ''}`;
}

function moneyDraft(minor: number): string {
  const cents = BigInt(minor);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
function initialPricing(plan?: Plan): PricingDraft {
  const reference = plan?.referenceAmountMinor ?? plan?.amountMinor;
  return {
    reference: reference === undefined ? '' : moneyDraft(reference),
    final: plan ? moneyDraft(plan.amountMinor) : '',
    percentageDraft: null,
    ratio: plan && reference ? { numerator: BigInt(plan.amountMinor), denominator: BigInt(reference) } : { numerator: 1n, denominator: 1n },
    calculationInvalid: false,
  };
}
function describePeriod(value: string, unit: PlanComposition['period']['unit']): string {
  const preset = periodPresets.find(item => String(item.value) === value && item.unit === unit);
  if (preset) return preset.label.toLocaleLowerCase('es-MX');
  const label = { day: 'días', week: 'semanas', month: 'meses', year: 'años', session: 'sesiones' }[unit];
  return `${value || '—'} ${label}`;
}

function isAvailableControl(element: HTMLElement): boolean {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  let parent = element.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement && !parent.open) {
      const summary = parent.querySelector(':scope > summary');
      if (!summary?.contains(element)) return false;
    }
    parent = parent.parentElement;
  }
  return true;
}

export function PlanEditor({ plan, onClose, onSave }: PlanEditorProps) {
  const prefix = useId();
  const dark = useIsDarkMode();
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<Plan['kind']>(plan?.kind ?? 'membership');
  const [pricing, setPricing] = useState(() => initialPricing(plan));
  const [nameDraft, setNameDraft] = useState(plan?.name ?? '');
  const [nameEdited, setNameEdited] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(plan?.applicability ?? '');
  const [descriptionEdited, setDescriptionEdited] = useState(false);
  const [restriction, setRestriction] = useState(plan?.restriction ?? '');
  const [services, setServices] = useState<PlanService[]>(plan?.composition?.services ?? (plan ? [] : ['gym']));
  const [pendingService, setPendingService] = useState(plan ? plan.composition?.serviceStatus !== 'confirmed' : false);
  const [periodValue, setPeriodValue] = useState(String(plan?.composition?.period.value ?? 1));
  const [periodUnit, setPeriodUnit] = useState<PlanComposition['period']['unit']>(plan?.composition?.period.unit ?? 'month');
  const [expiryRule, setExpiryRule] = useState<PlanComposition['period']['expiryRule']>(plan?.composition?.period.expiryRule ?? 'pending');
  const [customPeriod, setCustomPeriod] = useState(!periodPresets.some(item => item.value === (plan?.composition?.period.value ?? 1) && item.unit === (plan?.composition?.period.unit ?? 'month')));
  const [eligibility, setEligibility] = useState<PlanComposition['conditions']['eligibility']>(plan?.composition?.conditions.eligibility ?? 'general');
  const [notes, setNotes] = useState(plan?.composition?.conditions.notes ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(plan?.restriction || plan?.composition?.conditions.notes || (plan?.composition && plan.composition.conditions.eligibility !== 'general')));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const amountMinor = parseMoney(pricing.final);
  const referenceAmountMinor = parseMoney(pricing.reference);
  const percentage = pricing.percentageDraft ?? displayedPercentage(amountMinor, referenceAmountMinor);
  const serviceLabel = pendingService ? 'Actividad pendiente' : services.map(service => serviceOptions.find(option => option.id === service)!.label).join(' + ') || 'Sin servicios';
  const periodLabel = describePeriod(periodValue, periodUnit);
  const suggestedName = `${kind === 'visit' ? 'Visita · ' : ''}${serviceLabel} ${periodLabel}`;
  const name = nameEdited ? nameDraft : plan?.name ?? suggestedName;
  const description = descriptionEdited ? descriptionDraft : plan?.applicability ?? `${serviceLabel} · ${periodLabel}. Fechas efectivas pendientes.`;
  const id = (field: string) => `${prefix}-${field}`;
  const errorProps = (field: string) => ({ 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? id(`${field}-error`) : undefined });
  const error = (field: string) => errors[field] ? <p className="plan-editor-error" id={id(`${field}-error`)}>{errors[field]}</p> : null;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
    stepHeading.current?.focus({ preventScroll: true });
  }, [step]);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeRef.current();
      return;
    }
    if (event.key === 'Enter' && step < 3 && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      if (validate(step)) navigate(step + 1);
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialog.current!.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
    )).filter(isAvailableControl);
    if (!controls.length) return;
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
      : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    event.preventDefault();
    controls[next].focus();
  }

  function changeFinal(value: string) {
    setPricing(previous => {
      const final = parseMoney(value);
      const reference = parseMoney(previous.reference);
      return {
        ...previous, final: value, percentageDraft: null, calculationInvalid: false,
        ratio: final && reference ? { numerator: BigInt(final), denominator: BigInt(reference) } : null,
      };
    });
  }

  function changePercentage(value: string) {
    setPricing(previous => {
      const ratio = parsePercentage(value);
      const reference = parseMoney(previous.reference);
      const final = ratio && reference ? roundedMinor(reference, ratio) : null;
      return {
        ...previous, percentageDraft: value, ratio,
        final: ratio && reference ? (final === null ? '' : moneyDraft(final)) : previous.final,
        calculationInvalid: Boolean(ratio && reference && final === null),
      };
    });
  }

  function changeReference(value: string) {
    setPricing(previous => {
      const reference = parseMoney(value);
      if (!reference) return { ...previous, reference: value };
      if (!previous.ratio) {
        const final = parseMoney(previous.final);
        return {
          ...previous, reference: value,
          ratio: previous.percentageDraft === null && final ? { numerator: BigInt(final), denominator: BigInt(reference) } : null,
        };
      }
      const final = roundedMinor(reference, previous.ratio);
      return {
        ...previous, reference: value, final: final === null ? '' : moneyDraft(final),
        calculationInvalid: final === null,
      };
    });
  }
  function validate(target: number): boolean {
    const next: Record<string, string> = {};
    if (target === 1 && !services.length && !pendingService) next.services = 'Selecciona al menos un servicio o marca la actividad pendiente.';
    if (target === 2 && (!/^\d+$/.test(periodValue) || !Number.isSafeInteger(Number(periodValue)) || Number(periodValue) < 1)) next.period = 'Indica una cantidad entera mayor a cero.';
    if (target === 3) {
      if (referenceAmountMinor === null || referenceAmountMinor <= 0) next.reference = 'Ingresa una referencia mayor a cero, con hasta dos decimales y punto decimal.';
      if (!parsePercentage(percentage) || pricing.calculationInvalid) next.percentage = 'Ingresa un porcentaje mayor a cero que produzca un precio válido. Puede superar 100%.';
      if (amountMinor === null || amountMinor <= 0 || pricing.calculationInvalid) next.price = 'Ingresa un precio mayor a cero, con hasta dos decimales.';
      if (!name.trim()) next.name = 'Escribe el nombre del plan.';
      if (!description.trim()) next.description = 'Describe qué incluye el plan.';
    }
    setErrors(next);
    setSaveError('');
    if (!Object.keys(next).length) return true;
    if (next.description) setAdvancedOpen(true);
    const field = Object.keys(next)[0];
    // Wait for an optional disclosure to open before focusing its invalid field.
    requestAnimationFrame(() => document.getElementById(id(field === 'services' ? 'gym' : field))?.focus());
    return false;
  }

  function navigate(next: number) {
    if (next < 1 || next > 3 || next === step) return;
    if (next > step && !validate(step)) return;
    setErrors({});
    setSaveError('');
    setStep(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!validate(step)) return;
    if (step < 3) { navigate(step + 1); return; }
    const unresolved = pendingService || !services.length;
    const conditionRestriction = eligibility !== 'general' ? 'Elegibilidad pendiente de validar.' : undefined;
    try {
      onSave({
        name: nameEdited ? name.trim() : name,
        kind, amountMinor: amountMinor!, referenceAmountMinor: referenceAmountMinor!,
        applicability: descriptionEdited ? description.trim() : description,
        active: plan?.active ?? true,
        restriction: restriction || (unresolved ? 'Actividad pendiente de confirmar.' : conditionRestriction),
        sourceLabel: plan?.sourceLabel, legacy: plan?.legacy,
        composition: {
          services: [...services], serviceStatus: unresolved ? 'pending' : 'confirmed',
          period: { value: Number(periodValue), unit: periodUnit, expiryRule },
          conditions: { eligibility, notes },
        },
      });
      onClose();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : 'No se pudo guardar el plan. Inténtalo de nuevo.');
    }
  }

  function selectPreset(preset: typeof periodPresets[number]) {
    const unchanged = periodValue === String(preset.value) && periodUnit === preset.unit;
    setCustomPeriod(false);
    if (unchanged) return;
    setPeriodValue(String(preset.value));
    setPeriodUnit(preset.unit);
    setExpiryRule(preset.unit === 'month' || preset.unit === 'year' ? 'calendar' : 'pending');
    setErrors({});
  }

  return <dialog ref={dialog} className="plan-editor-dialog" aria-labelledby={id('title')} aria-describedby={id('intro')}
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={onKeyDown}>
    <form className="plan-editor-form" onSubmit={submit} noValidate>
      <header className="plan-editor-header">
        <div>
          <p className="eyebrow">CATÁLOGO · PLAN GUARDADO</p>
          <h2 id={id('title')}>{plan ? 'Editar plan' : 'Nuevo plan'}</h2>
          <p id={id('intro')} className="muted">Elige qué incluye, cuánto dura y su precio.</p>
        </div>
        <button type="button" className="plan-modal-close-btn" aria-label="Cerrar modal" onClick={onClose}>×</button>
      </header>
      <div className="plan-editor-progress">
        <Stepper step={step} onStepChange={navigate} linear disableStepIndicators transition="none"
          frame={false} showFooter={false} width="100%" accentColor="#FC6C06" theme={dark ? 'dark' : 'light'}
          className="plan-editor-stepper" aria-label="Configuración del plan">
          <Step title="Servicios" /><Step title="Duración" /><Step title="Precio y revisión" />
        </Stepper>
      </div>
      <div ref={body} className="plan-editor-body">
        {step === 1 ? <section className="plan-editor-section" aria-labelledby={id('step-title')}>
          <h3 ref={stepHeading} tabIndex={-1} id={id('step-title')}>¿Qué incluye el plan?</h3>
          <p className="muted plan-editor-help">Selecciona uno o varios servicios para guardarlos juntos.</p>
          <fieldset className="plan-editor-services" aria-describedby={errors.services ? id('services-error') : undefined}>
            <legend>Servicios incluidos</legend>
            <div className="plan-editor-service-grid">{serviceOptions.map(service => <label key={service.id} className={`plan-editor-service ${services.includes(service.id) ? 'is-selected' : ''}`}>
              <input id={id(service.id)} aria-label={service.label} type="checkbox" checked={services.includes(service.id)} onChange={event => setServices(previous => event.target.checked ? [...previous, service.id] : previous.filter(item => item !== service.id))} />
              <span><strong>{service.label}</strong><small>{service.detail}</small></span>
            </label>)}</div>{error('services')}
          </fieldset>
          <div className="field"><label htmlFor={id('kind')}>Tipo de acceso</label><select id={id('kind')} value={kind} onChange={event => setKind(event.target.value as Plan['kind'])}><option value="membership">Membresía</option><option value="visit">Pase por visita</option></select></div>
          <details className="plan-editor-details" open={pendingService || undefined}>
            <summary>¿La actividad todavía no está definida?</summary>
            <label className="plan-editor-check"><input type="checkbox" checked={pendingService} onChange={event => setPendingService(event.target.checked)} />Actividad pendiente de confirmar</label>
            {pendingService ? <p className="plan-editor-warning">Sin acceso inferido: confirma la actividad antes de ofrecer este plan.</p> : null}
          </details>
        </section> : step === 2 ? <section className="plan-editor-section" aria-labelledby={id('step-title')}>
          <h3 ref={stepHeading} tabIndex={-1} id={id('step-title')}>¿Cuánto dura?</h3>
          <p className="muted plan-editor-help">Elige un periodo habitual o conserva uno personalizado.</p>
          <div className="plan-editor-presets" role="group" aria-label="Periodos habituales">
            {periodPresets.map(preset => <button key={preset.label} type="button" aria-pressed={!customPeriod && periodValue === String(preset.value) && periodUnit === preset.unit} onClick={() => selectPreset(preset)}>{preset.label}</button>)}
            <button type="button" aria-pressed={customPeriod} onClick={() => setCustomPeriod(true)}>Personalizado</button>
          </div>
          {customPeriod ? <div className="plan-editor-grid">
            <div className="field"><label htmlFor={id('period')}>Cantidad del periodo</label><input id={id('period')} type="number" min="1" step="1" value={periodValue} onChange={event => setPeriodValue(event.target.value)} {...errorProps('period')} />{error('period')}</div>
            <div className="field"><label htmlFor={id('unit')}>Unidad del periodo</label><select id={id('unit')} value={periodUnit} onChange={event => { setPeriodUnit(event.target.value as typeof periodUnit); setExpiryRule('pending'); }}>{Object.entries(units).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          </div> : null}
          <p className="plan-editor-period-summary">Periodo seleccionado: <strong>{periodLabel}</strong></p>
          <details className="plan-editor-details">
            <summary>Ajustes de vencimiento</summary>
            <div className="field"><label htmlFor={id('expiry')}>Regla de vencimiento</label><select id={id('expiry')} value={expiryRule} onChange={event => setExpiryRule(event.target.value as typeof expiryRule)}><option value="pending">Pendiente de confirmar</option>{periodUnit === 'month' || periodUnit === 'year' ? <option value="calendar">Por calendario</option> : null}</select></div>
          </details>
          <small className="muted">No calcula fechas ni activa acceso automáticamente. Una semana no se convierte en 7 días.</small>
        </section> : <section className="plan-editor-section" aria-labelledby={id('step-title')}>
          <h3 ref={stepHeading} tabIndex={-1} id={id('step-title')}>Precio y revisión</h3>
          <fieldset className="plan-editor-pricing" aria-describedby={id('pricing-hint')}>
            <legend>Configura el precio</legend>
            <div className="field"><label htmlFor={id('reference')}>Precio de referencia (100%)</label><input id={id('reference')} inputMode="decimal" value={pricing.reference} onChange={event => changeReference(event.target.value)} placeholder="500.00" {...errorProps('reference')} />{error('reference')}</div>
            <p id={id('pricing-hint')} className="muted plan-editor-help">Define la referencia una vez. Cambiarla recalcula el precio final conservando la proporción. No se obtiene de sumar los servicios.</p>
            <div className="plan-editor-grid">
              <div className="field"><label htmlFor={id('percentage')}>Porcentaje a cobrar</label><div className="plan-editor-percentage"><input id={id('percentage')} inputMode="decimal" value={percentage} onChange={event => changePercentage(event.target.value)} aria-describedby={errors.percentage ? `${id('percentage-hint')} ${id('percentage-error')}` : id('percentage-hint')} aria-invalid={Boolean(errors.percentage)} /><span aria-hidden="true">%</span></div>{error('percentage')}</div>
              <div className="field"><label htmlFor={id('price')}>Precio MXN</label><input id={id('price')} inputMode="decimal" value={pricing.final} onChange={event => changeFinal(event.target.value)} placeholder="400.00" aria-describedby={errors.price ? `${id('final-hint')} ${id('price-error')}` : id('final-hint')} aria-invalid={Boolean(errors.price)} />{error('price')}<small id={id('final-hint')} className="muted">Precio final que se cobrará.</small></div>
            </div>
            <small id={id('percentage-hint')} className="muted">80% significa cobrar el 80% de la referencia, no descontar 80%. Puedes usar punto o coma decimal en el porcentaje. El importe se redondea a centavos.</small>
          </fieldset>
          <div className="field"><label htmlFor={id('name')}>Nombre del plan</label><input id={id('name')} value={name} onChange={event => { setNameDraft(event.target.value); setNameEdited(true); }} {...errorProps('name')} />{error('name')}<small className="muted">Puedes cambiar el nombre sugerido. Se conservará al volver a los pasos anteriores.</small></div>
          <dl className="plan-editor-review" aria-label="Resumen del plan">
            <div><dt>Servicios</dt><dd>{serviceLabel}</dd></div>
            <div><dt>Duración</dt><dd>{periodLabel}</dd></div>
            <div><dt>Dirigido a</dt><dd>{eligibilityLabels[eligibility]}</dd></div>
            <div><dt>Descripción</dt><dd>{description}</dd></div>
            {notes ? <div><dt>Condiciones</dt><dd>{notes}</dd></div> : null}
            {restriction ? <div><dt>Restricción</dt><dd>{restriction}</dd></div> : null}
            {pendingService ? <div><dt>Actividad</dt><dd>Pendiente de confirmar; no concede acceso.</dd></div> : null}
          </dl>
          <details className="plan-editor-details" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
            <summary>Descripción y condiciones (opcional)</summary>
            <div className="plan-editor-section">
              <div className="field"><label htmlFor={id('description')}>Descripción de aplicabilidad</label><textarea id={id('description')} rows={2} value={description} onChange={event => { setDescriptionDraft(event.target.value); setDescriptionEdited(true); }} {...errorProps('description')} />{error('description')}</div>
              <div className="field"><label htmlFor={id('eligibility')}>Dirigido a</label><select id={id('eligibility')} value={eligibility} onChange={event => setEligibility(event.target.value as typeof eligibility)}>{Object.entries(eligibilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
              <div className="field"><label htmlFor={id('notes')}>Condiciones del plan (opcional)</label><textarea id={id('notes')} rows={2} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Requisitos y límites; no aplica descuentos automáticamente." /></div>
              <div className="field"><label htmlFor={id('restriction')}>Restricción u observación (opcional)</label><input id={id('restriction')} value={restriction} onChange={event => setRestriction(event.target.value)} /><small className="muted">Una restricción mantiene pendiente su validación para el cobro.</small></div>
            </div>
          </details>
          <aside className="plan-editor-history"><strong>Lo ya contratado no cambia</strong><p>Los cambios aplican a nuevas compras. Las anteriores conservan nombre, precio y condiciones registrados. Una renovación es una compra nueva; no garantiza la tarifa anterior.</p></aside>
          {saveError ? <p role="alert" className="plan-editor-error">{saveError}</p> : null}
        </section>}
      </div>
      <footer className="plan-editor-footer">
        <div className="plan-editor-total"><small>{step === 3 ? 'Precio del plan' : `Paso ${step} de 3`}</small><strong>{step === 3 ? <>{amountMinor !== null ? formatMoney(amountMinor) : '—'} <span>MXN</span></> : serviceLabel}</strong></div>
        <div className="plan-editor-buttons">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          {step > 1 ? <Button type="button" variant="secondary" onClick={() => navigate(step - 1)}>Atrás</Button> : null}
          <Button type="submit">{step < 3 ? 'Continuar' : plan ? 'Guardar cambios' : 'Guardar plan'}</Button>
        </div>
      </footer>
    </form>
  </dialog>;
}
