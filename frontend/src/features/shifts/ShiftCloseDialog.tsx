import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import type { CashDenominationCount } from '../../domain/models';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { cashCountTotal, demoDenominations, parseCashQuantity } from '../../demo/cashDenominations';
import { useDemo } from '../../demo/DemoProvider';
import { Button, Notice } from '../../shared/ui';
import { closeShift as closeApiShift, getShift } from '../../api/shiftsApi';
import type { ApiRequest } from '../../api/shiftsApi';
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

interface ApiShiftCloseDialogProps {
  isOpen: boolean;
  shiftId: string;
  shiftName: string;
  expectedCashMinor: number;
  expectedCashBreakdown?: { openingMinor?: number; receiptsMinor?: number; extrasMinor?: number; expensesMinor?: number };
  apiRequest: ApiRequest;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}

interface CloseDialogViewProps {
  isOpen: boolean;
  shiftName: string;
  expectedCashMinor: number;
  expectedCashBreakdown?: { openingMinor?: number; receiptsMinor?: number; extrasMinor?: number; expensesMinor?: number };
  dialogRef: RefObject<HTMLDialogElement | null>;
  draft: CloseDraft | null;
  mode: CountMode;
  entryMode: 'units' | 'amount';
  counts: CashDenominationCount[];
  actualTotal: number | null;
  difference: number | null;
  review: Pick<CloseReview, 'countedCashMinor' | 'expectedCashMinor'> | null;
  formError: string;
  draftSaved: boolean;
  savedLabel: string;
  canSubmit: boolean;
  storageNotice?: ReactNode;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateDraft: (field: string, value: string) => void;
  onSetEntryMode: (mode: 'units' | 'amount') => void;
  onChangeDenomination: (valueMinor: number, value: string, mode: 'units' | 'amount') => void;
  onIncrement: (valueMinor: number) => void;
  onDecrement: (valueMinor: number) => void;
  onConfirm: () => void;
  onBackToCount: () => void;
}

const initialDraft: CloseDraft = { mode: 'denominations', manualTotal: '', closingNotes: '', entryMode: 'units' };
const countLabel = (value: number) => `${formatMoney(value)} MXN`;

export const billColors: Record<number, string> = {
  100000: '#0d9488', // $1,000 Teal
  50000: '#2563eb',  // $500 Blue
  20000: '#16a34a',  // $200 Green
  10000: '#dc2626',  // $100 Red
  5000: '#c026d3',   // $50 Magenta
  2000: '#4f46e5',   // $20 Indigo
};

export function BillIcon({ value, color }: { value: string; color: string }) {
  return (
    <svg className="cash-bill-svg" viewBox="0 0 38 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="1" y="1" width="36" height="20" rx="3.5" fill="currentColor" fillOpacity="0.05" stroke={color} strokeWidth="1.5" />
      <circle cx="19" cy="11" r="5" stroke={color} strokeWidth="1" strokeDasharray="2 1.5" opacity="0.5" />
      <text x="19" y="13.5" textAnchor="middle" fill={color} fontSize="7" fontWeight="750" fontFamily="system-ui, -apple-system, sans-serif">
        {value}
      </text>
    </svg>
  );
}

export function CoinIcon({ value, isBimetallic = true }: { value: string; isBimetallic?: boolean }) {
  return (
    <svg className="cash-coin-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="10.5" fill="currentColor" fillOpacity="0.05" stroke="#d97706" strokeWidth="1.5" />
      {isBimetallic && (
        <circle cx="12" cy="12" r="6.5" stroke="#9ca3af" strokeWidth="1" strokeDasharray="1.5 1.5" opacity="0.7" />
      )}
      <text x="12" y="14.5" textAnchor="middle" fill="var(--color-ink)" fontSize="7" fontWeight="800" fontFamily="system-ui, -apple-system, sans-serif">
        {value}
      </text>
    </svg>
  );
}

export function ShiftCloseDialog(props: ShiftCloseDialogProps | ApiShiftCloseDialogProps) {
  if ('apiRequest' in props) return <ApiShiftCloseDialog {...props} />;
  return <DemoShiftCloseDialog {...props} />;
}

