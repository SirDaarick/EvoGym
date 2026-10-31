import { useState, useRef, useEffect, type ReactNode } from 'react';
import type { PaymentMethod } from '../../domain/models';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { useIsDarkMode } from '../../shared/theme';
import { Panel, Button, Notice } from '../../shared/ui';
import JellyRadio from '../catalog/react-bits/JellyRadio';
import Stepper, { Step } from '../catalog/react-bits/Stepper';
import { CashTenderCalculator } from '../payments/CashTenderCalculator';
import { PendingBalanceModal } from './PendingBalanceModal';
import { OvertimeSaleToggle, isShiftTransitionOrOvertime } from './OvertimeSaleToggle';
import { PointPaymentModal, type PointVoucher } from './PointPaymentModal';
import './CurrentPurchaseCard.css';

export interface CheckoutPaymentBreakdown {
  mode: 'single' | 'mixed';
  method: PaymentMethod;
  tenderedMinor?: number;
  shortfallMinor: number;
  mixedMethod1?: PaymentMethod;
  mixedAmount1Minor?: number;
  mixedMethod2?: PaymentMethod;
  mixedAmount2Minor?: number;
  isOvertime?: boolean;
  cardVoucher?: PointVoucher;
}

export interface CurrentPurchaseCardProps {
  totalMinor: number;
  title?: string;
  step1Title?: string;
  step2Title?: string;
  shiftWindow?: string;
  currentTime?: Date | string;
  assignedMember?: { id?: string; name: string; phone?: string; creditMinor?: number } | null;
  onAssignMemberClick?: () => void;
  headerContent?: ReactNode;
  memberAssignment?: ReactNode;
  children: ReactNode;
  footerActions?: ReactNode;
  step1ActionLabel?: string;
  step1ActionDisabled?: boolean;
  onStep1Proceed?: () => void;
  className?: string;
  disabled?: boolean;
  step?: number;
  onStepChange?: (step: number) => void;
  onConfirmPayment?: (breakdown: CheckoutPaymentBreakdown, forcePendingShortfall?: boolean) => void;
  confirmActionLabel?: string;
  backActionLabel?: string;
  statusMessage?: string;
  statusType?: 'error' | 'warning' | 'success';
  paymentMethod?: PaymentMethod;
  onPaymentMethodChange?: (method: PaymentMethod) => void;
  cashOnly?: boolean;
  useLiveCardIntent?: boolean;
}

const methodNames: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

const paymentIcons = {
  cash: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FC6C06" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  ),
  card: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FC6C06" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
    </svg>
  ),
  transfer: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FC6C06" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v4M12 14v4M16 14v4" />
    </svg>
  ),
};

