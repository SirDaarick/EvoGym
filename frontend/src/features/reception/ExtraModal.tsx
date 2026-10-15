import React, { useEffect, useState } from 'react';
import type { ExtraRecord } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { registerExtra } from '../../demo/extraOperations';
import { Button } from '../../shared/ui';
import SwipeToast from '../catalog/react-bits/SwipeToast';

export interface ExtraModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExtraModal({ isOpen, onClose }: ExtraModalProps) {
  const { state, transact } = useDemo();
  const extras = state.extras ?? [];

  const [concept, setConcept] = useState('');
  const [staffName, setStaffName] = useState('');
  const [amountStr, setAmountStr] = useState('');

  const [toast, setToast] = useState<{
    open: boolean;
    title: string;
    description: string;
    type: 'success' | 'error' | 'warning';
  } | null>(null);

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

  useEffect(() => {
    if (isOpen) {
      setConcept('');
      setStaffName('');
      setAmountStr('');
      setToast(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentShiftExtras = extras.filter(e => e.shiftId === state.currentShiftId);
  const totalShiftExtrasMinor = currentShiftExtras.reduce((acc, e) => acc + e.amountMinor, 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountMinor = parseMoney(amountStr);

    if (!concept.trim()) {
      setToast({
        open: true,
        title: 'Concepto requerido',
        description: 'Escribe el concepto o motivo del dinero extra.',
        type: 'error',
      });
      return;
    }

    if (!staffName.trim()) {
      setToast({
        open: true,
        title: 'Nombre requerido',
        description: 'Escribe el nombre de la recepcionista o persona que aportó el cambio.',
        type: 'error',
      });
      return;
    }

    if (!amountMinor || amountMinor <= 0) {
      setToast({
        open: true,
        title: 'Monto inválido',
        description: 'Ingresa un monto numérico válido mayor a $0.00.',
        type: 'error',
      });
      return;
    }

    const extraId = `extra-${crypto.randomUUID()}`;
    const result = transact(current =>
      registerExtra(current, {
        id: extraId,
        concept: concept.trim(),
        staffName: staffName.trim(),
        amountMinor,
      })
    );

    if (result.status === 'recorded') {
      const msg = `Extra de ${formatMoney(amountMinor)} MXN registrado correctamente.`;
      setConcept('');
      setStaffName('');
      setAmountStr('');
      setToast({
        open: true,
        title: 'Extra registrado',
        description: msg,
        type: 'success',
      });
    } else if (result.status === 'error') {
      setToast({
        open: true,
        title: 'Error al registrar',
        description: result.message,
        type: 'error',
      });
    }
  }

  return (
    <div
      className="staff-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extra-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="staff-modal-card op-flow-modal-card">
        {/* Header */}
        <div className="guantes-modal-header">
          <div className="guantes-modal-title-group">
            <h2 id="extra-modal-title">Registrar Extra</h2>
            <p className="muted">Registro de cambio aportado por recepción por falta de feria en caja</p>
          </div>
          <button
            type="button"
            className="guantes-close-btn"
            aria-label="Cerrar modal de extra"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Form Inputs (Sketch: Concepto, Nombre, Saldo, Agregar) */}
        <form onSubmit={handleSubmit} className="op-flow-form">
          <div className="op-flow-inputs-row">
            <div className="field" style={{ flex: 2 }}>
              <label htmlFor="extra-concept-input">Concepto *</label>
              <input
                id="extra-concept-input"
                type="text"
                placeholder="Ej. Cambio para cliente, feria propia en caja"
                value={concept}
                onChange={e => setConcept(e.target.value)}
                required
              />
            </div>

            <div className="field" style={{ flex: 1.5 }}>
              <label htmlFor="extra-staff-input">Nombre *</label>
              <input
                id="extra-staff-input"
                type="text"
                placeholder="Persona que aportó el dinero"
                value={staffName}
                onChange={e => setStaffName(e.target.value)}
                required
              />
            </div>

            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="extra-amount-input">Saldo / Monto *</label>
              <input
                id="extra-amount-input"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amountStr}
                onChange={e => setAmountStr(e.target.value)}
                required
              />
            </div>

            <div className="op-flow-submit-wrap">
              <Button variant="primary" type="submit">
                Agregar
              </Button>
            </div>
          </div>
        </form>

        {/* History Container (Sketch: Historial de extras registrados durante el turno) */}
        <div className="op-flow-history-section">
          <div className="op-flow-history-header">
            <h3>Historial de extras registrados durante el turno</h3>
            <span className="op-flow-total-badge" style={{ color: '#175D3B', background: '#EAF6EE' }}>
              Total aportado: <strong>{formatMoney(totalShiftExtrasMinor)} MXN</strong>
            </span>
          </div>

          {!currentShiftExtras.length ? (
            <p className="cart-empty-msg" style={{ padding: '24px 0' }}>
              No hay extras registrados en el turno activo.
            </p>
          ) : (
            <div className="op-flow-table-wrap">
              <table className="op-flow-table">
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th>Aportado por</th>
                    <th>Hora</th>
                    <th style={{ textAlign: 'right' }}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {currentShiftExtras.map(extra => (
                    <tr key={extra.id}>
                      <td><strong>{extra.concept}</strong></td>
                      <td>{extra.staffName}</td>
                      <td className="muted">
                        {new Date(extra.recordedAt).toLocaleTimeString('es-MX', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td style={{ textAlign: 'right', color: '#175D3B', fontWeight: 700 }}>
                        +{formatMoney(extra.amountMinor)} MXN
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* SwipeToast interactive notification */}
      {toast && (
        <div className="reception-toast-wrapper">
          <SwipeToast
            open={toast.open}
            title={toast.title}
            description={toast.description}
            duration={3200}
            fuse={toast.type === 'error' ? 'none' : 'bottom'}
            closeButton
            closeLabel="Cerrar notificación"
            background="var(--color-surface)"
            color="var(--color-ink)"
            fuseColor={
              toast.type === 'error'
                ? 'var(--catalog-field-error, #A32222)'
                : 'var(--color-primary)'
            }
            onClose={() => setToast(null)}
          />
        </div>
      )}
    </div>
  );
}
