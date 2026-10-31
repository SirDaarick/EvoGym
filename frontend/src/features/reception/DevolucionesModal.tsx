import React, { useEffect, useState } from 'react';
import type { DemoState, Member } from '../../domain/models';
import { formatMoney } from '../../demo/adapter';
import {
  getEligibleReturnsForMember,
  processReturn,
  type EligibleReturnItem,
  type ReturnOperationResult,
  type ReturnTargetType,
} from '../../demo/returnOperations';
import { Badge, Button, Notice, type Tone } from '../../shared/ui';
import type { AuthenticatedRequest } from '../../api/inventoryApi';
import {
  listEligibleProductReturns,
  submitProductReturn,
  type EligibleProductReturn,
} from '../../api/productSalesApi';

export interface DevolucionesModalProps {
  isOpen: boolean;
  onClose: () => void;
  state?: DemoState;
  initialMemberId?: string | null;
  onSuccess: (result: { message: string; refundedAmountMinor: number }) => void;
  transact?: <T>(update: (state: DemoState) => { state: DemoState; result: T }) => T;
  apiRequest?: AuthenticatedRequest;
  registerId?: string;
}

const TYPE_LABELS: Record<string, string> = {
  product: 'Producto',
  supplement: 'Suplemento',
  membership: 'Membresía',
  locker: 'Casillero',
  glove: 'Guantes',
};

const TYPE_TONES: Record<string, Tone> = {
  product: 'neutral',
  supplement: 'warning',
  membership: 'success',
  locker: 'neutral',
  glove: 'warning',
};

interface DisplayItem {
  id: string;
  type: ReturnTargetType;
  title: string;
  amountMinor: number;
  originalMethod: 'cash' | 'card';
}

