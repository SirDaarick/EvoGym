import React, { useEffect, useState } from 'react';
import type { DemoState, Product } from '../../domain/models';
import { formatMoney } from '../../demo/adapter';
import { expectedStock } from '../../demo/inventoryOperations';
import { Button, Notice } from '../../shared/ui';

export interface WasteItem {
  product: Product;
  quantity: number;
}

export interface MermaModalProps {
  isOpen: boolean;
  onClose: () => void;
  products?: Product[];
  items?: WasteItem[];
  selectedProductId?: string;
  state: DemoState;
  onConfirmWaste: (
    itemsOrProductId: WasteItem[] | string,
    quantityOrReason?: number | string,
    maybeReason?: string
  ) => { status: 'ok' } | { status: 'error'; message: string };
}

export function MermaModal({
  isOpen,
  onClose,
  products = [],
  items = [],
  selectedProductId: initialProductId,
  state,
  onConfirmWaste,
}: MermaModalProps) {
  // If items prop is provided with selected items from the screen, use them directly
  const activeItems: WasteItem[] =
    items.length > 0
      ? items
      : initialProductId
      ? [
          {
            product: (products.find(p => p.id === initialProductId) ?? state.products.find(p => p.id === initialProductId))!,
            quantity: 1,
          },
        ].filter(i => Boolean(i.product))
      : products.length > 0
      ? [{ product: products[0], quantity: 1 }]
      : [];

  const [reason, setReason] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setErrorMessage('');
    }
  }, [isOpen]);

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

  const totalEstimatedValue = activeItems.reduce(
    (sum, item) => sum + item.product.priceMinor * item.quantity,
    0
  );

  const totalQuantity = activeItems.reduce((sum, item) => sum + item.quantity, 0);

  // Validate stock for all items
  const stockExceededItem = activeItems.find(
    item => item.quantity > expectedStock(state, item.product.id)
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (activeItems.length === 0) {
      setErrorMessage('No hay productos seleccionados para dar de baja.');
      return;
    }
    if (stockExceededItem) {
      setErrorMessage(
        `La cantidad a dar de baja de "${stockExceededItem.product.name}" supera el stock disponible (${expectedStock(
          state,
          stockExceededItem.product.id
        )}).`
      );
      return;
    }
    if (!reason.trim()) {
      setErrorMessage('Escribe el motivo o justificación de la merma.');
      return;
    }

    const result = onConfirmWaste(activeItems, reason.trim());
    if (result.status === 'error') {
      setErrorMessage(result.message);
    } else {
      onClose();
    }
  }

  return (
    <div
      className="staff-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-merma-title"
    >
      <div
        className="staff-modal-card merma-modal-card"
        style={{
          maxWidth: '460px',
          width: '95vw',
          padding: '20px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <h2 id="modal-merma-title" style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
              Registrar merma de producto
            </h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '12px' }}>
              Se descontarán de forma inmediata del inventario y quedarán registrados en el turno.
            </p>
          </div>
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
              padding: '4px',
            }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* List of already selected products */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-muted)', display: 'block', marginBottom: '6px' }}>
              Productos seleccionados ({totalQuantity} {totalQuantity === 1 ? 'unidad' : 'unidades'}):
            </label>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                maxHeight: '180px',
                overflowY: 'auto',
              }}
            >
              {activeItems.map(item => {
                const stock = expectedStock(state, item.product.id);
                return (
                  <div
                    key={item.product.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-divider)',
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                  >
                    <div>
                      <strong>{item.product.name}</strong>
                      <div className="muted" style={{ fontSize: '11px' }}>
                        {item.quantity} {item.quantity === 1 ? 'unidad' : 'unidades'} · Disponibles: {stock}
                      </div>
                    </div>
                    <strong style={{ color: '#dc2626', fontSize: '13px' }}>
                      {formatMoney(item.product.priceMinor * item.quantity)} MXN
                    </strong>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Loss Value Summary Box */}
          <div
            className="merma-value-summary"
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid #ef4444',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 600 }}>Valor total de la merma:</span>
            <strong style={{ fontSize: '16px', color: '#dc2626' }}>
              {formatMoney(totalEstimatedValue)} MXN
            </strong>
          </div>

          {/* Reason Input */}
          <div className="field">
            <label htmlFor="merma-reason-input" style={{ fontSize: '12px', fontWeight: 600 }}>
              Motivo o comentario *
            </label>
            <input
              id="merma-reason-input"
              type="text"
              placeholder="Ej. Producto dañado, roto, caducado o consumo interno"
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

          <div className="staff-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={activeItems.length === 0 || Boolean(stockExceededItem) || !reason.trim()}
              style={{
                background: !reason.trim() ? undefined : '#dc2626',
                borderColor: !reason.trim() ? undefined : '#b91c1c',
              }}
            >
              Confirmar merma
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
