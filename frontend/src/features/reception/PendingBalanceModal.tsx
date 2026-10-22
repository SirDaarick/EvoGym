import { useEffect } from 'react';
import { formatMoney } from '../../demo/adapter';
import { Button, Notice, Panel } from '../../shared/ui';

export interface PendingBalanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  totalMinor: number;
  coveredMinor: number;
  shortfallMinor: number;
  memberName: string;
  disabled?: boolean;
}

export function PendingBalanceModal({
  isOpen,
  onClose,
  onConfirm,
  totalMinor,
  coveredMinor,
  shortfallMinor,
  memberName,
  disabled = false,
}: PendingBalanceModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-card"
        style={{ maxWidth: '480px', width: '92vw' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-modal-title"
      >
        <Panel>
          <div className="modal-header">
            <h2 id="pending-modal-title" style={{ margin: 0, fontSize: '18px' }}>
              Confirmar saldo pendiente
            </h2>
            <button
              type="button"
              className="modal-close-btn"
              aria-label="Cerrar modal de saldo pendiente"
              onClick={onClose}
            >
              ×
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBlock: '16px' }}>
            <Notice tone="warning">
              El pago no cubre el total de la compra. La cantidad faltante se asignará como saldo pendiente a la cuenta del socio.
            </Notice>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                padding: '12px',
                borderRadius: '10px',
                background: 'var(--color-canvas)',
                border: '1px solid var(--color-divider)',
                fontSize: '13px',
              }}
            >
              <span className="muted">Total de compra:</span>
              <strong style={{ textAlign: 'right' }}>{formatMoney(totalMinor)} MXN</strong>

              <span className="muted">Monto cubierto ahora:</span>
              <strong style={{ textAlign: 'right', color: '#175D3B' }}>{formatMoney(coveredMinor)} MXN</strong>

              <span className="muted">Saldo pendiente por asignar:</span>
              <strong style={{ textAlign: 'right', color: 'var(--color-primary)' }}>
                {formatMoney(shortfallMinor)} MXN
              </strong>

              <span className="muted">Socio asignado:</span>
              <strong style={{ textAlign: 'right' }}>{memberName}</strong>
            </div>

            <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-muted)' }}>
              ¿Deseas registrar esta compra asignando los <strong>{formatMoney(shortfallMinor)} MXN</strong> a la cuenta de <strong>{memberName}</strong>?
            </p>
          </div>

          <div className="flow" style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
            <Button
              className="confirm-pending-shortfall-btn"
              disabled={disabled}
              onClick={() => {
                onConfirm();
                onClose();
              }}
            >
              Confirmar y asignar pendiente
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