export function DevolucionesModal({
  isOpen,
  onClose,
  state,
  initialMemberId,
  onSuccess,
  transact,
  apiRequest,
  registerId,
}: DevolucionesModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState<string>(initialMemberId ?? '');
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'card'>('cash');
  const [disposition, setDisposition] = useState<'restock' | 'waste'>('restock');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // Live state
  const [liveMembers, setLiveMembers] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [selectedLiveMember, setSelectedLiveMember] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [liveEligibleItems, setLiveEligibleItems] = useState<EligibleProductReturn[]>([]);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setSelectedMemberId(initialMemberId ?? '');
      setSelectedTargetId('');
      setReason('');
      setMemberSearch('');
      setErrorMessage('');
      setDisposition('restock');
      setSubmitting(false);
      setSelectedLiveMember(null);
      setLiveEligibleItems([]);
    }
  }, [isOpen, initialMemberId]);

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

  // Live member lookup when initialMemberId is provided
  useEffect(() => {
    if (!isOpen || !apiRequest || !initialMemberId) return;
    let active = true;
    apiRequest(`/api/v1/members?search=${encodeURIComponent(initialMemberId)}`)
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then((data: { items?: { id: string; full_name?: string; name?: string; phone: string }[] }) => {
        if (!active) return;
        const match = data.items?.find(m => m.id === initialMemberId);
        if (match) {
          setSelectedLiveMember({
            id: match.id,
            name: match.full_name || match.name || match.id,
            phone: match.phone || '',
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen, apiRequest, initialMemberId]);

  // Live member search
  useEffect(() => {
    if (!isOpen || !apiRequest) return;
    let active = true;
    const q = memberSearch.trim();
    if (q.length < 2) {
      setLiveMembers([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await apiRequest(`/api/v1/members?page=1&limit=20&search=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { items?: { id: string; full_name?: string; name?: string; phone: string }[] };
        if (active && data.items) {
          setLiveMembers(
            data.items.map(m => ({
              id: m.id,
              name: m.full_name || m.name || m.id,
              phone: m.phone || '',
            }))
          );
        }
      } catch {
        if (active) setLiveMembers([]);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isOpen, apiRequest, memberSearch]);

  // Live eligible items fetch
  useEffect(() => {
    if (!isOpen || !apiRequest || !registerId || !selectedMemberId) {
      setLiveEligibleItems([]);
      return;
    }
    let active = true;
    listEligibleProductReturns(apiRequest, registerId, selectedMemberId)
      .then(items => {
        if (active) setLiveEligibleItems(Array.isArray(items) ? items : []);
      })
      .catch(err => {
        if (active) {
          setLiveEligibleItems([]);
          setErrorMessage(err instanceof Error ? err.message : 'Error al cargar compras elegibles.');
        }
      });
    return () => {
      active = false;
    };
  }, [isOpen, apiRequest, registerId, selectedMemberId]);

  if (!isOpen) return null;

  // Selected member resolution
  const demoMembers = state?.members ?? [];
  const selectedMember = apiRequest
    ? selectedLiveMember ?? (selectedMemberId ? { id: selectedMemberId, name: selectedMemberId, phone: '' } : null)
    : demoMembers.find(m => m.id === selectedMemberId);

  const displayedMembers = apiRequest
    ? liveMembers
    : demoMembers.filter(m => {
        if (!memberSearch.trim()) return true;
        const q = memberSearch.toLowerCase();
        return m.name.toLowerCase().includes(q) || m.phone.includes(q);
      });

  const eligibleItems: DisplayItem[] = apiRequest
    ? (Array.isArray(liveEligibleItems) ? liveEligibleItems : []).map(item => ({
        id: item.order_item_id,
        type: 'product',
        title: `${item.product_name} (${item.quantity} ud${item.quantity > 1 ? 's' : ''})`,
        amountMinor: item.line_total_minor,
        originalMethod: item.original_payment_method === 'card' ? 'card' : 'cash',
      }))
    : selectedMemberId && state
      ? (getEligibleReturnsForMember(state, selectedMemberId) as DisplayItem[])
      : [];

  const selectedItem = eligibleItems.find(i => i.id === selectedTargetId);

  function handleSelectMember(member: { id: string; name: string; phone: string }) {
    setSelectedMemberId(member.id);
    setSelectedLiveMember(member);
    setSelectedTargetId('');
    setErrorMessage('');
  }

  function handleSelectItem(item: DisplayItem) {
    setSelectedTargetId(item.id);
    setRefundMethod(item.originalMethod === 'card' ? 'card' : 'cash');
    setErrorMessage('');
  }

  function handleProceedToStep2() {
    if (!selectedMember) {
      setErrorMessage('Selecciona un cliente para continuar.');
      return;
    }
    if (!selectedItem) {
      setErrorMessage('Selecciona el producto o servicio a reembolsar.');
      return;
    }
    setErrorMessage('');
    setStep(2);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMember || !selectedItem) {
      setErrorMessage('Selección incompleta.');
      return;
    }
    if (!reason.trim()) {
      setErrorMessage('Escribe el motivo o justificación de la devolución.');
      return;
    }

    if (apiRequest && registerId) {
      setSubmitting(true);
      try {
        const key = crypto.randomUUID();
        const res = await submitProductReturn(
          apiRequest,
          registerId,
          {
            order_item_id: selectedItem.id,
            reason: reason.trim(),
            disposition,
            payout_method: refundMethod,
          },
          key
        );
        onSuccess({
          message: `Devolución registrada por ${formatMoney(res.amount_minor)} MXN.`,
          refundedAmountMinor: res.amount_minor,
        });
        onClose();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'No se pudo registrar la devolución.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!transact || !state) return;
    const opResult = transact<ReturnOperationResult>(current =>
      processReturn(current, {
        id: `ret-${crypto.randomUUID()}`,
        targetType: selectedItem.type,
        targetId: selectedItem.id,
        memberId: selectedMember.id,
        reason: reason.trim(),
        refundMethod,
      })
    );

    if (opResult.status === 'error') {
      setErrorMessage(opResult.message);
    } else {
      onSuccess({
        message: opResult.message,
        refundedAmountMinor: opResult.refundedAmountMinor,
      });
      onClose();
    }
  }

  return (
    <div
      className="staff-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-devoluciones-title"
    >
      <div
        className="staff-modal-card devoluciones-modal-card"
        style={{
          maxWidth: '460px',
          width: '95vw',
          padding: '20px',
          boxSizing: 'border-box',
        }}
      >
        {/* Header with Title and Minimalist Stepper */}
        <div style={{ width: '100%', marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h2 id="modal-devoluciones-title" style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
              Registrar devolución
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar modal"
              style={{
                background: 'none',
                border: 'none',
                fontSize: '18px',
                cursor: 'pointer',
                color: 'var(--color-muted)',
                lineHeight: 1,
                padding: '4px',
              }}
            >
              ✕
            </button>
          </div>

          {/* Stepper Bar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px',
              padding: '4px',
              background: 'var(--color-canvas, #f3f4f6)',
              border: '1px solid var(--color-divider)',
              borderRadius: '10px',
            }}
          >
            <button
              type="button"
              onClick={() => setStep(1)}
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                border: 'none',
                fontSize: '12px',
                fontWeight: step === 1 ? 700 : 500,
                background: step === 1 ? 'var(--color-primary, #FC6C06)' : 'transparent',
                color: step === 1 ? '#FFFFFF' : 'var(--color-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'all 140ms ease',
              }}
            >
              <span>1. Selección</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (selectedItem) setStep(2);
              }}
              disabled={!selectedItem}
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                border: 'none',
                fontSize: '12px',
                fontWeight: step === 2 ? 700 : 500,
                background: step === 2 ? '#dc2626' : 'transparent',
                color: step === 2 ? '#FFFFFF' : 'var(--color-muted)',
                cursor: selectedItem ? 'pointer' : 'not-allowed',
                opacity: !selectedItem ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'all 140ms ease',
              }}
            >
              <span>2. Regreso del dinero</span>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* STEP 1: Select Client and Item */}
          {step === 1 && (
            <>
              {/* Client Selection */}
              <div>
                {!selectedMember ? (
                  <div>
                    <input
                      id="devolucion-member-search"
                      type="text"
                      placeholder="Buscar cliente por nombre o teléfono..."
                      value={memberSearch}
                      onChange={e => setMemberSearch(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        fontSize: '13px',
                        borderRadius: '8px',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div
                      className="devolucion-member-list"
                      role="listbox"
                      aria-label="Resultados de búsqueda de clientes"
                      style={{
                        maxHeight: '130px',
                        overflowY: 'auto',
                        border: '1px solid var(--color-divider)',
                        borderRadius: '8px',
                        marginTop: '6px',
                        padding: '2px',
                        background: 'var(--color-surface)',
                      }}
                    >
                      {displayedMembers.length === 0 ? (
                        <p className="muted" style={{ padding: '8px', margin: 0, fontSize: '12px', textAlign: 'center' }}>
                          Sin clientes encontrados.
                        </p>
                      ) : (
                        displayedMembers.map(m => (
                          <button
                            key={m.id}
                            type="button"
                            role="option"
                            aria-selected={false}
                            onClick={() => handleSelectMember(m)}
                            style={{
                              width: '100%',
                              textAlign: 'left',
                              padding: '7px 10px',
                              background: 'transparent',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: '13px',
                            }}
                          >
                            <strong>{m.name}</strong>
                            <span className="muted" style={{ fontSize: '12px' }}>{m.phone}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: 'var(--color-soft)',
                      border: '1px solid var(--color-primary)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '13px',
                    }}
                  >
                    <span>
                      Cliente seleccionado: <strong>{selectedMember.name}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMemberId('');
                        setSelectedLiveMember(null);
                        setSelectedTargetId('');
                        setLiveEligibleItems([]);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-primary)',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '12px',
                        padding: '2px 6px',
                      }}
                    >
                      Cambiar
                    </button>
                  </div>
                )}
              </div>

              {/* Items List */}
              <div style={{ minHeight: '160px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-muted)', display: 'block', marginBottom: '6px' }}>
                  Compras o servicios disponibles a reembolsar
                </label>

                {!selectedMember ? (
                  <p className="muted" style={{ fontSize: '13px', textAlign: 'center', padding: '24px 0', margin: 0 }}>
                    Busca y selecciona un cliente para ver sus compras del día.
                  </p>
                ) : eligibleItems.length === 0 ? (
                  <div
                    style={{
                      padding: '20px 12px',
                      borderRadius: '8px',
                      border: '1px dashed var(--color-divider)',
                      textAlign: 'center',
                    }}
                  >
                    <p className="muted" style={{ fontSize: '13px', margin: 0 }}>
                      Sin productos vendidos hoy ni compras disponibles para devolver.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
                    {eligibleItems.map(item => {
                      const isSelected = selectedTargetId === item.id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => handleSelectItem(item)}
                          style={{
                            border: isSelected ? '2px solid var(--color-primary)' : '1px solid var(--color-divider)',
                            background: isSelected ? 'var(--color-soft)' : 'var(--color-surface)',
                            borderRadius: '8px',
                            padding: '8px 12px',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            transition: 'all 100ms ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Badge tone={TYPE_TONES[item.type] ?? 'neutral'}>
                              {TYPE_LABELS[item.type] ?? item.type}
                            </Badge>
                            <span style={{ fontSize: '13px', fontWeight: 600 }}>{item.title}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <strong style={{ color: 'var(--color-ink)', fontSize: '13px' }}>
                              {formatMoney(item.amountMinor)} MXN
                            </strong>
                            <input
                              type="radio"
                              name="minimalist-return-selection"
                              checked={isSelected}
                              onChange={() => handleSelectItem(item)}
                              aria-label={`Seleccionar ${item.title}`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {errorMessage && <Notice tone="error">{errorMessage}</Notice>}

              {/* Step 1 Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                <Button variant="secondary" type="button" onClick={onClose}>
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  type="button"
                  disabled={!selectedItem}
                  onClick={handleProceedToStep2}
                >
                  Siguiente →
                </Button>
              </div>
            </>
          )}

          {/* STEP 2: Money Refund, Disposition and Method */}
          {step === 2 && selectedItem && (
            <>
              {/* Selected Item Summary Card */}
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  background: 'var(--color-canvas, #f9fafb)',
                  border: '1px solid var(--color-divider)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--color-muted)' }}>Ítem a devolver:</div>
                  <strong style={{ fontSize: '14px' }}>{selectedItem.title}</strong>
                  <div className="muted" style={{ fontSize: '11px', marginTop: '2px' }}>
                    {selectedItem.type === 'product' && (disposition === 'restock' ? 'Reintegra stock (+unidades).' : 'No reintegra stock (marcado como merma).')}
                    {selectedItem.type === 'supplement' && 'Reintegra porciones a inventario.'}
                    {selectedItem.type === 'membership' && 'Cancela vigencia de membresía.'}
                    {selectedItem.type === 'locker' && 'Libera casillero inmediatamente.'}
                    {selectedItem.type === 'glove' && 'Libera guantes inmediatamente.'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '11px', color: '#dc2626', fontWeight: 600 }}>Reembolso:</div>
                  <strong style={{ fontSize: '17px', color: '#dc2626' }}>
                    {formatMoney(selectedItem.amountMinor)} MXN
                  </strong>
                </div>
              </div>

              {/* Disposition Toggle (only for products) */}
              {selectedItem.type === 'product' && (
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                    Destino del producto *
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setDisposition('restock')}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        border: disposition === 'restock' ? '2px solid var(--color-primary, #FC6C06)' : '1px solid var(--color-divider)',
                        background: disposition === 'restock' ? 'var(--color-soft)' : 'var(--color-surface)',
                        cursor: 'pointer',
                        fontWeight: disposition === 'restock' ? 700 : 500,
                        fontSize: '13px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>🔄 Regresar a inventario</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDisposition('waste')}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        border: disposition === 'waste' ? '2px solid #dc2626' : '1px solid var(--color-divider)',
                        background: disposition === 'waste' ? 'rgba(220, 38, 38, 0.08)' : 'var(--color-surface)',
                        cursor: 'pointer',
                        fontWeight: disposition === 'waste' ? 700 : 500,
                        fontSize: '13px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>🗑️ Marcar como merma</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Refund Method Toggle */}
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Método de reembolso al cliente *
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setRefundMethod('cash')}
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      border: refundMethod === 'cash' ? '2px solid #FC6C06' : '1px solid var(--color-divider)',
                      background: refundMethod === 'cash' ? 'var(--color-soft)' : 'var(--color-surface)',
                      cursor: 'pointer',
                      fontWeight: refundMethod === 'cash' ? 700 : 500,
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>💵 Efectivo (Caja)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRefundMethod('card')}
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      border: refundMethod === 'card' ? '2px solid #2455A4' : '1px solid var(--color-divider)',
                      background: refundMethod === 'card' ? 'rgba(36, 85, 164, 0.08)' : 'var(--color-surface)',
                      cursor: 'pointer',
                      fontWeight: refundMethod === 'card' ? 700 : 500,
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>💳 Tarjeta (Reverso)</span>
                  </button>
                </div>
              </div>

              {/* Reason Input */}
              <div className="field">
                <label htmlFor="devolucion-reason-input" style={{ fontSize: '12px', fontWeight: 600 }}>
                  Motivo de la devolución *
                </label>
                <input
                  id="devolucion-reason-input"
                  type="text"
                  placeholder="Ej. Producto dañado, error de cobro, cambio..."
                  value={reason}
                  onChange={e => {
                    setReason(e.target.value);
                    setErrorMessage('');
                  }}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '13px',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {errorMessage && <Notice tone="error">{errorMessage}</Notice>}

              {/* Step 2 Actions */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                <Button variant="secondary" type="button" onClick={() => setStep(1)}>
                  ← Regresar
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={!reason.trim() || submitting}
                  style={{
                    background: reason.trim() && !submitting ? '#dc2626' : undefined,
                    borderColor: reason.trim() && !submitting ? '#b91c1c' : undefined,
                  }}
                >
                  {submitting ? 'Confirmar devolución…' : 'Confirmar devolución'}
                </Button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
