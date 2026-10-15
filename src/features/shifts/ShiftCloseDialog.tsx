import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { CashDenominationCount } from '../../domain/models';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { cashCountTotal, demoDenominations, parseCashQuantity } from '../../demo/cashDenominations';
import { useDemo } from '../../demo/DemoProvider';
import { Button, Notice } from '../../shared/ui';
import './ShiftCloseDialog.css';

type CountMode = 'denominations' | 'manual';
type CloseDraft = Record<string, string>;
interface ShiftCloseDialogProps {
  isOpen: boolean;
  shiftId: string;
  shiftName: string;
  expectedCashMinor: number;
  expectedCashBreakdown?: { openingMinor: number; receiptsMinor: number; extrasMinor: number; expensesMinor: number };
  onClose: () => void;
  onSuccess: () => void;
}
interface CloseReview { countedCashMinor: number; expectedCashMinor: number; revision: number; denominations?: CashDenominationCount[] }

const initialDraft: CloseDraft = { mode: 'denominations', manualTotal: '', closingNotes: '' };
const countLabel = (value: number) => `${formatMoney(value)} MXN`;

export function ShiftCloseDialog({ isOpen, shiftId, shiftName, expectedCashMinor, expectedCashBreakdown = { openingMinor: 0, receiptsMinor: 0, extrasMinor: 0, expensesMinor: 0 }, onClose, onSuccess }: ShiftCloseDialogProps) {
  const demo = useDemo();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialized = useRef(false);
  const focused = useRef(false);
  const [draft, setDraft] = useState<CloseDraft | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [review, setReview] = useState<CloseReview | null>(null);
  const [formError, setFormError] = useState('');
  const mode: CountMode = draft?.mode === 'manual' ? 'manual' : 'denominations';
  const counts = useMemo(() => demoDenominations.map(item => ({
    valueMinor: item.valueMinor,
    quantity: draft?.[`quantity-${item.valueMinor}`] === undefined ? 0 : parseCashQuantity(draft[`quantity-${item.valueMinor}`]) ?? Number.NaN,
  })), [draft]);
  const denominationTotal = cashCountTotal(counts);
  const manualTotal = draft ? parseMoney(draft.manualTotal ?? '') : null;
  const actualTotal = mode === 'manual' ? manualTotal : denominationTotal;
  const difference = actualTotal === null ? null : actualTotal - expectedCashMinor;
  const persistenceReady = demo.persistenceStatus === 'ready';
  const persistenceUnsafe = ['blocked', 'unavailable', 'recovery-required', 'error'].includes(demo.persistenceStatus);

  useEffect(() => {
    if (!isOpen || (!persistenceReady && demo.persistenceStatus !== 'error') || initialized.current) return;
    const existing = demo.getDraft(shiftId);
    if (!persistenceReady && !existing) return;
    const loaded = existing ? { ...initialDraft, ...existing } : { ...initialDraft };
    setDraft(loaded);
    initialized.current = true;
    if (existing) setDraftSaved(persistenceReady);
    else setDraftSaved(demo.saveDraft(shiftId, loaded));
  }, [demo, isOpen, persistenceReady, shiftId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog || dialog.open) return;
    dialog.showModal();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !dialogRef.current?.open || !draft || focused.current) return;
    const target = mode === 'manual' ? 'shift-counted' : `cash-${demoDenominations[0].valueMinor}`;
    document.getElementById(target)?.focus();
    focused.current = true;
  }, [draft, isOpen, mode]);

  useEffect(() => {
    if (isOpen) return;
    initialized.current = false;
    focused.current = false;
    setReview(null);
    setFormError('');
  }, [isOpen]);

  if (!isOpen) return null;

  function closeDialog() {
    if (dialogRef.current?.open) dialogRef.current.close();
    onClose();
  }

  function updateDraft(field: string, value: string) {
    if (!draft) return;
    const next = { ...draft, [field]: value };
    setDraft(next);
    setReview(null);
    setFormError('');
    setDraftSaved(demo.saveDraft(shiftId, next));
  }

  function retryDraftSave() {
    if (draft) setDraftSaved(demo.saveDraft(shiftId, draft));
  }

  function prepareReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    if (!persistenceReady || !draftSaved) {
      setFormError('Guarda el conteo antes de revisar el cierre.');
      return;
    }
    if (actualTotal === null) {
      setFormError(mode === 'manual'
        ? 'Escribe un importe válido, con hasta dos decimales.'
        : 'Revisa las cantidades: solo enteros no negativos dentro del límite permitido.');
      return;
    }
    setReview({ countedCashMinor: actualTotal, expectedCashMinor, revision: demo.state.revision,
      ...(mode === 'denominations' ? { denominations: counts } : {}) });
    setFormError('');
  }

  function confirmClose() {
    if (!review || !persistenceReady || !draftSaved) return;
    if (demo.state.revision !== review.revision) {
      setFormError('Los registros cambiaron. Revisa el cierre de nuevo.');
      setReview(null);
      return;
    }
    const result = demo.commitShiftClose({ shiftId, expectedRevision: review.revision, countedCashMinor: review.countedCashMinor,
      denominations: review.denominations, closingNotes: draft?.closingNotes });
    if (result.status === 'error') {
      setFormError(result.message ?? 'No se pudo registrar el cierre. El conteo permanece guardado para intentarlo de nuevo.');
      return;
    }
    if (dialogRef.current?.open) dialogRef.current.close();
    onSuccess();
  }

  const savedLabel = !persistenceReady
    ? persistenceUnsafe ? 'Guardado no disponible' : 'Conectando almacenamiento…'
    : draftSaved ? 'Guardado' : 'No se pudo guardar';
  const storageMessage = !persistenceReady
    ? demo.persistenceStatus === 'error'
      ? 'No se pudo guardar el conteo. ' + (demo.persistenceError ?? 'El cierre está deshabilitado.')
      : persistenceUnsafe ? demo.persistenceError ?? 'No es seguro guardar en esta pestaña. El cierre está deshabilitado.' : 'Esperando acceso al almacenamiento seguro.'
    : !draftSaved ? 'No se pudo guardar el conteo. ' + (demo.persistenceError ?? 'El cierre está deshabilitado.') : '';

  return <dialog ref={dialogRef} className="shift-close-dialog" aria-labelledby="shift-close-title"
    onCancel={event => { event.preventDefault(); closeDialog(); }} onClick={event => { if (event.target === event.currentTarget) event.preventDefault(); }}>
    <div className="shift-close-shell">
      <header className="shift-close-header">
        <div><p className="shift-close-eyebrow">CIERRE DE TURNO · {shiftName}</p><h2 id="shift-close-title">Cerrar turno · {shiftName}</h2>
          <p className="shift-close-subtitle">Captura el efectivo contado y revisa la diferencia antes de confirmar.</p></div>
        <button className="shift-close-x" type="button" aria-label="Cerrar diálogo" onClick={closeDialog}>×</button>
      </header>
      <div className="shift-close-scroll">
        {storageMessage && <div role="alert"><Notice tone="error">{storageMessage}</Notice>{draft && demo.persistenceStatus === 'error' &&
          <Button type="button" variant="secondary" onClick={retryDraftSave}>Reintentar guardado</Button>}</div>}
        {!draft ? <p role="status">Preparando conteo seguro…</p> : <form noValidate onSubmit={prepareReview}>
          <div className="shift-close-grid">
            <section className="shift-close-count-card" aria-labelledby="shift-close-count-heading">
              <div className="shift-close-card-heading"><div><p className="shift-close-eyebrow">PASO 1</p><h3 id="shift-close-count-heading">Conteo de efectivo</h3></div>
                <span className={`shift-close-save ${draftSaved && persistenceReady ? 'is-saved' : 'is-unsaved'}`} role="status" aria-live="polite">{savedLabel}</span></div>
              <div className="shift-close-mode field"><label htmlFor="cash-count-mode">Forma de conteo</label><select id="cash-count-mode" value={mode} onChange={event => updateDraft('mode', event.target.value)}>
                <option value="denominations">Billetes y monedas</option><option value="manual">Total manual</option></select></div>
              {mode === 'denominations' ? <>
                <Notice tone="warning">Cada casilla vacía cuenta como cero.</Notice>
                <div className="shift-close-denominations">{demoDenominations.map(item => {
                  const raw = draft[`quantity-${item.valueMinor}`] ?? '';
                  const quantity = parseCashQuantity(raw);
                  const subtotal = quantity === null ? null : cashCountTotal([{ valueMinor: item.valueMinor, quantity }]);
                  const id = `cash-${item.valueMinor}`;
                  return <div className="shift-close-denomination" key={item.valueMinor}><label htmlFor={id}>{item.kind} {formatMoney(item.valueMinor)} · cantidad</label>
                    <input id={id} inputMode="numeric" type="text" value={raw} aria-invalid={quantity === null}
                      onChange={event => updateDraft(`quantity-${item.valueMinor}`, event.target.value)} />
                    <span className="shift-close-subtotal">{subtotal === null ? 'Revisar cantidad' : `Subtotal ${countLabel(subtotal)}`}</span></div>;
                })}</div>
              </> : <div className="shift-close-manual field"><label htmlFor="shift-counted">Efectivo contado (MXN)</label>
                <input id="shift-counted" inputMode="decimal" type="text" value={draft.manualTotal ?? ''} onChange={event => updateDraft('manualTotal', event.target.value)} /></div>}
              <div className="shift-close-notes field"><label htmlFor="shift-closing-notes">Observaciones del cierre</label>
                <textarea id="shift-closing-notes" rows={3} value={draft.closingNotes ?? ''} onChange={event => updateDraft('closingNotes', event.target.value)} /></div>
              <div className="shift-close-actions"><Button type="submit" disabled={!persistenceReady || !draftSaved}>Revisar cierre</Button>
                <Button type="button" variant="secondary" onClick={closeDialog}>Volver al turno</Button></div>
            </section>
            <aside className="shift-close-summary" role="region" aria-label={review ? 'Resumen de revisión' : 'Resumen del conteo'} aria-live="polite">
              <p className="shift-close-eyebrow">PASO 2 · REVISIÓN</p><h3>{review ? 'Confirma los importes' : 'Resumen del cierre'}</h3>
              <dl><div><dt>Efectivo esperado</dt><dd>{countLabel(review?.expectedCashMinor ?? expectedCashMinor)}</dd></div>
                <div><dt>Efectivo contado</dt><dd>{countLabel(review?.countedCashMinor ?? actualTotal ?? 0)}</dd></div>
                <div className="shift-close-difference"><dt>Diferencia</dt><dd>{countLabel(review ? review.countedCashMinor - review.expectedCashMinor : difference ?? 0)}</dd></div></dl>
              <details className="shift-close-breakdown"><summary>Desglose del efectivo esperado</summary>
                <dl><div><dt>Fondo inicial</dt><dd>{countLabel(expectedCashBreakdown.openingMinor)}</dd></div>
                  <div><dt>Efectivo cobrado</dt><dd>{countLabel(expectedCashBreakdown.receiptsMinor)}</dd></div>
                  <div><dt>Extras</dt><dd>{countLabel(expectedCashBreakdown.extrasMinor)}</dd></div>
                  <div><dt>Gastos</dt><dd>−{countLabel(expectedCashBreakdown.expensesMinor)}</dd></div></dl>
                <p>Fondo + efectivo cobrado + Extras − Gastos</p>
              </details>
              <Notice tone="warning">El cierre registra la diferencia observada y conserva el balance de la operación.</Notice>
              {review && <div className="shift-close-actions shift-close-review-actions"><Button type="button" disabled={!persistenceReady || !draftSaved} onClick={confirmClose}>Confirmar cierre</Button>
                <Button type="button" variant="secondary" onClick={() => { setReview(null); setFormError(''); }}>Volver al conteo</Button></div>}
              {formError && <div role="alert"><Notice tone="error">{formError}</Notice></div>}
            </aside>
          </div>
        </form>}
      </div>
      <footer className="shift-close-footer"><span>El borrador queda ligado a este turno y a esta instalación.</span><span>Solo el conteo guardado puede confirmarse.</span></footer>
    </div>
  </dialog>;
}