function ApiShiftCloseDialog({ isOpen, shiftId, shiftName, expectedCashMinor, expectedCashBreakdown, apiRequest, onClose, onSuccess }: ApiShiftCloseDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<CloseDraft>({ ...initialDraft });
  const [review, setReview] = useState<CloseReview | null>(null);
  const [formError, setFormError] = useState('');
  const mode: CountMode = draft.mode === 'manual' ? 'manual' : 'denominations';
  const entryMode: 'units' | 'amount' = draft.entryMode === 'amount' ? 'amount' : 'units';
  const counts = useMemo(() => demoDenominations.map(item => ({
    valueMinor: item.valueMinor,
    quantity: draft[`quantity-${item.valueMinor}`] === undefined ? 0 : parseCashQuantity(draft[`quantity-${item.valueMinor}`]) ?? Number.NaN,
  })), [draft]);
  const manualTotal = parseMoney(draft.manualTotal ?? '');
  const actualTotal = mode === 'manual' ? manualTotal : cashCountTotal(counts);
  const difference = actualTotal === null ? null : actualTotal - expectedCashMinor;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open) dialog.showModal();
  }, [isOpen]);

  function closeDialog() {
    if (dialogRef.current?.open) dialogRef.current.close();
    onClose();
  }

  function updateDraft(field: string, value: string) {
    setDraft(current => ({ ...current, [field]: value }));
    setReview(null);
    setFormError('');
  }

  function setEntryMode(nextMode: 'units' | 'amount') {
    setDraft(current => {
      const next: CloseDraft = { ...current, entryMode: nextMode };
      for (const item of demoDenominations) {
        const quantity = parseCashQuantity(current[`quantity-${item.valueMinor}`] ?? '0') ?? 0;
        next[`quantity-${item.valueMinor}`] = quantity.toString();
        next[`amount-${item.valueMinor}`] = quantity > 0 ? (quantity * item.valueMinor / 100).toString() : '';
      }
      return next;
    });
    setReview(null);
    setFormError('');
  }

  function changeDenomination(valueMinor: number, value: string, currentMode: 'units' | 'amount') {
    setDraft(current => {
      const next = { ...current };
      if (currentMode === 'amount') {
        next[`amount-${valueMinor}`] = value;
        if (value.trim() === '') next[`quantity-${valueMinor}`] = '0';
        else {
          const parsed = parseMoney(value);
          next[`quantity-${valueMinor}`] = parsed !== null && parsed >= 0 && parsed % valueMinor === 0 ? String(parsed / valueMinor) : 'invalid';
        }
      } else {
        next[`quantity-${valueMinor}`] = value;
        const quantity = parseCashQuantity(value);
        if (quantity !== null) next[`amount-${valueMinor}`] = quantity > 0 ? (quantity * valueMinor / 100).toString() : '';
      }
      return next;
    });
    setReview(null);
    setFormError('');
  }

  function updateDenominationQuantity(valueMinor: number, quantity: number) {
    const value = Math.max(0, quantity).toString();
    setDraft(current => ({ ...current, [`quantity-${valueMinor}`]: value, [`amount-${valueMinor}`]: Number(value) > 0 ? (Number(value) * valueMinor / 100).toString() : '' }));
    setReview(null);
    setFormError('');
  }

  function increment(valueMinor: number) {
    const currentValue = counts.find(item => item.valueMinor === valueMinor)?.quantity ?? 0;
    updateDenominationQuantity(valueMinor, (Number.isNaN(currentValue) ? 0 : currentValue) + 1);
  }

  function decrement(valueMinor: number) {
    const currentValue = counts.find(item => item.valueMinor === valueMinor)?.quantity ?? 0;
    updateDenominationQuantity(valueMinor, (Number.isNaN(currentValue) ? 0 : currentValue) - 1);
  }

  function prepareReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actualTotal === null || !Number.isSafeInteger(actualTotal) || actualTotal < 0) {
      setFormError(mode === 'manual' ? 'Escribe un importe válido, con hasta dos decimales.' : 'Revisa las cantidades: solo enteros no negativos dentro del límite permitido.');
      return;
    }
    setReview({ countedCashMinor: actualTotal, expectedCashMinor, revision: 0, ...(mode === 'denominations' ? { denominations: counts } : {}) });
    setFormError('');
  }

  async function confirmClose() {
    if (!review) return;
    const notes = draft.closingNotes?.trim() ?? '';
    try {
      const closed = await closeApiShift(apiRequest, shiftId, {
        ...(review.denominations ? { denomination_counts: review.denominations.map(row => ({ denomination_minor: row.valueMinor, quantity: row.quantity })) } : { counted_cash_minor: review.countedCashMinor }),
        ...(notes ? { closing_notes: notes } : {}),
      });
      if (closed.status !== 'closed') throw new Error('El servidor no confirmó el cierre.');
      if (dialogRef.current?.open) dialogRef.current.close();
      await onSuccess();
    } catch (reason) {
      try {
        const current = await getShift(apiRequest, shiftId);
        const sameCounts = review.denominations
          ? current.closing_denomination_counts.length === review.denominations.length
            && review.denominations.every(row => current.closing_denomination_counts.some(saved => saved.denomination_minor === row.valueMinor && saved.quantity === row.quantity))
          : current.closing_denomination_counts.length === 0;
        if (current.status === 'closed' && current.counted_cash_minor === review.countedCashMinor && current.closing_notes === (notes || null) && sameCounts) {
          if (dialogRef.current?.open) dialogRef.current.close();
          await onSuccess();
          return;
        }
      } catch { /* Keep the submitted values available for an identical retry. */ }
      setFormError(reason instanceof Error ? reason.message : 'No se pudo confirmar el cierre. El conteo permanece disponible para reintentar.');
    }
  }

  return <ShiftCloseDialogView isOpen={isOpen} shiftName={shiftName} expectedCashMinor={expectedCashMinor} expectedCashBreakdown={expectedCashBreakdown}
    dialogRef={dialogRef} draft={draft} mode={mode} entryMode={entryMode} counts={counts} actualTotal={actualTotal} difference={difference} review={review}
    formError={formError} draftSaved={false} savedLabel="Pendiente de registrar" canSubmit={true} onClose={closeDialog} onSubmit={prepareReview}
    onUpdateDraft={updateDraft} onSetEntryMode={setEntryMode} onChangeDenomination={changeDenomination} onIncrement={increment} onDecrement={decrement}
    onConfirm={() => void confirmClose()} onBackToCount={() => { setReview(null); setFormError(''); }} />;
}

