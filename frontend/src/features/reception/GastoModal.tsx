import React, { useEffect, useState } from 'react';
import type { ExpenseRecord } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { registerExpense } from '../../demo/expenseOperations';
import { Button } from '../../shared/ui';
import SwipeToast from '../catalog/react-bits/SwipeToast';

export interface GastoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GastoModal({ isOpen, onClose }: GastoModalProps) {
  const { state, transact } = useDemo();
  const expenses = state.expenses ?? [];

  const [concept, setConcept] = useState('');
  const [payeeName, setPayeeName] = useState('');
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
      setPayeeName('');
      setAmountStr('');
      setToast(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentShiftExpenses = expenses.filter(e => e.shiftId === state.currentShiftId);
  const totalShiftExpensesMinor = currentShiftExpenses.reduce((acc, e) => acc + e.amountMinor, 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountMinor = parseMoney(amountStr);

    if (!concept.trim()) {
      setToast({
        open: true,
        title: 'Concepto requerido',
        description: 'Escribe el concepto del gasto.',
        type: 'error',
      });
      return;
    }

    if (!payeeName.trim()) {
      setToast({
        open: true,
        title: 'Nombre requerido',
        description: 'Escribe el nombre del proveedor o persona responsable.',
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

    const expenseId = `expense-${crypto.randomUUID()}`;
    const result = transact(current =>
      registerExpense(current, {
        id: expenseId,
        concept: concept.trim(),
        payeeName: payeeName.trim(),
        amountMinor,
      })
    );

    if (result.status === 'recorded') {
      const msg = `Gasto de ${formatMoney(amountMinor)} MXN registrado correctamente.`;
      setConcept('');
      setPayeeName('');
      setAmountStr('');
      setToast({
        open: true,
        title: 'Gasto registrado',
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
      aria-labelledby="gasto-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="staff-modal-card op-flow-modal-card">
        {/* Header */}
        <div className="guantes-modal-header">
          <div className="guantes-modal-title-group">
            <h2 id="gasto-modal-title">Registrar Gasto</h2>
            <p className="muted">Salidas de efectivo imprevistas o compras directas de caja durante el turno</p>
          </div>
          <button
            type="button"
            className="guantes-close-btn"
            aria-label="Cerrar modal de gasto"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Form Inputs (Sketch: Concepto, Nombre, Saldo, Agregar) */}
        <form onSubmit={handleSubmit} className="op-flow-form">
          <div className="op-flow-inputs-row">
            <div className="field" style={{ flex: 2 }}>
              <label htmlFor="gasto-concept-input">Concepto *</label>
              <input
                id="gasto-concept-input"
                type="text"
                placeholder="Ej. Garrafón de agua, insumos de limpieza"
                value={concept}
                onChange={e => setConcept(e.target.value)}
                required
              />
            </div>

            <div className="field" style={{ flex: 1.5 }}>
              <label htmlFor="gasto-payee-input">Nombre *</label>
              <input
                id="gasto-payee-input"
                type="text"
                placeholder="Proveedor o responsable"
                value={payeeName}
                onChange={e => setPayeeName(e.target.value)}
                required
              />
            </div>

            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="gasto-amount-input">Saldo / Monto *</label>
              <input
                id="gasto-amount-input"
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

        {/* History Container (Sketch: Historial de gastos registrados durante el turno) */}
        <div className="op-flow-history-section">
          <div className="op-flow-history-header">
            <h3>Historial de gastos registrados durante el turno</h3>
            <span className="op-flow-total-badge">
              Total salidas: <strong>{formatMoney(totalShiftExpensesMinor)} MXN</strong>
            </span>
          </div>

          {!currentShiftExpenses.length ? (
            <p className="cart-empty-msg" style={{ padding: '24px 0' }}>
              No hay gastos registrados en el turno activo.
            </p>
          ) : (
            <div className="op-flow-table-wrap">
              <table className="op-flow-table">
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th>Responsable / Proveedor</th>
                    <th>Hora</th>
                    <th style={{ textAlign: 'right' }}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {currentShiftExpenses.map(expense => (
                    <tr key={expense.id}>
                      <td><strong>{expense.concept}</strong></td>
                      <td>{expense.payeeName}</td>
                      <td className="muted">
                        {new Date(expense.recordedAt).toLocaleTimeString('es-MX', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td style={{ textAlign: 'right', color: '#dc2626', fontWeight: 700 }}>
                        −{formatMoney(expense.amountMinor)} MXN
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