export function CurrentPurchaseCard({
  totalMinor,
  title = 'Compra actual',
  step1Title = 'Carrito',
  step2Title = 'Cobro',
  shiftWindow,
  currentTime,
  assignedMember = null,
  onAssignMemberClick,
  headerContent,
  memberAssignment,
  children,
  footerActions,
  step1ActionLabel,
  step1ActionDisabled = false,
  onStep1Proceed,
  className = '',
  disabled = false,
  step: controlledStep,
  onStepChange: controlledOnStepChange,
  onConfirmPayment,
  confirmActionLabel,
  backActionLabel,
  statusMessage,
  statusType = 'success',
  cashOnly = false,
  useLiveCardIntent = false,
  paymentMethod,
  onPaymentMethodChange,
}: CurrentPurchaseCardProps) {
  const dark = useIsDarkMode();
  const [internalStep, setInternalStep] = useState(1);
  const currentStep = controlledStep ?? internalStep;

  const setStep = (next: number) => {
    if (controlledOnStepChange) {
      controlledOnStepChange(next);
    } else {
      setInternalStep(next);
    }
  };

  // Payment states
  const [selectedMethods, setSelectedMethods] = useState<PaymentMethod[]>([]);
  const [mixedSubStep, setMixedSubStep] = useState<1 | 2>(1);
  const [mixedAmount1, setMixedAmount1] = useState('');
  const [mixedAmount2, setMixedAmount2] = useState('');
  const [tenderedAmount, setTenderedAmount] = useState('');
  const [holdingMethod, setHoldingMethod] = useState<PaymentMethod | null>(null);
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [isPointModalOpen, setIsPointModalOpen] = useState(false);
  // Automatic Overtime classification: obligatory when selling during shift cut or transition
  const isOvertime = isShiftTransitionOrOvertime(shiftWindow, currentTime);
  const [internalError, setInternalError] = useState<string | null>(null);

  const holdTimerRef = useRef<{ [key in PaymentMethod]?: number }>({});
  const didLongPressRef = useRef<{ [key in PaymentMethod]?: boolean }>({});

  useEffect(() => {
    return () => {
      Object.values(holdTimerRef.current).forEach(t => {
        if (t) clearTimeout(t);
      });
    };
  }, []);

  const toggleMixedMethod = (m: PaymentMethod) => {
    setSelectedMethods(prev => {
      if (prev.includes(m)) {
        return prev.length > 1 ? prev.filter(x => x !== m) : prev;
      }
      if (prev.length === 1) {
        setMixedSubStep(1);
        setMixedAmount1('');
        setMixedAmount2('');
        return [prev[0], m];
      }
      setMixedSubStep(1);
      setMixedAmount1('');
      setMixedAmount2('');
      return [m];
    });
  };

  const handleTilePointerDown = (m: PaymentMethod) => {
    didLongPressRef.current[m] = false;
    setHoldingMethod(m);
    holdTimerRef.current[m] = window.setTimeout(() => {
      didLongPressRef.current[m] = true;
      setHoldingMethod(null);
      toggleMixedMethod(m);
    }, 450);
  };

  const handleTilePointerUpOrCancel = (m: PaymentMethod) => {
    if (holdTimerRef.current[m]) {
      clearTimeout(holdTimerRef.current[m]);
      delete holdTimerRef.current[m];
    }
    setHoldingMethod(null);
  };

  const handleTileClick = (m: PaymentMethod, e: React.MouseEvent) => {
    if (didLongPressRef.current[m]) {
      didLongPressRef.current[m] = false;
      return;
    }

    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      toggleMixedMethod(m);
      return;
    }

    if (selectedMethods.length === 2) {
      if (m === selectedMethods[0] && mixedSubStep === 2) {
        setMixedSubStep(1);
        return;
      }
      if (m === selectedMethods[1] && mixedSubStep === 1) {
        const a1 = parseMoney(mixedAmount1);
        if (a1 && a1 > 0) {
          const remaining = Math.max(0, totalMinor - a1);
          if (!mixedAmount2 && remaining > 0) {
            setMixedAmount2((remaining / 100).toFixed(2));
          }
          setMixedSubStep(2);
          return;
        }
      }
    }

    // Normal click: switch single selection
    setSelectedMethods([m]);
    setMixedSubStep(1);
    setMixedAmount1('');
    setMixedAmount2('');
    onPaymentMethodChange?.(m);
  };

  const handleProceedToStep2 = () => {
    onStep1Proceed?.();
    setSelectedMethods([]);
    setMixedSubStep(1);
    setMixedAmount1('');
    setMixedAmount2('');
    setTenderedAmount('');
    setInternalError(null);
    setStep(2);
  };

  const handleBackToStep1 = () => {
    setInternalError(null);
    setStep(1);
  };

  const tenderedMinor = parseMoney(tenderedAmount);

  const calculateShortfall = (): number => {
    if (selectedMethods.length === 1 && selectedMethods[0] === 'cash') {
      const isTenderSpecified = tenderedAmount.trim() !== '';
      const tendered = isTenderSpecified ? (tenderedMinor ?? 0) : totalMinor;
      return Math.max(0, totalMinor - tendered);
    }
    if (selectedMethods.length === 2) {
      const a1 = parseMoney(mixedAmount1) ?? 0;
      const a2 = parseMoney(mixedAmount2) ?? 0;
      return Math.max(0, totalMinor - (a1 + a2));
    }
    return 0;
  };

  const handleConfirmCheckout = (forcePendingShortfall = false) => {
    setInternalError(null);
    if (selectedMethods.length === 0) return;
    if (cashOnly && (selectedMethods.length !== 1 || selectedMethods[0] !== 'cash' || calculateShortfall() > 0)) {
      setInternalError('Por ahora solo está disponible el pago completo en efectivo.');
      return;
    }

    if (selectedMethods.length === 2) {
      const m1 = selectedMethods[0];
      const m2 = selectedMethods[1];
      const a1 = parseMoney(mixedAmount1) ?? 0;
      const a2 = parseMoney(mixedAmount2) ?? 0;
      const shortfall = Math.max(0, totalMinor - (a1 + a2));

      if (shortfall > 0 && !forcePendingShortfall) {
        if (!assignedMember) {
          setInternalError(
            `Faltan ${formatMoney(shortfall)} MXN. Para asignar saldo pendiente debes asignar un socio en el Paso 1 (${step1Title}).`
          );
          return;
        }
        setIsPendingModalOpen(true);
        return;
      }

      onConfirmPayment?.(
        {
          mode: 'mixed',
          method: m1,
          mixedMethod1: m1,
          mixedAmount1Minor: a1,
          mixedMethod2: m2,
          mixedAmount2Minor: a2,
          shortfallMinor: shortfall,
          isOvertime,
        },
        forcePendingShortfall
      );
      return;
    }

    const singleMethod = selectedMethods[0];
    if (singleMethod === 'cash') {
      const isTenderSpecified = tenderedAmount.trim() !== '';
      const tendered = isTenderSpecified ? (tenderedMinor ?? 0) : totalMinor;
      const shortfall = Math.max(0, totalMinor - tendered);

      if (shortfall > 0 && !forcePendingShortfall) {
        if (!assignedMember) {
          setInternalError(
            `Faltan ${formatMoney(shortfall)} MXN. Para asignar saldo pendiente debes asignar un socio en el Paso 1 (${step1Title}).`
          );
          return;
        }
        setIsPendingModalOpen(true);
        return;
      }

      onConfirmPayment?.(
        {
          mode: 'single',
          method: 'cash',
          tenderedMinor: tendered,
          shortfallMinor: shortfall,
          isOvertime,
        },
        forcePendingShortfall
      );
      return;
    }

    if (singleMethod === 'card') {
      if (useLiveCardIntent) {
        onConfirmPayment?.(
          {
            mode: 'single',
            method: 'card',
            shortfallMinor: 0,
            isOvertime,
          },
          forcePendingShortfall
        );
        return;
      }
      setIsPointModalOpen(true);
      return;
    }

    onConfirmPayment?.(
      {
        mode: 'single',
        method: singleMethod,
        shortfallMinor: 0,
        isOvertime,
      },
      forcePendingShortfall
    );
  };

  const shortfall = calculateShortfall();
  const coveredMinor =
    selectedMethods.length === 2
      ? (parseMoney(mixedAmount1) ?? 0) + (parseMoney(mixedAmount2) ?? 0)
      : (tenderedMinor ?? 0);

  return (
    <Panel className={`cart-checkout-panel current-purchase-card ${dark ? 'dark-theme' : ''} ${className}`.trim()}>
      <div className="cart-header-top">
        <div className="cart-heading-row">
          <h2>{title}</h2>
          <output className="cart-total-badge" aria-label="Total de compra">{`${formatMoney(totalMinor)} MXN`}</output>
        </div>
        <div className="cart-stepper-container">
          <Stepper
            step={currentStep}
            onStepChange={next => {
              if (next === 1) {
                handleBackToStep1();
              } else if (next === 2 && !step1ActionDisabled && totalMinor > 0) {
                handleProceedToStep2();
              }
            }}
            indicator="numbers"
            transition="slide"
            frame={false}
            showFooter={false}
            width="100%"
            accentColor="#FC6C06"
            theme={dark ? 'dark' : 'light'}
            className="cart-checkout-stepper"
          >
            <Step title={step1Title} />
            <Step title={step2Title} />
          </Stepper>
        </div>
        {headerContent}
      </div>

      <div className="cart-scrollable-body">
        {currentStep === 1 ? (
          <>
            {memberAssignment}
            {paymentMethod && onPaymentMethodChange && !onConfirmPayment && (
              <div className="cart-payment-methods-box">
                <JellyRadio
                  ariaLabel="Método de cobro"
                  items={[
                    { value: 'cash', label: 'Efectivo' },
                    { value: 'card', label: 'Tarjeta' },
                    { value: 'transfer', label: 'Transferencia' },
                  ]}
                  value={paymentMethod}
                  onChange={val => onPaymentMethodChange(val as PaymentMethod)}
                  disabled={disabled}
                />
              </div>
            )}
            {children}
          </>
        ) : (
          /* Step 2 Content: Standardized Payment Flow */
          <div className="cart-step2-content">
            {/* Assigned member summary badge */}
            <div className="assigned-member-summary-box">
              <span>
                {assignedMember ? (
                  <>Socio: <strong>{assignedMember.name}</strong></>
                ) : (
                  <span className="muted">Venta general (sin socio asignado)</span>
                )}
              </span>
              <button
                type="button"
                className="button button-ghost button-sm"
                style={{ padding: '2px 8px', fontSize: '12px' }}
                onClick={() => {
                  handleBackToStep1();
                  onAssignMemberClick?.();
                }}
              >
                {assignedMember ? 'Cambiar' : 'Asignar socio'}
              </button>
            </div>

            {!cashOnly && <div className="cart-overtime-toggle-slot" style={{ marginBottom: isOvertime ? '12px' : '0' }}>
              <OvertimeSaleToggle
                isOvertime={isOvertime}
                shiftWindow={shiftWindow}
                currentTime={currentTime}
              />
            </div>}

            <label id="payment-methods-label" className="cart-payment-methods-heading">Método de cobro</label>
            <div className="cart-payment-methods-grid" role="radiogroup" aria-labelledby="payment-methods-label">
              {(['cash', 'card', 'transfer'] as PaymentMethod[]).map(m => {
                const isSelected = selectedMethods.includes(m);
                const isHolding = holdingMethod === m;
                const isMixed = selectedMethods.length === 2;
                const multiIndex = selectedMethods.indexOf(m);
                const isM1 = isMixed && multiIndex === 0;
                const isM2 = isMixed && multiIndex === 1;
                const isM1Completed = isM1 && mixedSubStep === 2;
                const isCurrentlyPaying = isMixed ? (mixedSubStep === 1 ? isM1 : isM2) : isSelected;
                const isQueued = isMixed && isM2 && mixedSubStep === 1;

                let tileClasses = 'payment-method-tile';
                if (isCurrentlyPaying) tileClasses += ' is-active is-paying';
                else if (isM1Completed) tileClasses += ' is-completed';
                else if (isQueued) tileClasses += ' is-queued';
                else if (isSelected) tileClasses += ' is-active';
                if (isHolding) tileClasses += ' is-holding';

                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-label={methodNames[m]}
                    aria-checked={isSelected}
                    title={
                      isMixed
                        ? isM1Completed
                          ? `${methodNames[m]} (Abonado ✓ · Clic para modificar)`
                          : isCurrentlyPaying
                          ? `${methodNames[m]} (Cobro en curso)`
                          : `${methodNames[m]} (Siguiente método)`
                        : `${methodNames[m]} (Mantén presionado para pago mixto)`
                    }
                    className={tileClasses}
                    onPointerDown={() => handleTilePointerDown(m)}
                    onPointerUp={() => handleTilePointerUpOrCancel(m)}
                    onPointerCancel={() => handleTilePointerUpOrCancel(m)}
                    onPointerLeave={() => handleTilePointerUpOrCancel(m)}
                    onClick={e => handleTileClick(m, e)}
                  >
                    {isMixed && multiIndex >= 0 && (
                      <span
                        className={`multi-badge ${isM1Completed ? 'is-completed' : isCurrentlyPaying ? 'is-active' : 'is-queued'}`}
                        aria-label={isM1Completed ? 'Completado' : `Parte ${multiIndex + 1}`}
                      >
                        {isM1Completed ? '✓' : multiIndex + 1}
                      </span>
                    )}
                    <span className="payment-method-icon">
                      {isM1Completed ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#175D3B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        paymentIcons[m]
                      )}
                    </span>
                    <span>{methodNames[m]}</span>
                  </button>
                );
              })}
            </div>

            {selectedMethods.length === 1 && (
              <p className="cart-payment-methods-hint">
                Mantén presionado otro método para combinar en pago mixto.
              </p>
            )}

            {/* Contextual breakdown */}
            {selectedMethods.length === 0 && (
              <div className="cart-payment-context" style={{ marginTop: '12px' }}>
                <Notice tone="neutral">
                  Selecciona un método de cobro arriba para continuar. Mantén presionado un segundo método para combinar en pago mixto.
                </Notice>
              </div>
            )}

            {selectedMethods.length === 1 && selectedMethods[0] === 'cash' && (
              <div className="cart-payment-context">
                <CashTenderCalculator totalMinor={totalMinor} value={tenderedAmount} onChange={setTenderedAmount} disabled={disabled} />
                {tenderedMinor !== null && tenderedMinor < totalMinor && (
                  <Notice tone="warning">
                    {assignedMember ? (
                      <>Monto ingresado: <strong>{formatMoney(tenderedMinor)} MXN</strong>. Al pulsar cobrar se abrirá el modal para marcar el faltante de <strong>{formatMoney(totalMinor - tenderedMinor)} MXN</strong> como saldo pendiente a <strong>{assignedMember.name}</strong>.</>
                    ) : (
                      <>Faltan <strong>{formatMoney(totalMinor - tenderedMinor)} MXN</strong>. Asigna un socio en el Paso 1 para poder registrar saldo pendiente.</>
                    )}
                  </Notice>
                )}
                <Notice tone="warning">
                  Confirma solo después de recibir el efectivo. El registro local no procesa pagos ni calcula cambio bancario.
                </Notice>
              </div>
            )}

            {selectedMethods.length === 1 && selectedMethods[0] === 'card' && (
              <div className="cart-payment-context">
                <Notice tone="warning">
                  <strong>Cobro en terminal bancaria:</strong> {formatMoney(totalMinor)} MXN.
                  <br />
                  <span style={{ fontSize: '12px' }}>
                    Fórmula de comisión Clip/banco: <code>Precio - (Precio × 0.0406)</code> · Comisión estimada (4.06%): {formatMoney(Math.round(totalMinor * 0.0406))} MXN · Neto: {formatMoney(totalMinor - Math.round(totalMinor * 0.0406))} MXN.
                  </span>
                </Notice>
              </div>
            )}

            {selectedMethods.length === 1 && selectedMethods[0] === 'transfer' && (
              <div className="cart-payment-context">
                <Notice tone="warning">
                  <strong>Control de seguridad de transferencia (T03):</strong> Verifica que el comprobante recibido coincida exactamente con {formatMoney(totalMinor)} MXN. La compra se registrará con estado <em>pendiente</em> sin cobro confirmado ni descuento de inventario.
                </Notice>
              </div>
            )}

            {selectedMethods.length === 2 && (() => {
              const m1 = selectedMethods[0];
              const m2 = selectedMethods[1];
              const a1 = parseMoney(mixedAmount1) ?? 0;
              const remainingAfterA1 = Math.max(0, totalMinor - a1);
              const a2 = parseMoney(mixedAmount2) ?? 0;
              const covered = a1 + a2;
              const mixedShortfall = Math.max(0, totalMinor - covered);

              return (
                <div className="mixed-payment-box">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 2px 4px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-muted)' }}>
                      {mixedSubStep === 1 ? `Cobro con ${methodNames[m1]}` : `Cobro con ${methodNames[m2]}`}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: (mixedSubStep === 1 ? remainingAfterA1 : mixedShortfall) > 0 ? 'var(--color-primary)' : '#175D3B' }}>
                      {(mixedSubStep === 1 ? remainingAfterA1 : mixedShortfall) > 0
                        ? `Faltante: ${formatMoney(mixedSubStep === 1 ? remainingAfterA1 : mixedShortfall)} MXN`
                        : 'Total 100% cubierto'}
                    </span>
                  </div>

                  {mixedSubStep === 1 ? (
                    <div className="mixed-step-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div className="field" style={{ margin: 0 }}>
                        <label htmlFor="mixed-amount-1" style={{ fontSize: '12px', fontWeight: 600 }}>
                          Monto primer cobro con {methodNames[m1]} (MXN)
                        </label>
                        <input
                          id="mixed-amount-1"
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={mixedAmount1}
                          onChange={e => setMixedAmount1(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <Button
                        type="button"
                        className="mixed-step-next-btn"
                        disabled={!parseMoney(mixedAmount1) || (parseMoney(mixedAmount1) ?? 0) <= 0}
                        onClick={() => {
                          const remaining = Math.max(0, totalMinor - a1);
                          if (!mixedAmount2 && remaining > 0) {
                            setMixedAmount2((remaining / 100).toFixed(2));
                          }
                          setMixedSubStep(2);
                        }}
                      >
                        Abonar {mixedAmount1 ? `$${formatMoney(a1)} MXN` : ''} y pasar a {methodNames[m2]} →
                      </Button>
                    </div>
                  ) : (
                    <div className="mixed-step-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div className="field" style={{ margin: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label htmlFor="mixed-amount-2" style={{ fontSize: '12px', fontWeight: 600 }}>
                            Monto segundo cobro con {methodNames[m2]} (MXN)
                          </label>
                          {remainingAfterA1 > 0 && (
                            <button
                              type="button"
                              className="button button-ghost button-sm"
                              style={{ padding: '2px 6px', fontSize: '11px', height: 'auto', minHeight: 0 }}
                              onClick={() => setMixedAmount2((remainingAfterA1 / 100).toFixed(2))}
                            >
                              Cubrir restante ({formatMoney(remainingAfterA1)} MXN)
                            </button>
                          )}
                        </div>
                        <input
                          id="mixed-amount-2"
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={mixedAmount2}
                          onChange={e => setMixedAmount2(e.target.value)}
                          autoFocus
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {internalError && (
              <Notice tone="error">
                {internalError}
              </Notice>
            )}
          </div>
        )}
      </div>

      <div className="cart-card-footer">
        {currentStep === 1 ? (
          footerActions ?? (
            <>
              <Button
                className="cart-proceed-btn cart-primary-action-btn"
                aria-label="Revisar cobro"
                disabled={disabled || step1ActionDisabled || totalMinor <= 0}
                onClick={handleProceedToStep2}
              >
                {step1ActionLabel ?? `Proceder al cobro · ${formatMoney(totalMinor)} MXN →`}
              </Button>
              <div role={statusType === 'error' ? 'alert' : 'status'} aria-label="Resultado de compra">
                {statusMessage && (
                  <Notice tone={statusType}>
                    {statusMessage}
                  </Notice>
                )}
              </div>
            </>
          )
        ) : (
          <div className="cart-step2-actions">
            <Button
              className="confirm-checkout-btn"
              disabled={
                disabled ||
                selectedMethods.length === 0 ||
                (selectedMethods.length === 2 && mixedSubStep === 1)
              }
              onClick={() => handleConfirmCheckout(false)}
            >
              {selectedMethods.length === 0
                ? 'Selecciona un método de cobro'
                : selectedMethods.length === 1
                ? selectedMethods[0] === 'transfer'
                  ? 'Registrar compra pendiente'
                  : selectedMethods[0] === 'card'
                  ? confirmActionLabel ?? 'Cobrar con Tarjeta'
                  : confirmActionLabel ?? 'Realizar cobro'
                : mixedSubStep === 1
                ? 'Abona el primer método para continuar'
                : (() => {
                    const a1 = parseMoney(mixedAmount1) ?? 0;
                    const a2 = parseMoney(mixedAmount2) ?? 0;
                    const mixedShortfall = Math.max(0, totalMinor - (a1 + a2));
                    return mixedShortfall > 0
                      ? confirmActionLabel
                        ? `${confirmActionLabel} (${formatMoney(mixedShortfall)} MXN faltante)`
                        : `Realizar cobro mixto (${formatMoney(mixedShortfall)} MXN faltante)`
                      : confirmActionLabel ?? 'Realizar cobro mixto';
                  })()}
            </Button>
            <Button
              variant="secondary"
              className="cart-back-btn"
              disabled={disabled}
              onClick={handleBackToStep1}
            >
              {backActionLabel ?? (step1Title.toLowerCase() === 'carrito' ? '← Volver al carrito' : `← Volver a ${step1Title.toLowerCase()}`)}
            </Button>
            <div role={statusType === 'error' ? 'alert' : 'status'} aria-label="Resultado de compra">
              {statusMessage && (
                <Notice tone={statusType}>
                  {statusMessage}
                </Notice>
              )}
            </div>
          </div>
        )}
      </div>

      {isPendingModalOpen && (
        <PendingBalanceModal
          isOpen={isPendingModalOpen}
          onClose={() => setIsPendingModalOpen(false)}
          onConfirm={() => {
            setIsPendingModalOpen(false);
            handleConfirmCheckout(true);
          }}
          totalMinor={totalMinor}
          coveredMinor={coveredMinor}
          shortfallMinor={shortfall}
          memberName={assignedMember?.name ?? 'Socio'}
          disabled={disabled}
        />
      )}

      {isPointModalOpen && (
        <PointPaymentModal
          isOpen={isPointModalOpen}
          totalMinor={totalMinor}
          terminalName="Terminal Mostrador 01"
          onCancel={() => setIsPointModalOpen(false)}
          onReject={(reason) => {
            setIsPointModalOpen(false);
            setInternalError(`Cobro en terminal rechazado: ${reason}. Intenta con otra tarjeta o cambia a efectivo.`);
          }}
          onConfirm={(voucher) => {
            setIsPointModalOpen(false);
            onConfirmPayment?.(
              {
                mode: 'single',
                method: 'card',
                shortfallMinor: 0,
                isOvertime,
                cardVoucher: voucher,
              },
              false
            );
          }}
        />
      )}
    </Panel>
  );
}
