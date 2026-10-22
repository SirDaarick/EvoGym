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

  return (
    <dialog
      ref={dialogRef}
      className="shift-close-dialog"
      aria-labelledby="shift-close-title"
      onCancel={event => { event.preventDefault(); closeDialog(); }}
      onClick={event => { if (event.target === event.currentTarget) event.preventDefault(); }}
    >
      <div className="shift-close-shell">
        <header className="shift-close-header">
          <h2 id="shift-close-title">Cerrar turno · {shiftName}</h2>
          <button className="shift-close-x" type="button" aria-label="Cerrar diálogo" onClick={closeDialog}>×</button>
        </header>

        <div className="shift-close-scroll">
          {storageMessage && (
            <div role="alert" className="shift-close-storage-alert">
              <Notice tone="error">{storageMessage}</Notice>
              {draft && demo.persistenceStatus === 'error' && (
                <Button type="button" variant="secondary" onClick={retryDraftSave}>
                  Reintentar guardado
                </Button>
              )}
              {isBlocked && (
                <div className="shift-close-blocked-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={async () => {
                      const ok = await demo.retryPersistence({ force: true });
                      if (ok && draft) {
                        setDraftSaved(demo.saveDraft(shiftId, draft));
                      }
                    }}
                  >
                    Tomar control de esta pestaña
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={async () => {
                      const ok = await demo.retryPersistence({ force: false });
                      if (ok && draft) {
                        setDraftSaved(demo.saveDraft(shiftId, draft));
                      }
                    }}
                  >
                    Reintentar
                  </Button>
                </div>
              )}
            </div>
          )}

          {!draft ? (
            <p role="status">Preparando conteo seguro…</p>
          ) : (
            <form noValidate onSubmit={prepareReview}>
              <div className="shift-close-grid">
                {/* LEFT COLUMN: Cash Count */}
                <section className="shift-close-count-card clay-card" aria-labelledby="shift-close-count-heading">
                  <div className="shift-close-card-heading">
                    <h3 id="shift-close-count-heading">Conteo de efectivo</h3>
                    <span className={`shift-close-save ${draftSaved && persistenceReady ? 'is-saved' : 'is-unsaved'}`} role="status" aria-live="polite">
                      {savedLabel}
                    </span>
                  </div>

                  <div className="shift-close-controls-row">
                    <div className="shift-close-mode field">
                      <label htmlFor="cash-count-mode">Forma de conteo</label>
                      <select id="cash-count-mode" value={mode} onChange={event => updateDraft('mode', event.target.value)}>
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
                          onClick={() => setEntryMode(entryMode === 'amount' ? 'units' : 'amount')}
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
                            onClick={() => setEntryMode('amount')}
                          >
                            Por importe en dinero ($)
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={entryMode === 'units'}
                            onClick={() => setEntryMode('units')}
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
                                decrement(item.valueMinor);
                              }}
                            >
                              <div
                                className="denomination-tile-btn"
                                onClick={() => increment(item.valueMinor)}
                                title="Clic: sumar (+1) · Clic derecho: restar (−1)"
                                role="button"
                                tabIndex={0}
                                aria-label={`Agregar 1 ${item.kind} de ${formatMoney(item.valueMinor)}`}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    increment(item.valueMinor);
                                  } else if (e.key === '-') {
                                    e.preventDefault();
                                    decrement(item.valueMinor);
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
                                    decrement(item.valueMinor);
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
                                    onChange={event => {
                                      const val = event.target.value;
                                      if (!draft) return;
                                      const next = { ...draft };
                                      if (entryMode === 'amount') {
                                        next[`amount-${item.valueMinor}`] = val;
                                        if (val.trim() === '') {
                                          next[`quantity-${item.valueMinor}`] = '0';
                                        } else {
                                          const parsed = parseMoney(val);
                                          if (parsed === null || parsed < 0) {
                                            next[`quantity-${item.valueMinor}`] = 'invalid';
                                          } else {
                                            const isMultiple = (parsed % item.valueMinor === 0);
                                            const q = Math.floor(parsed / item.valueMinor);
                                            next[`quantity-${item.valueMinor}`] = isMultiple ? q.toString() : 'invalid';
                                          }
                                        }
                                      } else {
                                        next[`quantity-${item.valueMinor}`] = val;
                                        const q = parseCashQuantity(val);
                                        if (q !== null) {
                                          next[`amount-${item.valueMinor}`] = q > 0 ? (q * item.valueMinor / 100).toString() : '';
                                        }
                                      }
                                      setDraft(next);
                                      setReview(null);
                                      setFormError('');
                                      setDraftSaved(demo.saveDraft(shiftId, next));
                                    }}
                                  />
                                </div>

                                <button
                                  type="button"
                                  className="denomination-step-btn"
                                  aria-label={`Sumar 1 ${item.kind} de ${formatMoney(item.valueMinor)}`}
                                  onClick={e => {
                                    e.stopPropagation();
                                    increment(item.valueMinor);
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
                        onChange={event => updateDraft('manualTotal', event.target.value)}
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
                        <div><dt>Fondo inicial</dt><dd>{countLabel(expectedCashBreakdown.openingMinor)}</dd></div>
                        <div><dt>Efectivo cobrado</dt><dd>{countLabel(expectedCashBreakdown.receiptsMinor)}</dd></div>
                        <div><dt>Extras</dt><dd>{countLabel(expectedCashBreakdown.extrasMinor)}</dd></div>
                        <div><dt>Gastos</dt><dd>−{countLabel(expectedCashBreakdown.expensesMinor)}</dd></div>
                      </dl>
                    </details>

                    {review && (
                      <div className="shift-close-actions shift-close-review-actions">
                        <Button type="button" disabled={!persistenceReady || !draftSaved} onClick={confirmClose}>
                          Confirmar cierre
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => { setReview(null); setFormError(''); }}>
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
                        onChange={event => updateDraft('closingNotes', event.target.value)}
                      />
                    </div>
                  </div>

                  {!review && (
                    <div className="shift-close-actions">
                      <Button type="submit" disabled={!persistenceReady || !draftSaved}>
                        Revisar cierre
                      </Button>
                      <Button type="button" variant="secondary" onClick={closeDialog}>
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
