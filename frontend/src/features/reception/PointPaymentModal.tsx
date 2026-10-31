import { useEffect, useState } from 'react';
import { formatMoney } from '../../demo/adapter';
import { Button } from '../../shared/ui';
import './PointPaymentModal.css';

export interface PointVoucher {
  authorizationCode: string;
  cardBrand: 'VISA' | 'MASTERCARD' | 'AMEX';
  lastFourDigits: string;
  terminalName: string;
  amountMinor: number;
  approvedAt: string;
}

export interface PointPaymentModalProps {
  isOpen: boolean;
  totalMinor: number;
  terminalName?: string;
  onCancel: () => void;
  onConfirm: (voucher: PointVoucher) => void;
  onReject?: (reason: string) => void;
  autoSimulateDelayMs?: number | null; // e.g. 1600ms, or null for manual interactive simulation
}

export function PointPaymentModal({
  isOpen,
  totalMinor,
  terminalName = 'Terminal Mostrador 01 (Point Smart)',
  onCancel,
  onConfirm,
  onReject,
  autoSimulateDelayMs = null, // Default to null so developer/cashier can interactively test card scenarios
}: PointPaymentModalProps) {
  const [phase, setPhase] = useState<'sending' | 'approved' | 'rejected'>('sending');
  const [rejectReason, setRejectReason] = useState<'insufficient_funds' | 'declined'>('insufficient_funds');
  const [voucher, setVoucher] = useState<PointVoucher | null>(null);
  const [simulatedBalance, setSimulatedBalance] = useState<string>('500');

  useEffect(() => {
    if (!isOpen) {
      setPhase('sending');
      setVoucher(null);
      setSimulatedBalance('500');
      return;
    }

    if (autoSimulateDelayMs !== null) {
      const timer = setTimeout(() => {
        const approvedVoucher: PointVoucher = {
          authorizationCode: `AUTH-${Math.floor(100000 + Math.random() * 900000)}`,
          cardBrand: 'VISA',
          lastFourDigits: '4242',
          terminalName,
          amountMinor: totalMinor,
          approvedAt: new Date().toISOString(),
        };
        setVoucher(approvedVoucher);
        setPhase('approved');
      }, autoSimulateDelayMs);

      return () => clearTimeout(timer);
    }
  }, [isOpen, autoSimulateDelayMs, terminalName, totalMinor]);

  if (!isOpen) return null;

  function handleManualApprove() {
    const approvedVoucher: PointVoucher = {
      authorizationCode: `AUTH-${Math.floor(100000 + Math.random() * 900000)}`,
      cardBrand: 'VISA',
      lastFourDigits: '4242',
      terminalName,
      amountMinor: totalMinor,
      approvedAt: new Date().toISOString(),
    };
    setVoucher(approvedVoucher);
    setPhase('approved');
  }

  function handleTriggerReject(reason: 'insufficient_funds' | 'declined') {
    setRejectReason(reason);
    setPhase('rejected');
  }

  function handleSwipeCard() {
    const parsed = parseFloat(simulatedBalance);
    const balanceMinor = isNaN(parsed) ? 0 : Math.round(parsed * 100);

    if (balanceMinor < totalMinor) {
      handleTriggerReject('insufficient_funds');
    } else {
      handleManualApprove();
    }
  }

  function handleFinalize() {
    if (voucher) {
      onConfirm(voucher);
    }
  }

  function handleNotifyRejection() {
    const message =
      rejectReason === 'insufficient_funds'
        ? 'Fondos insuficientes en la tarjeta'
        : 'Tarjeta declinada por la entidad bancaria';
    onReject?.(message);
    onCancel();
  }

  return (
    <div
      className="point-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="point-modal-title"
    >
      <div className="point-modal-card">
        {phase === 'sending' && (
          <>
            <div className="point-header-icon-box">
              <div className="point-icon-pulse" aria-hidden="true">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <line x1="2" x2="22" y1="10" y2="10" />
                </svg>
              </div>
            </div>

            <div>
              <h2 id="point-modal-title" className="point-modal-title">
                Esperando tarjeta en la terminal Point...
              </h2>
              <p className="point-modal-desc" style={{ marginTop: '6px' }}>
                Acerca, inserta o desliza la tarjeta en la terminal Mercado Pago.
              </p>
            </div>

            <div className="point-terminal-pill">
              <span className="point-indicator-dot" aria-hidden="true" />
              <span>{terminalName}</span>
            </div>

            <p className="point-amount-display">{formatMoney(totalMinor)} MXN</p>

            {/* Interactive Card & Balance Simulator Box */}
            <div className="point-simulator-box">
              <div className="point-simulator-header">
                <span className="point-sim-badge">SIMULADOR DEV</span>
                <span style={{ fontSize: '13px', fontWeight: 700 }}>Probar Tarjeta Bancaria</span>
              </div>

              <div style={{ margin: '10px 0', textAlign: 'left' }}>
                <label
                  htmlFor="point-sim-balance"
                  style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-muted)', marginBottom: '4px' }}
                >
                  Saldo disponible en la tarjeta (MXN):
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    id="point-sim-balance"
                    type="number"
                    step="1"
                    min="0"
                    value={simulatedBalance}
                    onChange={e => setSimulatedBalance(e.target.value)}
                    placeholder="Ej. 500"
                    aria-label="Saldo disponible en la tarjeta"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-divider)',
                      background: 'var(--color-canvas)',
                      color: 'var(--color-ink)',
                      fontSize: '14px',
                      fontWeight: 700,
                    }}
                  />
                  <Button
                    variant="primary"
                    onClick={handleSwipeCard}
                    style={{ whiteSpace: 'nowrap', padding: '8px 14px' }}
                  >
                    💳 Pasar tarjeta
                  </Button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '6px' }}>
                <button
                  type="button"
                  className="button button-ghost"
                  style={{ fontSize: '11px', color: '#15803D', padding: '4px 8px' }}
                  onClick={() => {
                    setSimulatedBalance(String(Math.ceil(totalMinor / 100) + 100));
                    handleManualApprove();
                  }}
                >
                  🟢 Saldo suficiente (${Math.ceil(totalMinor / 100) + 100})
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  style={{ fontSize: '11px', color: '#DC2626', padding: '4px 8px' }}
                  onClick={() => {
                    setSimulatedBalance('0');
                    handleTriggerReject('insufficient_funds');
                  }}
                >
                  🔴 Sin saldo ($0.00)
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  style={{ fontSize: '11px', color: '#B45309', padding: '4px 8px' }}
                  onClick={() => handleTriggerReject('declined')}
                >
                  ⚠️ Chip dañado / Declinada
                </button>
              </div>
            </div>

            <div className="point-modal-actions">
              <Button
                variant="secondary"
                className="point-cancel-btn"
                onClick={onCancel}
              >
                Cancelar cobro en terminal
              </Button>
            </div>
          </>
        )}

        {phase === 'rejected' && (
          <>
            <div className="point-header-icon-box">
              <div className="point-icon-error" aria-hidden="true">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
            </div>

            <div>
              <h2 id="point-modal-title" className="point-modal-title" style={{ color: '#DC2626' }}>
                {rejectReason === 'insufficient_funds'
                  ? 'Cobro Rechazado: Fondos Insuficientes'
                  : 'Cobro Rechazado: Tarjeta Declinada'}
              </h2>
              <p className="point-modal-desc" style={{ marginTop: '8px' }}>
                {rejectReason === 'insufficient_funds'
                  ? `La tarjeta cuenta con ${formatMoney(Math.round((parseFloat(simulatedBalance) || 0) * 100))} MXN y se requieren ${formatMoney(totalMinor)} MXN.`
                  : 'La entidad bancaria rechazó la transacción por chip ilegible o tarjeta vencida.'}
              </p>
            </div>

            <div className="point-reject-hint-card">
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-ink)' }}>
                <strong>Acción recomendada en recepción:</strong> Solicita al cliente otra tarjeta bancaria o sugiere realizar el pago en efectivo.
              </p>
            </div>

            <div className="point-modal-actions">
              <Button
                variant="secondary"
                onClick={() => setPhase('sending')}
              >
                🔄 Probar con otra tarjeta
              </Button>
              <Button
                variant="primary"
                onClick={handleNotifyRejection}
              >
                Salir y cambiar método de cobro
              </Button>
            </div>
          </>
        )}

        {phase === 'approved' && (
          <>
            <div className="point-header-icon-box">
              <div className="point-icon-success" aria-hidden="true">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>

            <div>
              <h2 id="point-modal-title" className="point-modal-title" style={{ color: '#15803D' }}>
                ¡Cobro Aprobado en Terminal!
              </h2>
              <p className="point-modal-desc">
                Transacción autorizada con éxito por Mercado Pago Point.
              </p>
            </div>

            {/* Voucher data card */}
            <div className="point-voucher-ticket">
              <div className="point-voucher-row">
                <span className="point-voucher-label">Total cobrado:</span>
                <strong className="point-voucher-value" style={{ color: 'var(--color-primary)', fontSize: '16px' }}>
                  {formatMoney(totalMinor)} MXN
                </strong>
              </div>
              <div className="point-voucher-row">
                <span className="point-voucher-label">Folio de autorización:</span>
                <strong className="point-voucher-value">{voucher?.authorizationCode}</strong>
              </div>
              <div className="point-voucher-row">
                <span className="point-voucher-label">Tarjeta:</span>
                <strong className="point-voucher-value">{voucher?.cardBrand} (**** {voucher?.lastFourDigits})</strong>
              </div>
              <div className="point-voucher-row">
                <span className="point-voucher-label">Terminal:</span>
                <span className="point-voucher-value" style={{ fontSize: '12px' }}>{voucher?.terminalName}</span>
              </div>
            </div>

            <div className="point-modal-actions">
              <Button
                variant="primary"
                onClick={handleFinalize}
                autoFocus
              >
                Finalizar compra con Voucher
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