function DemoShiftCloseDialog({ isOpen, shiftId, shiftName, expectedCashMinor, expectedCashBreakdown = { openingMinor: 0, receiptsMinor: 0, extrasMinor: 0, expensesMinor: 0 }, onClose, onSuccess }: ShiftCloseDialogProps) {
  const demo = useDemo();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialized = useRef(false);
  const focused = useRef(false);
  const [draft, setDraft] = useState<CloseDraft | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [review, setReview] = useState<CloseReview | null>(null);
  const [formError, setFormError] = useState('');
  const mode: CountMode = draft?.mode === 'manual' ? 'manual' : 'denominations';
  const entryMode: 'units' | 'amount' = draft?.entryMode === 'amount' ? 'amount' : 'units';

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

  function setEntryMode(nextMode: 'units' | 'amount') {
    if (!draft) return;
    const nextDraft: CloseDraft = { ...draft, entryMode: nextMode };
    for (const item of demoDenominations) {
      const q = parseCashQuantity(draft[`quantity-${item.valueMinor}`] ?? '0') ?? 0;
      nextDraft[`quantity-${item.valueMinor}`] = q.toString();
      nextDraft[`amount-${item.valueMinor}`] = q > 0 ? (q * item.valueMinor / 100).toString() : '';
    }
    setDraft(nextDraft);
    setDraftSaved(demo.saveDraft(shiftId, nextDraft));
  }

  function updateDenominationQuantity(valueMinor: number, quantity: number) {
    if (!draft) return;
    const qtyStr = quantity.toString();
    const amountStr = quantity > 0 ? (quantity * valueMinor / 100).toString() : '';
    const next = {
      ...draft,
      [`quantity-${valueMinor}`]: qtyStr,
      [`amount-${valueMinor}`]: amountStr,
    };
    setDraft(next);
    setReview(null);
    setFormError('');
    setDraftSaved(demo.saveDraft(shiftId, next));
  }

  function increment(valueMinor: number) {
    const currentVal = counts.find(c => c.valueMinor === valueMinor)?.quantity ?? 0;
    const nextQuantity = Math.max(0, (Number.isNaN(currentVal) ? 0 : currentVal) + 1);
    updateDenominationQuantity(valueMinor, nextQuantity);
  }

  function decrement(valueMinor: number) {
    const currentVal = counts.find(c => c.valueMinor === valueMinor)?.quantity ?? 0;
    const nextQuantity = Math.max(0, (Number.isNaN(currentVal) ? 0 : currentVal) - 1);
    updateDenominationQuantity(valueMinor, nextQuantity);
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

  const isBlocked = demo.persistenceStatus === 'blocked';
  const savedLabel = !persistenceReady
    ? persistenceUnsafe ? 'Guardado no disponible' : 'Conectando almacenamiento…'
    : draftSaved ? 'Guardado' : 'No se pudo guardar';
  const storageMessage = !persistenceReady
    ? demo.persistenceStatus === 'error'
      ? 'No se pudo guardar el conteo. ' + (demo.persistenceError ?? 'El cierre está deshabilitado.')
      : isBlocked
        ? 'Otra pestaña de EvoGym tiene el control del almacenamiento. Cierra las otras pestañas o toma el control aquí para guardar y cerrar el turno.'
        : persistenceUnsafe
          ? demo.persistenceError ?? 'No es seguro guardar en esta pestaña. El cierre está deshabilitado.'
          : 'Esperando acceso al almacenamiento seguro.'
    : !draftSaved
      ? 'No se pudo guardar el conteo. ' + (demo.persistenceError ?? 'El cierre está deshabilitado.')
      : '';

  return <ShiftCloseDialogView
    isOpen={isOpen} shiftName={shiftName} expectedCashMinor={expectedCashMinor} expectedCashBreakdown={expectedCashBreakdown}
    dialogRef={dialogRef} draft={draft} mode={mode} entryMode={entryMode} counts={counts} actualTotal={actualTotal} difference={difference}
    review={review} formError={formError} draftSaved={draftSaved} savedLabel={savedLabel} canSubmit={persistenceReady && draftSaved}
    storageNotice={storageMessage ? <div role="alert" className="shift-close-storage-alert"><Notice tone="error">{storageMessage}</Notice>{draft && demo.persistenceStatus === 'error' && <Button type="button" variant="secondary" onClick={retryDraftSave}>Reintentar guardado</Button>}{isBlocked && <div className="shift-close-blocked-actions"><Button type="button" variant="secondary" onClick={async () => { const ok = await demo.retryPersistence({ force: true }); if (ok && draft) setDraftSaved(demo.saveDraft(shiftId, draft)); }}>Tomar control de esta pestaña</Button><Button type="button" variant="secondary" onClick={async () => { const ok = await demo.retryPersistence({ force: false }); if (ok && draft) setDraftSaved(demo.saveDraft(shiftId, draft)); }}>Reintentar</Button></div>}</div> : null}
    onClose={closeDialog} onSubmit={prepareReview} onUpdateDraft={updateDraft} onSetEntryMode={setEntryMode}
    onChangeDenomination={(valueMinor: number, value: string, currentMode: 'units' | 'amount') => {
      if (!draft) return;
      const next = { ...draft };
      if (currentMode === 'amount') {
        next[`amount-${valueMinor}`] = value;
        if (value.trim() === '') next[`quantity-${valueMinor}`] = '0';
        else {
          const parsed = parseMoney(value);
          if (parsed === null || parsed < 0) next[`quantity-${valueMinor}`] = 'invalid';
          else next[`quantity-${valueMinor}`] = parsed % valueMinor === 0 ? String(parsed / valueMinor) : 'invalid';
        }
      } else {
        next[`quantity-${valueMinor}`] = value;
        const quantity = parseCashQuantity(value);
        if (quantity !== null) next[`amount-${valueMinor}`] = quantity > 0 ? (quantity * valueMinor / 100).toString() : '';
      }
      setDraft(next); setReview(null); setFormError(''); setDraftSaved(demo.saveDraft(shiftId, next));
    }}
    onIncrement={increment} onDecrement={decrement} onConfirm={confirmClose} onBackToCount={() => { setReview(null); setFormError(''); }}
  />;
}


function ShiftCloseDialogView({ isOpen, shiftName, expectedCashMinor, expectedCashBreakdown, dialogRef, draft, mode, entryMode, counts, actualTotal, difference, review, formError, draftSaved, savedLabel, canSubmit, storageNotice, onClose, onSubmit, onUpdateDraft, onSetEntryMode, onChangeDenomination, onIncrement, onDecrement, onConfirm, onBackToCount }: CloseDialogViewProps) {
  if (!isOpen) return null;
  return (
    <dialog
      ref={dialogRef}
      className="shift-close-dialog"
      aria-labelledby="shift-close-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) event.preventDefault(); }}
    >
      <div className="shift-close-shell">
        <header className="shift-close-header">
          <h2 id="shift-close-title">Cerrar turno · {shiftName}</h2>
          <button className="shift-close-x" type="button" aria-label="Cerrar diálogo" onClick={onClose}>×</button>
        </header>

        <div className="shift-close-scroll">
          {storageNotice}

          {!draft ? (
            <p role="status">Preparando conteo seguro…</p>
          ) : (
            <form noValidate onSubmit={onSubmit}>
              <div className="shift-close-grid">
                {/* LEFT COLUMN: Cash Count */}
                <section className="shift-close-count-card clay-card" aria-labelledby="shift-close-count-heading">
                  <div className="shift-close-card-heading">
                    <h3 id="shift-close-count-heading">Conteo de efectivo</h3>
                    <span className={`shift-close-save ${draftSaved ? 'is-saved' : 'is-unsaved'}`} role="status" aria-live="polite">
                      {savedLabel}
                    </span>
                  </div>

                  <div className="shift-close-controls-row">
                    <div className="shift-close-mode field">
                      <label htmlFor="cash-count-mode">Forma de conteo</label>
                      <select id="cash-count-mode" value={mode} onChange={event => onUpdateDraft('mode', event.target.value)}>
                        <option value="denominations">Billetes y monedas</option>
                        <option value="manual">Total manual</option>
                      </select>
                    </div>

                    {mode === 'denominations' && (
                      <div className="shift-count-switch-wrap">
                        <span className={`switch-caption ${entryMode === 'units' ? 'is-active' : ''}`}>Piezas (#)</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={entryMode === 'amount'}
                          aria-label="Cambiar entre conteo por piezas o por importe en dinero"
                          className={`shift-clay-switch ${entryMode === 'amount' ? 'is-checked' : ''}`}
                          onClick={() => onSetEntryMode(entryMode === 'amount' ? 'units' : 'amount')}
                        >
                          <span className="switch-thumb" />
                        </button>
                        <span className={`switch-caption ${entryMode === 'amount' ? 'is-active' : ''}`}>Importe ($)</span>

                        {/* Accessible radio buttons for test and AT compatibility */}
                        <div className="sr-only" role="radiogroup" aria-label="Modo de captura de desglose">
                          <button
                            type="button"
                            role="radio"
                            aria-checked={entryMode === 'amount'}
                            onClick={() => onSetEntryMode('amount')}
                          >
                            Por importe en dinero ($)
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={entryMode === 'units'}
                            onClick={() => onSetEntryMode('units')}
                          >
                            Por piezas / unidades
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {mode === 'denominations' ? (
                    <div className="shift-close-denominations">
                        {demoDenominations.map(item => {
                          const isBill = item.kind === 'Billete';
                          const qty = parseCashQuantity(draft[`quantity-${item.valueMinor}`] ?? '0') ?? 0;
                          const rawQty = draft[`quantity-${item.valueMinor}`] ?? '';
                          const rawAmount = draft[`amount-${item.valueMinor}`] ?? (qty > 0 ? (qty * item.valueMinor / 100).toString() : '');
                          const parsedQty = parseCashQuantity(rawQty);
                          const isInvalid = entryMode === 'units' ? parsedQty === null : (draft[`quantity-${item.valueMinor}`] === 'invalid');
                          const subtotal = Number.isNaN(parsedQty) || parsedQty === null ? null : qty * item.valueMinor;
                          const id = `cash-${item.valueMinor}`;
                          const billColor = billColors[item.valueMinor] ?? '#FC6C06';
                          const coinValueStr = item.valueMinor === 50 ? '50¢' : (item.valueMinor / 100).toString();

                          return (
                            <div
                              key={item.valueMinor}
                              className={`shift-close-denomination ${qty > 0 ? 'is-active' : ''}`}
                              onContextMenu={e => {
                                e.preventDefault();
                                onDecrement(item.valueMinor);
                              }}
                            >
                              <div
                                className="denomination-tile-btn"
                                onClick={() => onIncrement(item.valueMinor)}
                                title="Clic: sumar (+1) · Clic derecho: restar (−1)"
                                role="button"
                                tabIndex={0}
                                aria-label={`Agregar 1 ${item.kind} de ${formatMoney(item.valueMinor)}`}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onIncrement(item.valueMinor);
                                  } else if (e.key === '-') {
                                    e.preventDefault();
                                    onDecrement(item.valueMinor);
                                  }
                                }}
                              >
                                <div className="denomination-badge-visual">
                                  {isBill ? (
                                    <BillIcon value={formatMoney(item.valueMinor).replace('$', '').replace('.00', '')} color={billColor} />
                                  ) : (
                                    <CoinIcon value={coinValueStr} isBimetallic={item.valueMinor !== 50} />
                                  )}
                                </div>

                                <div className="denomination-meta">
                                  <label htmlFor={id} className="denomination-label">
                                    <span className="denomination-label-text" data-amount={formatMoney(item.valueMinor)}>
                                      {item.kind} {formatMoney(item.valueMinor)} · {entryMode === 'amount' ? 'importe ($)' : 'cantidad'}
                                    </span>
                                  </label>
                                </div>

                                {qty > 0 && (
                                  <span className="denomination-qty-badge" data-count={qty}>
                                    {qty} {isBill ? (qty === 1 ? 'billete' : 'billetes') : (qty === 1 ? 'moneda' : 'monedas')}
                                  </span>
                                )}
                              </div>

                              <div className="denomination-input-controls">
                                <button
                                  type="button"
                                  className="denomination-step-btn"
                                  aria-label={`Restar 1 ${item.kind} de ${formatMoney(item.valueMinor)}`}
                                  disabled={qty <= 0}
                                  onClick={e => {
                                    e.stopPropagation();
                                    onDecrement(item.valueMinor);
                                  }}
                                >
                                  −
                                </button>

                                <div className="denomination-input-wrap">
                                  {entryMode === 'amount' && <span className="input-currency-prefix">$</span>}
                                  <input
                                    id={id}
                                    inputMode={entryMode === 'amount' ? 'decimal' : 'numeric'}
                                    type="text"
                                    value={entryMode === 'amount' ? rawAmount : rawQty}
                                    aria-invalid={isInvalid}
                                    placeholder={entryMode === 'amount' ? '0.00' : '0'}
                                    onChange={event => onChangeDenomination(item.valueMinor, event.target.value, entryMode)}
                                  />
                                </div>

                                <button
                                  type="button"
                                  className="denomination-step-btn"
                                  aria-label={`Sumar 1 ${item.kind} de ${formatMoney(item.valueMinor)}`}
                                  onClick={e => {
                                    e.stopPropagation();
                                    onIncrement(item.valueMinor);
                                  }}
                                >
                                  +
                                </button>
                              </div>

                              <span className="shift-close-subtotal">
                                {isInvalid
                                  ? (entryMode === 'amount' ? `Múltiplo de ${formatMoney(item.valueMinor)}` : 'Inválido')
                                  : subtotal === null || subtotal === 0
                                    ? ''
                                    : `Subtotal ${countLabel(subtotal)}`}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                  ) : (
                    <div className="shift-close-manual field">
                      <label htmlFor="shift-counted">Efectivo contado (MXN)</label>
                      <input
                        id="shift-counted"
                        inputMode="decimal"
                        type="text"
                        value={draft.manualTotal ?? ''}
                        onChange={event => onUpdateDraft('manualTotal', event.target.value)}
                      />
                    </div>
                  )}
                </section>

                {/* RIGHT COLUMN: Summary + Observaciones + Actions */}
                <aside className="shift-close-summary-column" aria-label="Resumen y observaciones del cierre">
                  <div className="shift-close-summary clay-card" role="region" aria-label={review ? 'Resumen de revisión' : 'Resumen del conteo'} aria-live="polite">
                    <h3>{review ? 'Confirma los importes' : 'Resumen del cierre'}</h3>
                    <dl>
                      <div>
                        <dt>Efectivo esperado</dt>
                        <dd>{countLabel(review?.expectedCashMinor ?? expectedCashMinor)}</dd>
                      </div>
                      <div>
                        <dt>Efectivo contado</dt>
                        <dd>{countLabel(review?.countedCashMinor ?? actualTotal ?? 0)}</dd>
                      </div>
                      <div className="shift-close-difference">
                        <dt>Diferencia</dt>
                        <dd className={difference !== null && difference < 0 ? 'is-negative' : 'is-positive'}>
                          {countLabel(review ? review.countedCashMinor - review.expectedCashMinor : difference ?? 0)}
                        </dd>
                      </div>
                    </dl>
                    <details className="shift-close-breakdown">
                      <summary>Desglose del efectivo esperado</summary>
                      <dl>
                        <div><dt>Fondo inicial</dt><dd>{(expectedCashBreakdown?.openingMinor == null ? 'Sin registrar' : countLabel(expectedCashBreakdown.openingMinor))}</dd></div>
                        <div><dt>Efectivo cobrado</dt><dd>{(expectedCashBreakdown?.receiptsMinor == null ? 'Sin registrar' : countLabel(expectedCashBreakdown.receiptsMinor))}</dd></div>
                        <div><dt>Extras</dt><dd>{(expectedCashBreakdown?.extrasMinor == null ? 'Sin registrar' : countLabel(expectedCashBreakdown.extrasMinor))}</dd></div>
                        <div><dt>Gastos</dt><dd>{expectedCashBreakdown?.expensesMinor == null ? 'Sin registrar' : `−${countLabel(expectedCashBreakdown.expensesMinor)}`}</dd></div>
                      </dl>
                    </details>

                    {review && (
                      <div className="shift-close-actions shift-close-review-actions">
                        <Button type="button" disabled={!canSubmit} onClick={onConfirm}>
                          Confirmar cierre
                        </Button>
                        <Button type="button" variant="secondary" onClick={onBackToCount}>
                          Volver al conteo
                        </Button>
                      </div>
                    )}
                    {formError && <div role="alert"><Notice tone="error">{formError}</Notice></div>}
                  </div>

                  {/* OBSERVACIONES DEL CIERRE */}
                  <div className="shift-close-notes-card clay-card">
                    <div className="shift-close-notes field">
                      <label htmlFor="shift-closing-notes">Observaciones del cierre</label>
                      <textarea
                        id="shift-closing-notes"
                        rows={2}
                        placeholder="Observaciones o arqueo..."
                        value={draft.closingNotes ?? ''}
                        onChange={event => onUpdateDraft('closingNotes', event.target.value)}
                      />
                    </div>
                  </div>

                  {!review && (
                    <div className="shift-close-actions">
                      <Button type="submit" disabled={!canSubmit}>
                        Revisar cierre
                      </Button>
                      <Button type="button" variant="secondary" onClick={onClose}>
                        Volver al turno
                      </Button>
                    </div>
                  )}
                </aside>
              </div>
            </form>
          )}
        </div>
      </div>
    </dialog>
  );
}
