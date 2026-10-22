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
  autoSimulateDelayMs?: number | null; // e.g. 1800ms to simulate Point connection, or null for manual
}

export function PointPaymentModal({
  isOpen,
  totalMinor,
  terminalName = 'Terminal Mostrador 01 (Point Smart)',
  onCancel,
  onConfirm,
  autoSimulateDelayMs = 1600,
}: PointPaymentModalProps) {
  const [phase, setPhase] = useState<'sending' | 'approved'>('sending');
  const [voucher, setVoucher] = useState<PointVoucher | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPhase('sending');
      setVoucher(null);
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

  function handleFinalize() {
    if (voucher) {
      onConfirm(voucher);
    }
  }

  return (
    <div
      className="point-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="point-modal-title"
    >
      <div className="point-modal-card">
        {phase === 'sending' ? (
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
                Enviando cobro de {formatMoney(totalMinor)} a la terminal Point...
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

            <div className="point-modal-actions">
              <Button
                variant="secondary"
                className="point-cancel-btn"
                onClick={onCancel}
              >
                Cancelar cobro en terminal
              </Button>
              <button
                type="button"
                className="button button-ghost"
                style={{ fontSize: '11px', color: 'var(--color-muted)' }}
                onClick={handleManualApprove}
              >
                [Simulación]: Aprobar pago en terminal ahora →
              </button>
            </div>
          </>
        ) : (
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
