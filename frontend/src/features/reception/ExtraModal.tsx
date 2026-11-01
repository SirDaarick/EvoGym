import React, { useEffect, useRef, useState } from 'react';
import type { ExtraRecord } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { registerExtra } from '../../demo/extraOperations';
import { Button } from '../../shared/ui';
import SwipeToast from '../catalog/react-bits/SwipeToast';
import { createCashContribution, listCashContributions, ExpenseApiError, type CashContributionDTO, type CashContributionInput } from '../../api/expensesApi';
import type { ApiRequest } from '../../api/shiftsApi';

export interface ExtraModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiRequest?: ApiRequest;
  registerId?: string;
}

export function ExtraModal({ isOpen, onClose, apiRequest, registerId }: ExtraModalProps) {
  let demo: ReturnType<typeof useDemo> | null = null;
  try { demo = useDemo(); } catch { /* Live mode does not mount DemoProvider. */ }
  const [liveExtras, setLiveExtras] = useState<CashContributionDTO[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const pendingKey = useRef<string | null>(null);
  const pendingBody = useRef<CashContributionInput | null>(null);
  const pendingRegister = useRef<string | null>(null);
  const inFlight = useRef(false);

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
    if (isOpen && !pendingKey.current) {
      setConcept('');
      setStaffName('');
      setAmountStr('');
      setToast(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !apiRequest || !registerId) return;
    let active = true;
    listCashContributions(apiRequest, registerId).then(page => { if (active) setLiveExtras(page.items); })
      .catch(() => { if (active) setToast({ open: true, title: 'Error', description: 'No se pudo cargar el historial de extras.', type: 'error' }); });
    return () => { active = false; };
  }, [isOpen, apiRequest, registerId]);

  if (!isOpen) return null;

  const currentShiftExtras = apiRequest && registerId
    ? liveExtras.map(item => ({ id: item.id, concept: item.concept, staffName: item.contributor_name, amountMinor: item.amount_minor, recordedAt: item.recorded_at }))
    : (demo?.state.extras ?? []).filter(e => e.shiftId === demo?.state.currentShiftId);
  const totalShiftExtrasMinor = currentShiftExtras.reduce((acc, e) => acc + e.amountMinor, 0);

  async function handleSubmit(e: React.FormEvent) {
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

    if (apiRequest && registerId) {
      if (inFlight.current) return;
      const body = { concept: concept.trim(), contributor_name: staffName.trim(), amount_minor: amountMinor };
      if (pendingBody.current && (pendingRegister.current !== registerId || JSON.stringify(body) !== JSON.stringify(pendingBody.current))) {
        setToast({ open: true, title: 'Resultado pendiente', description: 'Reintenta el extra con los mismos datos para confirmar su resultado.', type: 'warning' });
        return;
      }
      inFlight.current = true;
      setSubmitting(true);
      const key = pendingKey.current ?? crypto.randomUUID();
      pendingKey.current = key;
      pendingBody.current = body;
      pendingRegister.current = registerId;
      try {
        await createCashContribution(apiRequest, registerId, body, key);
        pendingKey.current = null;
        pendingBody.current = null;
        pendingRegister.current = null;
        setConcept(''); setStaffName(''); setAmountStr('');
        try {
          const page = await listCashContributions(apiRequest, registerId);
          setLiveExtras(page.items);
          setToast({ open: true, title: 'Extra registrado', description: `Extra de ${formatMoney(amountMinor)} MXN registrado correctamente.`, type: 'success' });
        } catch {
          setToast({ open: true, title: 'Extra registrado', description: 'El extra se registró, pero no se pudo actualizar el historial.', type: 'warning' });
        }
      } catch (error) {
        if (error instanceof ExpenseApiError && [401, 403, 422].includes(error.status)) { pendingKey.current = null; pendingBody.current = null; pendingRegister.current = null; }
        setToast({ open: true, title: 'Error al registrar', description: error instanceof Error ? error.message : 'No se pudo registrar el extra.', type: 'error' });
      } finally { inFlight.current = false; setSubmitting(false); }
      return;
    }
    if (!demo) return;
    const extraId = `extra-${crypto.randomUUID()}`;
    const result = demo.transact(current =>
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
              <Button variant="primary" type="submit" disabled={submitting}>
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
