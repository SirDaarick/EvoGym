import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { CashDenominationCount, DemoState, ShiftWindow } from '../../domain/models';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { cashCountTotal, demoDenominations, parseCashQuantity } from '../../demo/cashDenominations';
import { expectedStock } from '../../demo/inventoryOperations';
import { getSelectedStaff, getStaffList } from '../staff/staffStore';
import { Badge, Button, Notice } from '../../shared/ui';
import { BillIcon, CoinIcon, billColors } from './ShiftCloseDialog';
import './ShiftCloseDialog.css';
import './ShiftOpenModal.css';

export interface ShiftOpenConfirmData {
  window: ShiftWindow;
  openingCashMinor: number;
  cashDenominations?: CashDenominationCount[];
  responsibleStaffId?: string;
  responsibleStaffName?: string;
  stockAdjustments?: {
    productId: string;
    kind: 'waste' | 'restock';
    quantity: number;
    reason: string;
  }[];
  counts?: {
    productId: string;
    quantity: number;
    reason?: string;
  }[];
}

interface ShiftOpenModalProps {
  isOpen: boolean;
  state?: DemoState;
  liveInventory?: {
    products: { id: string; name: string; category?: string | null; expectedQuantity: number | null; initialized: boolean }[];
    window: ShiftWindow;
    openerName: string;
    registers?: { id: string; name: string }[];
    registerId?: string;
    onRegisterChange?: (registerId: string) => void;
  };
  onClose: () => void;
  onConfirm: (data: ShiftOpenConfirmData) => void | Promise<void>;
}

type CountMode = 'denominations' | 'manual';

const PRESET_WASTE_REASONS = [
  'Merma detectada al abrir',
  'Producto dañado / roto',
  'Caducidad',
  'Consumo previo no registrado',
  'Otro motivo',
];

