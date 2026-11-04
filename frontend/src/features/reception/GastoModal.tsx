import { formatMoney, parseMoney } from '@/shared/formatters/money';
import { EXPENSE_CATEGORIES } from '@/domain/expenses';
import React, { useEffect, useRef, useState } from 'react';
import type { ExpenseRecord } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { registerExpense } from '../../demo/expenseOperations';
import { Badge, Button } from '../../shared/ui';
import SwipeToast from '../catalog/react-bits/SwipeToast';
import { createBusinessExpense, createShiftExpense, listShiftExpenses, requestEvidenceUpload, uploadEvidence, voidExpense, ExpenseApiError, type ExpenseCategory, type ExpenseDTO, type ExpenseInput, type ExpenseMethod } from '../../api/expensesApi';
import type { ApiRequest } from '../../api/shiftsApi';
import { compressToWebp } from '../../shared/compressToWebp';

export interface GastoModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiRequest?: ApiRequest;
  registerId?: string;
  branchId?: string;
  mode?: 'shift' | 'business';
  branches?: { id: string; name: string }[];
  onSaved?: () => void | Promise<void>;
}

export function GastoModal({ isOpen, onClose, apiRequest, registerId, branchId, mode = 'shift', branches = [], onSaved }: GastoModalProps) {
  let demo: ReturnType<typeof useDemo> | null = null;
  try { demo = useDemo(); } catch { /* Live mode does not mount DemoProvider. */ }
  const [liveExpenses, setLiveExpenses] = useState<ExpenseDTO[]>([]);
  const [category, setCategory] = useState<ExpenseCategory | ''>('');
  const [voucher, setVoucher] = useState('');
  const [businessBranch, setBusinessBranch] = useState('');
  const [method, setMethod] = useState<ExpenseMethod>('cash');
  const [photo, setPhoto] = useState<File | null>(null);
  const [voidTarget, setVoidTarget] = useState<ExpenseDTO | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pendingKey = useRef<string | null>(null);
  const pendingBody = useRef<ExpenseInput | null>(null);
  const pendingDraft = useRef<string | null>(null);
  const pendingPhoto = useRef<File | null>(null);
  const inFlight = useRef(false);

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
    if (isOpen && !pendingKey.current) {
      setConcept('');
      setPayeeName('');
      setAmountStr('');
      setCategory('');
      setVoucher('');
      setPhoto(null);
      setToast(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !apiRequest || !registerId || mode !== 'shift') return;
    let active = true;
    listShiftExpenses(apiRequest, registerId).then(page => { if (active) setLiveExpenses(page.items); })
      .catch(() => { if (active) setToast({ open: true, title: 'Error', description: 'No se pudo cargar el historial de gastos.', type: 'error' }); });
    return () => { active = false; };
  }, [isOpen, apiRequest, registerId, mode]);

  if (!isOpen) return null;

  const currentShiftExpenses = apiRequest && registerId
    ? liveExpenses.map(item => ({ id: item.id, concept: item.concept, payeeName: item.payee_name, amountMinor: item.amount_minor, recordedAt: item.recorded_at, voided: Boolean(item.voided_at), category: item.category, voucherReference: item.voucher_reference, evidenceUrl: item.evidence_url }))
    : (demo?.state.expenses ?? []).filter(e => e.shiftId === demo?.state.currentShiftId).map(item => ({ ...item, voided: false, evidenceUrl: null }));
  const totalShiftExpensesMinor = currentShiftExpenses.reduce((acc, e) => acc + (e.voided ? 0 : e.amountMinor), 0);

  async function handleSubmit(e: React.FormEvent) {
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
    if (!category) return;

    if (apiRequest && (registerId || mode === 'business')) {
      if (mode === 'business' && !businessBranch) return;
      if (inFlight.current) return;
      const draft = JSON.stringify({ category, concept: concept.trim(), payeeName: payeeName.trim(), amountMinor, voucher: voucher.trim(), mode, registerId, branch: mode === 'business' ? businessBranch : branchId, method: mode === 'business' ? method : 'cash' });
      if (pendingDraft.current && (pendingDraft.current !== draft || pendingPhoto.current !== photo)) {
        setToast({ open: true, title: 'Resultado pendiente', description: 'Reintenta el gasto con los mismos datos para confirmar su resultado.', type: 'warning' });
        return;
      }
      inFlight.current = true;
      setSubmitting(true);
      const key = pendingKey.current ?? crypto.randomUUID();
      pendingKey.current = key;
      pendingDraft.current = draft;
      pendingPhoto.current = photo;
      try {
        let photoUnavailable = false;
        if (!pendingBody.current) {
          let evidenceKey: string | undefined;
          if (photo) {
            const targetBranch = mode === 'business' ? businessBranch : branchId;
            if (!targetBranch) throw new Error('No se pudo identificar la sucursal.');
            const image = await compressToWebp(photo);
            try {
              const upload = await requestEvidenceUpload(apiRequest, targetBranch, image.size);
              await uploadEvidence(image, upload.upload_url);
              evidenceKey = upload.evidence_key;
            } catch (error) {
              if (error instanceof ExpenseApiError && error.status === 501) photoUnavailable = true;
              else throw error;
            }
          }
          pendingBody.current = { category, concept: concept.trim(), payee_name: payeeName.trim(), amount_minor: amountMinor, voucher_reference: voucher.trim() || null, ...(evidenceKey ? { evidence_key: evidenceKey } : {}) };
        }
        if (mode === 'business') await createBusinessExpense(apiRequest, { ...pendingBody.current, branch_id: businessBranch, payment_method: method }, key);
        else await createShiftExpense(apiRequest, registerId!, pendingBody.current, key);
        pendingKey.current = null;
        pendingBody.current = null;
        pendingDraft.current = null;
        pendingPhoto.current = null;
        setConcept(''); setPayeeName(''); setAmountStr(''); setVoucher(''); setCategory('');
        setPhoto(null);
        try {
          if (mode === 'business') await onSaved?.();
          else setLiveExpenses((await listShiftExpenses(apiRequest, registerId!)).items);
          setToast({ open: true, title: 'Gasto registrado', description: photoUnavailable ? 'Foto no disponible; se guarda sin foto' : `Gasto de ${formatMoney(amountMinor)} MXN registrado correctamente.`, type: photoUnavailable ? 'warning' : 'success' });
        } catch {
          setToast({ open: true, title: 'Gasto registrado', description: 'El gasto se registró, pero no se pudo actualizar el historial.', type: 'warning' });
        }
      } catch (error) {
        if (error instanceof ExpenseApiError && [401, 403, 422].includes(error.status)) {
          pendingKey.current = null; pendingBody.current = null; pendingDraft.current = null; pendingPhoto.current = null;
        }
        setToast({ open: true, title: 'Error al registrar', description: error instanceof Error ? error.message : 'No se pudo registrar el gasto.', type: 'error' });
      } finally { inFlight.current = false; setSubmitting(false); }
      return;
    }
    if (!demo) return;
    const expenseId = `expense-${crypto.randomUUID()}`;
    const result = demo.transact(current =>
      registerExpense(current, {
        id: expenseId,
        concept: concept.trim(),
        payeeName: payeeName.trim(),
        amountMinor,
        category,
        voucherReference: voucher.trim(),
      })
    );

    if (result.status === 'recorded') {
      const msg = `Gasto de ${formatMoney(amountMinor)} MXN registrado correctamente.`;
      setConcept('');
      setPayeeName('');
      setAmountStr('');
      setVoucher('');
      setCategory('');
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

            <div className="field"><label htmlFor="gasto-category">Categoría *</label>
              <select id="gasto-category" value={category} onChange={event => setCategory(event.target.value as ExpenseCategory)} required>
                <option value="">Selecciona una categoría</option>
                {Object.values(EXPENSE_CATEGORIES).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </div>
            {mode === 'business' && <><div className="field"><label htmlFor="gasto-branch">Sucursal *</label>
              <select id="gasto-branch" value={businessBranch} onChange={event => setBusinessBranch(event.target.value)} required><option value="">Selecciona una sucursal</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>
            </div><div className="field"><label htmlFor="gasto-method">Método de pago *</label>
              <select id="gasto-method" value={method} onChange={event => setMethod(event.target.value as ExpenseMethod)}><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="card">Tarjeta</option></select>
            </div></>}

            <div className="op-flow-submit-wrap">
              <Button variant="primary" type="submit" disabled={submitting}>
                Agregar
              </Button>
            </div>
          </div>
          <div className="op-flow-inputs-row"><div className="field"><label htmlFor="gasto-voucher">Folio o ticket</label>
            <input id="gasto-voucher" value={voucher} maxLength={120} onChange={event => setVoucher(event.target.value)} />
          </div>{apiRequest && <div className="field"><label htmlFor="gasto-photo">Foto del ticket</label>
            <input id="gasto-photo" type="file" accept="image/*" capture="environment" onChange={event => setPhoto(event.target.files?.[0] ?? null)} />
          </div>}</div>
        </form>

        {/* History Container (Sketch: Historial de gastos registrados durante el turno) */}
        {mode === 'shift' && <div className="op-flow-history-section">
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
                    <th>Categoría</th><th>Comprobante</th><th>Estado</th>
                    <th>Hora</th>
                    <th style={{ textAlign: 'right' }}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {currentShiftExpenses.map(expense => (
                    <tr key={expense.id}>
                      <td><strong>{expense.concept}</strong></td>
                      <td>{expense.payeeName}</td>
                      <td>{expense.category ? EXPENSE_CATEGORIES[expense.category].label : '—'}</td>
                      <td>{expense.voucherReference || '—'} {expense.evidenceUrl && <a href={expense.evidenceUrl} target="_blank" rel="noreferrer">Ver foto</a>}</td>
                      <td>{expense.voided ? <Badge tone="warning">Anulado</Badge> : apiRequest && <button type="button" onClick={() => { setVoidTarget(liveExpenses.find(item => item.id === expense.id) ?? null); setVoidReason(''); }}>Anular</button>}</td>
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
        </div>}
      </div>

      {voidTarget && <div className="staff-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="void-expense-title">
        <div className="staff-modal-card"><h2 id="void-expense-title">Anular gasto</h2>
          <p>{voidTarget.concept} · {formatMoney(voidTarget.amount_minor)} MXN</p>
          <form onSubmit={async event => {
            event.preventDefault();
            if (!apiRequest || !registerId || !voidReason.trim()) return;
            try {
              await voidExpense(apiRequest, voidTarget.id, voidReason.trim());
              setVoidTarget(null);
              setLiveExpenses((await listShiftExpenses(apiRequest, registerId)).items);
            } catch (error) { setToast({ open: true, title: 'Error al anular', description: error instanceof Error ? error.message : 'No se pudo anular el gasto.', type: 'error' }); }
          }}><div className="field"><label htmlFor="void-expense-reason">Motivo *</label><textarea id="void-expense-reason" required value={voidReason} onChange={event => setVoidReason(event.target.value)} /></div>
            <Button type="submit">Confirmar anulación</Button><Button variant="secondary" onClick={() => setVoidTarget(null)}>Cancelar</Button>
          </form></div>
      </div>}

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