export function ShiftOpenModal({ isOpen, state, liveInventory, onClose, onConfirm }: ShiftOpenModalProps) {
  const products = state?.products ?? liveInventory?.products ?? [];
  const expectedQuantity = (productId: string) => {
    if (state) return expectedStock(state, productId);
    return liveInventory?.products.find(item => item.id === productId)?.expectedQuantity ?? null;
  };
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submittingRef = useRef(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // General configuration
  const defaultWindow: ShiftWindow = new Date().getHours() < 14 ? '06:00–14:00' : '14:00–22:00';
  const [windowChoice, setWindowChoice] = useState<ShiftWindow>(liveInventory?.window ?? defaultWindow);
  
  const staffList = useMemo(() => getStaffList().filter(s => s.active), []);
  const initialStaff = getSelectedStaff();
  const [staffId, setStaffId] = useState<string>(() => {
    if (liveInventory) return '__authenticated_opener__';
    if (initialStaff && staffList.some(s => s.id === initialStaff.id)) return initialStaff.id;
    return staffList[0]?.id ?? '';
  });

  // Step 1: Cash count
  const [mode, setMode] = useState<CountMode>('denominations');
  const [entryMode, setEntryMode] = useState<'units' | 'amount'>('units');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [manualTotal, setManualTotal] = useState('');
  const [step1Error, setStep1Error] = useState('');

  // Step 2: Inventory verification
  const [inventorySearch, setInventorySearch] = useState('');
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, number | undefined>>({});
  const [wasteReasons, setWasteReasons] = useState<Record<string, string>>({});
  const [customReasons, setCustomReasons] = useState<Record<string, string>>({});

  // Reset or initialize when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setWindowChoice(liveInventory?.window ?? (new Date().getHours() < 14 ? '06:00–14:00' : '14:00–22:00'));
    setMode('denominations');
    setEntryMode('units');
    setQuantities({});
    setAmounts({});
    setManualTotal('');
    setStep1Error('');
    setInventorySearch('');
    
    // Initialize physical counts to match expected stock
    const initialCounts: Record<string, number> = {};
    const initialReasons: Record<string, string> = {};
    for (const prod of products) {
      const expected = expectedQuantity(prod.id);
      if (expected !== null) initialCounts[prod.id] = expected;
      initialReasons[prod.id] = liveInventory ? '' : PRESET_WASTE_REASONS[0];
    }
    setPhysicalCounts(initialCounts);
    setWasteReasons(initialReasons);
    setCustomReasons({});

    const currentStaff = getSelectedStaff();
    if (currentStaff && staffList.some(s => s.id === currentStaff.id)) {
      setStaffId(currentStaff.id);
    } else if (staffList[0]) {
      setStaffId(staffList[0].id);
    }
  }, [isOpen, state, staffList]);

  // Dialog native show/close
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog || dialog.open) return;
    dialog.showModal();
  }, [isOpen, liveInventory, products]);

  if (!isOpen) return null;

  function closeDialog() {
    if (submittingRef.current) return;
    if (dialogRef.current?.open) dialogRef.current.close();
    onClose();
  }

  // Denominations parsing
  const counts: CashDenominationCount[] = demoDenominations.map(item => {
    const raw = quantities[`quantity-${item.valueMinor}`];
    const parsed = raw === undefined ? 0 : parseCashQuantity(raw) ?? Number.NaN;
    return { valueMinor: item.valueMinor, quantity: parsed };
  });

  const denominationTotalMinor = cashCountTotal(counts);
  const parsedManualMinor = parseMoney(manualTotal);
  const calculatedOpeningCashMinor = mode === 'denominations' ? denominationTotalMinor : parsedManualMinor;

  const responsibleStaff = staffList.find(s => s.id === staffId);
  const responsibleName = liveInventory?.openerName ?? responsibleStaff?.name ?? 'No asignado';
  const shiftLabel = windowChoice.startsWith('06:00') ? 'Matutino (06:00 – 14:00)' : 'Vespertino (14:00 – 22:00)';

  function increment(valueMinor: number) {
    const current = parseCashQuantity(quantities[`quantity-${valueMinor}`] ?? '0') ?? 0;
    const next = current + 1;
    setQuantities(prev => ({ ...prev, [`quantity-${valueMinor}`]: next.toString() }));
    setAmounts(prev => ({ ...prev, [`amount-${valueMinor}`]: (next * valueMinor / 100).toString() }));
    setStep1Error('');
  }

  function decrement(valueMinor: number) {
    const current = parseCashQuantity(quantities[`quantity-${valueMinor}`] ?? '0') ?? 0;
    if (current <= 0) return;
    const next = current - 1;
    setQuantities(prev => ({ ...prev, [`quantity-${valueMinor}`]: next > 0 ? next.toString() : '' }));
    setAmounts(prev => ({ ...prev, [`amount-${valueMinor}`]: next > 0 ? (next * valueMinor / 100).toString() : '' }));
    setStep1Error('');
  }

  function handleDenominationChange(valueMinor: number, val: string) {
    setStep1Error('');
    if (entryMode === 'amount') {
      setAmounts(prev => ({ ...prev, [`amount-${valueMinor}`]: val }));
      if (val.trim() === '') {
        setQuantities(prev => ({ ...prev, [`quantity-${valueMinor}`]: '' }));
      } else {
        const parsed = parseMoney(val);
        if (parsed === null || parsed < 0) {
          setQuantities(prev => ({ ...prev, [`quantity-${valueMinor}`]: 'invalid' }));
        } else {
          const isMultiple = (parsed % valueMinor === 0);
          const q = Math.floor(parsed / valueMinor);
          setQuantities(prev => ({ ...prev, [`quantity-${valueMinor}`]: isMultiple ? q.toString() : 'invalid' }));
        }
      }
    } else {
      setQuantities(prev => ({ ...prev, [`quantity-${valueMinor}`]: val }));
      const q = parseCashQuantity(val);
      if (q !== null) {
        setAmounts(prev => ({ ...prev, [`amount-${valueMinor}`]: q > 0 ? (q * valueMinor / 100).toString() : '' }));
      }
    }
  }

  // Navigation handlers
  function handleNextToInventory(event?: FormEvent) {
    event?.preventDefault();
    if (calculatedOpeningCashMinor === null || calculatedOpeningCashMinor < 0) {
      setStep1Error(mode === 'denominations'
        ? 'Revisa las cantidades ingresadas; solo números enteros positivos.'
        : 'Ingresa un monto válido para el fondo inicial.');
      return;
    }
    setStep1Error('');
    setStep(2);
  }

  function handleNextToSummary() {
    if (liveInventory) {
      const product = products.find(item => {
        const expected = expectedQuantity(item.id);
        const physical = physicalCounts[item.id];
        const selected = wasteReasons[item.id] ?? '';
        const reason = selected === 'Otro motivo' ? (customReasons[item.id] ?? '').trim() : selected.trim();
        return expected !== null && physical !== undefined && physical !== expected && !reason;
      });
      if (product) {
        setStep1Error(`Indica el motivo de la diferencia de ${product.name}.`);
        return;
      }
    }
    setStep1Error('');
    setStep(3);
  }

  async function handleConfirmOpening() {
    if (submittingRef.current || calculatedOpeningCashMinor === null || calculatedOpeningCashMinor < 0) return;

    // Collect inventory adjustments
    const adjustments: ShiftOpenConfirmData['stockAdjustments'] = [];
    const countRecords: ShiftOpenConfirmData['counts'] = [];

    for (const product of products) {
      const exp = expectedQuantity(product.id);
      const physical = physicalCounts[product.id];
      if (physical === undefined) {
        setStep1Error(`Registra el conteo físico de ${product.name} antes de iniciar el turno.`);
        setStep(2);
        return;
      }
      const diff = exp === null ? null : physical - exp;
      const selectedReason = wasteReasons[product.id] || '';
      const reasonText = selectedReason === 'Otro motivo' ? (customReasons[product.id] || '').trim() : selectedReason.trim();
      if (liveInventory && diff !== null && diff !== 0 && !reasonText) {
        setStep1Error(`Indica el motivo de la diferencia de ${product.name}.`);
        setStep(2);
        return;
      }
      countRecords.push({ productId: product.id, quantity: physical, ...(diff && reasonText ? { reason: reasonText } : {}) });

      if (!liveInventory && exp !== null && diff !== null && diff < 0) {
        const diff = exp - physical;
        const reasonText = selectedReason === 'Otro motivo' ? (customReasons[product.id] || 'Merma detectada al abrir') : selectedReason;
        adjustments.push({
          productId: product.id,
          kind: 'waste',
          quantity: diff,
          reason: reasonText,
        });
      } else if (!liveInventory && exp !== null && diff !== null && diff > 0) {
        const diff = physical - exp;
        adjustments.push({
          productId: product.id,
          kind: 'restock',
          quantity: diff,
          reason: 'Ajuste inicial: Sobrante encontrado al abrir turno',
        });
      }
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await onConfirm({
        window: windowChoice,
        openingCashMinor: calculatedOpeningCashMinor,
        cashDenominations: mode === 'denominations' ? counts.filter(c => c.quantity > 0) : undefined,
        responsibleStaffId: responsibleStaff?.id,
        responsibleStaffName: responsibleStaff?.name,
        stockAdjustments: adjustments.length ? adjustments : undefined,
        counts: countRecords,
      });
      submittingRef.current = false;
      closeDialog();
    } catch (reason) {
      setStep1Error(reason instanceof Error ? reason.message : 'No se pudo registrar la apertura.');
      setStep(1);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  // Filter products for Step 2
  const filteredProducts = products.filter(p => {
    const term = inventorySearch.trim().toLowerCase();
    return !term || p.name.toLowerCase().includes(term) || (p.category ?? '').toLowerCase().includes(term);
  });

  // Calculate detected adjustments summary for Step 2 and 3
  const adjustmentsList = products
    .map(p => {
      const exp = expectedQuantity(p.id);
      const counted = physicalCounts[p.id];
      const diff = exp === null || counted === undefined ? null : counted - exp;
      const selectedReason = wasteReasons[p.id] ?? '';
      const reasonText = selectedReason === 'Otro motivo' ? (customReasons[p.id] ?? '').trim() : selectedReason.trim();
      return { product: p, expected: exp, counted, diff, reason: reasonText };
    })
    .filter(item => item.diff !== null && item.diff !== 0);

  function confirmAllInventoryMatches() {
    const matching: Record<string, number> = {};
    for (const prod of products) {
      const expected = expectedQuantity(prod.id);
      if (expected !== null) matching[prod.id] = expected;
    }
    setPhysicalCounts(matching);
  }

  return (
    <dialog
      ref={dialogRef}
      className="shift-open-dialog"
      aria-labelledby="shift-open-title"
      onCancel={event => { event.preventDefault(); if (!submittingRef.current) closeDialog(); }}
      onClick={event => { if (event.target === event.currentTarget) event.preventDefault(); }}
    >
      <div className="shift-open-shell">
        <header className="shift-open-header">
          <h2 id="shift-open-title">Iniciar Nuevo Turno de Trabajo</h2>
          <button className="shift-open-x" type="button" aria-label="Cerrar diálogo" disabled={isSubmitting} onClick={closeDialog}>×</button>
        </header>

        {/* Stepper Navigation */}
        <nav className="shift-open-stepper" aria-label="Pasos de apertura">
          <button
            type="button"
            className={`shift-step-pill ${step === 1 ? 'is-active' : ''} ${step > 1 ? 'is-completed' : ''}`}
            onClick={() => setStep(1)}
          >
            <span className="shift-step-number">{step > 1 ? '✓' : '1'}</span>
            <span>1. Conteo de Caja Chica</span>
          </button>
          <span className="shift-step-separator" aria-hidden="true" />
          <button
            type="button"
            className={`shift-step-pill ${step === 2 ? 'is-active' : ''} ${step > 2 ? 'is-completed' : ''}`}
            onClick={() => {
              if (calculatedOpeningCashMinor !== null && calculatedOpeningCashMinor >= 0) setStep(2);
            }}
            disabled={calculatedOpeningCashMinor === null || calculatedOpeningCashMinor < 0}
          >
            <span className="shift-step-number">{step > 2 ? '✓' : '2'}</span>
            <span>2. Inventario Inicial</span>
          </button>
          <span className="shift-step-separator" aria-hidden="true" />
          <button
            type="button"
            className={`shift-step-pill ${step === 3 ? 'is-active' : ''}`}
            onClick={handleNextToSummary}
            disabled={calculatedOpeningCashMinor === null || calculatedOpeningCashMinor < 0}
          >
            <span className="shift-step-number">3</span>
            <span>3. Resumen y Confirmación</span>
          </button>
        </nav>

        <div className="shift-open-scroll">
          {/* STEP 1: Conteo de Caja Chica */}
          {step === 1 && (
            <form noValidate onSubmit={handleNextToInventory}>
              <div className="shift-open-config-grid clay-card">
                <div className="shift-open-field">
                  <label htmlFor="shift-open-staff">Recepcionista Responsable</label>
                  <select
                    id="shift-open-staff"
                    value={staffId}
                    disabled={Boolean(liveInventory)}
                    onChange={e => setStaffId(e.target.value)}
                  >
                    {liveInventory ? <option value="__authenticated_opener__">{liveInventory.openerName}</option> : staffList.map(st => (
                      <option key={st.id} value={st.id}>
                        {st.name} ({st.role === 'OWNER' ? 'Admin / Propietario' : 'Recepción'})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="shift-open-field">
                  <label htmlFor="shift-open-window">Horario de Turno</label>
                  <select
                    id="shift-open-window"
                    value={windowChoice}
                    disabled={Boolean(liveInventory)}
                    onChange={e => setWindowChoice(e.target.value as ShiftWindow)}
                  >
                    <option value="06:00–14:00">Matutino (06:00 – 14:00)</option>
                    <option value="14:00–22:00">Vespertino (14:00 – 22:00)</option>
                  </select>
                </div>
                {liveInventory && (liveInventory.registers?.length ?? 0) > 1 && <div className="shift-open-field">
                  <label htmlFor="shift-open-register">Caja</label>
                  <select id="shift-open-register" value={liveInventory.registerId ?? ''} onChange={event => liveInventory.onRegisterChange?.(event.target.value)}>
                    {liveInventory.registers?.map(register => <option key={register.id} value={register.id}>{register.name}</option>)}
                  </select>
                </div>}
              </div>

              <div className="shift-open-cash-banner clay-card" role="status" aria-live="polite">
                <span>Fondo Inicial de Caja Chica</span>
                <strong>{calculatedOpeningCashMinor === null ? '—' : `${formatMoney(calculatedOpeningCashMinor)} MXN`}</strong>
              </div>

              <div className="shift-close-controls-row">
                <div className="shift-close-mode field">
                  <label htmlFor="cash-open-mode">Forma de conteo</label>
                  <select
                    id="cash-open-mode"
                    value={mode}
                    onChange={e => {
                      setMode(e.target.value as CountMode);
                      setStep1Error('');
                    }}
                  >
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
                    <div className="sr-only" role="radiogroup" aria-label="Modo de captura de desglose de apertura">
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
                    const raw = quantities[`quantity-${item.valueMinor}`] ?? '';
                    const rawAmount = amounts[`amount-${item.valueMinor}`] ?? (raw && raw !== 'invalid' ? ((parseCashQuantity(raw) ?? 0) * item.valueMinor / 100).toString() : '');
                    const parsedQty = parseCashQuantity(raw);
                    const qty = parsedQty ?? 0;
                    const isInvalid = entryMode === 'units' ? (raw !== '' && parsedQty === null) : (raw === 'invalid');
                    const subtotal = parsedQty === null || isInvalid ? null : item.valueMinor * qty;
                    const inputId = `open-cash-${item.valueMinor}`;
                    const billColor = billColors[item.valueMinor] ?? '#FC6C06';
                    const coinValueStr = item.valueMinor === 50 ? '50¢' : (item.valueMinor / 100).toString();

                    return (
                      <div
                        className={`shift-close-denomination ${qty > 0 ? 'is-active' : ''}`}
                        key={item.valueMinor}
                        onContextMenu={e => {
                          e.preventDefault();
                          decrement(item.valueMinor);
                        }}
                      >
                        <div
                          className="denomination-tile-btn"
                          onClick={() => increment(item.valueMinor)}
                          role="button"
                          tabIndex={0}
                          aria-label={`Agregar 1 ${item.kind} de ${formatMoney(item.valueMinor)}`}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              increment(item.valueMinor);
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
                            <label htmlFor={inputId} className="denomination-label">
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
                              id={inputId}
                              inputMode={entryMode === 'amount' ? 'decimal' : 'numeric'}
                              type="text"
                              value={entryMode === 'amount' ? rawAmount : raw}
                              aria-invalid={isInvalid}
                              placeholder={entryMode === 'amount' ? '0.00' : '0'}
                              onChange={e => handleDenominationChange(item.valueMinor, e.target.value)}
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
                            ? 'Inválido'
                            : subtotal === null || subtotal === 0
                              ? ''
                              : `Subtotal ${formatMoney(subtotal)} MXN`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="shift-open-manual field" style={{ margin: '1rem 0' }}>
                  <label htmlFor="shift-opening">Fondo inicial (MXN)</label>
                  <input
                    id="shift-opening"
                    inputMode="decimal"
                    type="text"
                    placeholder="Ej. 300.00"
                    value={manualTotal}
                    onChange={e => {
                      setManualTotal(e.target.value);
                      setStep1Error('');
                    }}
                  />
                </div>
              )}

              {step1Error && (
                <div role="alert" style={{ marginTop: '1rem' }}>
                  <Notice tone="error">{step1Error}</Notice>
                </div>
              )}
            </form>
          )}

          {/* STEP 2: Verificación / Ajuste de Inventario Inicial */}
          {step === 2 && (
            <div>
              {step1Error && <div role="alert"><Notice tone="error">{step1Error}</Notice></div>}
              <div className="shift-open-inventory-toolbar">
                <div className="shift-open-inventory-search">
                  <input
                    type="search"
                    aria-label="Buscar producto en inventario"
                    placeholder="Buscar producto o categoría (ej. toallas, bebidas, suplementos)..."
                    value={inventorySearch}
                    onChange={e => setInventorySearch(e.target.value)}
                  />
                </div>
                <Button variant="secondary" onClick={confirmAllInventoryMatches}>
                  Todo el inventario coincide ✓
                </Button>
              </div>

              <div className="shift-inventory-table-wrap">
                <table className="shift-inventory-table" aria-label="Verificación de inventario inicial">
                  <thead>
                    <tr>
                      <th scope="col">Producto</th>
                      <th scope="col">Stock Esperado</th>
                      <th scope="col">Físico Contado</th>
                      <th scope="col">Estado / Diferencia</th>
                      <th scope="col">Motivo de Ajuste</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map(prod => {
                      const exp = expectedQuantity(prod.id);
                      const currentVal = physicalCounts[prod.id] ?? exp ?? '';
                      const counted = physicalCounts[prod.id];
                      const diff = exp === null || counted === undefined ? null : counted - exp;
                      const reasonVal = liveInventory ? (wasteReasons[prod.id] ?? '') : (wasteReasons[prod.id] || PRESET_WASTE_REASONS[0]);

                      return (
                        <tr key={prod.id}>
                          <td>
                            <div className="shift-inventory-item-name">{prod.name}</div>
                            <div className="shift-inventory-item-cat">{prod.category ?? 'General'}</div>
                          </td>
                          <td>
                            {exp === null ? 'Sin registrar' : <><strong>{exp}</strong> uds</>}
                          </td>
                          <td>
                            <input
                              className="shift-inventory-qty-input"
                              type="number"
                              min="0"
                              step="1"
                              aria-label={`Stock físico de ${prod.name}`}
                              value={currentVal}
                              onChange={e => {
                                const raw = e.target.value.trim();
                                if (raw === '') {
                                  if (liveInventory) setPhysicalCounts(prev => { const next = { ...prev }; delete next[prod.id]; return next; });
                                  else setPhysicalCounts(prev => ({ ...prev, [prod.id]: 0 }));
                                  return;
                                }
                                const val = parseInt(raw, 10);
                                if (!isNaN(val) && val >= 0) {
                                  setPhysicalCounts(prev => ({ ...prev, [prod.id]: val }));
                                }
                              }}
                            />
                          </td>
                          <td>
                            {diff === null && <Badge tone="neutral">Sin base registrada</Badge>}
                            {diff === 0 && <Badge tone="success">Conforme</Badge>}
                            {diff !== null && diff < 0 && <Badge tone="warning">Merma ({diff})</Badge>}
                            {diff !== null && diff > 0 && <Badge tone="neutral">Sobrante (+{diff})</Badge>}
                          </td>
                          <td>
                            {diff !== null && diff !== 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <select
                                  className="shift-inventory-reason-select"
                                  aria-label={`${liveInventory ? 'Motivo de diferencia' : 'Motivo de merma'} para ${prod.name}`}
                                  value={reasonVal}
                                  onChange={e => {
                                    setWasteReasons(prev => ({ ...prev, [prod.id]: e.target.value }));
                                  }}
                                >
                                  {liveInventory && <option value="">Selecciona un motivo</option>}
                                  {PRESET_WASTE_REASONS.map(r => (
                                    <option key={r} value={r}>{r}</option>
                                  ))}
                                </select>
                                {reasonVal === 'Otro motivo' && (
                                  <input
                                    type="text"
                                    placeholder="Especificar motivo..."
                                    style={{ fontSize: '0.78rem', padding: '0.35rem' }}
                                    value={customReasons[prod.id] ?? ''}
                                    onChange={e => setCustomReasons(prev => ({ ...prev, [prod.id]: e.target.value }))}
                                  />
                                )}
                              </div>
                            ) : diff !== null && diff > 0 ? (
                              <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>Sobrante no registrado</span>
                            ) : diff === 0 ? (
                              <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>Sin ajuste</span>
                            ) : (
                              <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>No se conoce el stock esperado</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: '1rem' }}>
                {adjustmentsList.length === 0 ? (
                  <Notice tone="success">
                    Todo el inventario coincide con las existencias esperadas en sistema ({products.length} productos verificados).
                  </Notice>
                ) : (
                  <Notice tone="warning">
                    Se registrarán {adjustmentsList.length} ajuste(s) de inventario al iniciar este turno.
                  </Notice>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: Resumen y Confirmación */}
          {step === 3 && (
            <div>
              <div className="shift-open-summary-grid">
                <div className="shift-open-summary-card">
                  <h4>Recepcionista Responsable</h4>
                  <div className="shift-open-summary-val">{responsibleName}</div>
                  <p className="shift-open-summary-detail">
                    {liveInventory ? 'Apertura autenticada por esta persona' : responsibleStaff?.role === 'OWNER' ? 'Administrador / Propietario' : 'Recepción de turno'}
                  </p>
                </div>

                <div className="shift-open-summary-card">
                  <h4>Horario Seleccionado</h4>
                  <div className="shift-open-summary-val">{shiftLabel}</div>
                  <p className="shift-open-summary-detail">
                    {new Intl.DateTimeFormat('es-MX', { dateStyle: 'full' }).format(new Date())}
                  </p>
                </div>

                <div className="shift-open-summary-card">
                  <h4>Fondo Inicial de Caja</h4>
                  <div className="shift-open-summary-val" style={{ color: 'var(--color-primary)' }}>
                    {formatMoney(calculatedOpeningCashMinor ?? 0)} MXN
                  </div>
                  <p className="shift-open-summary-detail">
                    {mode === 'denominations'
                      ? `Desglose por monedas y billetes (${counts.filter(c => c.quantity > 0).length} denominaciones registradas)`
                      : 'Ingresado como total manual'}
                  </p>
                </div>

                <div className="shift-open-summary-card">
                  <h4>Estado del Inventario</h4>
                  <div className="shift-open-summary-val">
                    {adjustmentsList.length === 0 ? '100% Verificado' : `${adjustmentsList.length} ajuste(s)`}
                  </div>
                  <p className="shift-open-summary-detail">
                    {adjustmentsList.length === 0
                      ? `${products.length} productos verificados sin discrepancias.`
                      : 'Mermas y diferencias identificadas al abrir.'}
                  </p>
                </div>

                {adjustmentsList.length > 0 && (
                  <div className="shift-open-adjustments-card">
                    <h4 style={{ color: 'var(--color-primary)' }}>Detalle de Ajustes / Mermas al Abrir</h4>
                    <ul className="shift-open-adjustments-list">
                      {adjustmentsList.map(item => (
                        <li key={item.product.id}>
                          <div>
                            <strong>{item.product.name}</strong>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                              Esperado: {item.expected} | Contado: {item.counted}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <Badge tone={item.diff !== null && item.diff < 0 ? 'warning' : 'neutral'}>
                              {item.diff !== null && item.diff < 0 ? `Merma ${item.diff} uds` : `+${item.diff} uds`}
                            </Badge>
                            <div style={{ fontSize: '0.78rem', marginTop: '2px' }}>
                              Motivo: &quot;{item.reason}&quot;
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <footer className="shift-open-footer">
          <Button variant="secondary" disabled={isSubmitting} onClick={closeDialog}>
            Cancelar
          </Button>

          <div className="shift-open-footer-actions">
            {step === 1 && (
              <Button onClick={() => handleNextToInventory()}>
                Continuar a Inventario →
              </Button>
            )}

            {step === 2 && (
              <>
                <Button variant="secondary" onClick={() => setStep(1)}>
                  ← Volver a Caja Chica
                </Button>
                <Button onClick={handleNextToSummary}>
                  Continuar a Resumen →
                </Button>
              </>
            )}

            {step === 3 && (
              <>
                <Button variant="secondary" onClick={() => setStep(2)}>
                  ← Modificar
                </Button>
                <Button disabled={isSubmitting} onClick={() => void handleConfirmOpening()}>
                  Confirmar e Iniciar Turno
                </Button>
              </>
            )}
          </div>
        </footer>
      </div>
    </dialog>
  );
}
