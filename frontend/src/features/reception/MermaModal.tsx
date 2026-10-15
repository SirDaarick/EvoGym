import React, { useEffect, useState } from 'react';
import type { DemoState, Product } from '../../domain/models';
import { formatMoney } from '../../demo/adapter';
import { expectedStock } from '../../demo/inventoryOperations';
import { Button, Notice } from '../../shared/ui';

export interface MermaModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  state: DemoState;
  onConfirmWaste: (productId: string, quantity: number, reason: string) => { status: 'ok' } | { status: 'error'; message: string };
}

export function MermaModal({ isOpen, onClose, products, state, onConfirmWaste }: MermaModalProps) {
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id ?? '');
  const [quantity, setQuantity] = useState<number>(1);
  const [reason, setReason] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      if (products.length > 0 && !selectedProductId) {
        setSelectedProductId(products[0].id);
      }
      setQuantity(1);
      setReason('');
      setErrorMessage('');
    }
  }, [isOpen, products, selectedProductId]);

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

  const currentProduct = products.find(p => p.id === selectedProductId) ?? products[0];
  const availableStock = currentProduct ? expectedStock(state, currentProduct.id) : 0;
  const estimatedValue = currentProduct ? currentProduct.priceMinor * Math.max(0, quantity) : 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentProduct) {
      setErrorMessage('Selecciona un producto válido.');
      return;
    }
    if (quantity <= 0 || !Number.isSafeInteger(quantity)) {
      setErrorMessage('La cantidad debe ser un entero positivo.');
      return;
    }
    if (quantity > availableStock) {
      setErrorMessage('La merma supera la existencia disponible.');
      return;
    }
    if (!reason.trim()) {
      setErrorMessage('Escribe el motivo o justificación de la merma.');
      return;
    }

    const result = onConfirmWaste(currentProduct.id, quantity, reason.trim());
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
      <div className="staff-modal-card merma-modal-card">
        <div className="staff-modal-header" style={{ width: '100%', textAlign: 'left', alignItems: 'flex-start' }}>
          <h2 id="modal-merma-title">Registrar merma de producto</h2>
          <p className="muted">
            Da de baja productos dañados, cortesías o consumo interno. Se descontará de forma inmediata del inventario.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="field">
            <label htmlFor="merma-product-select">Producto a dar de baja *</label>
            <select
              id="merma-product-select"
              value={selectedProductId}
              onChange={e => {
                setSelectedProductId(e.target.value);
                setQuantity(1);
                setErrorMessage('');
              }}
            >
              {products.map(product => {
                const stock = expectedStock(state, product.id);
                return (
                  <option key={product.id} value={product.id}>
                    {product.name} · Disponibles: {stock}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="field">
            <label htmlFor="merma-quantity-input">
              Cantidad a descontar * (Disponibles: {availableStock})
            </label>
            <input
              id="merma-quantity-input"
              type="number"
              min="1"
              max={availableStock}
              value={quantity || ''}
              onChange={e => {
                setQuantity(Number(e.target.value));
                setErrorMessage('');
              }}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="merma-reason-input">Motivo o comentario *</label>
            <input
              id="merma-reason-input"
              type="text"
              placeholder="Ej. Producto dañado, cortesía o consumo personal"
              value={reason}
              onChange={e => {
                setReason(e.target.value);
                setErrorMessage('');
              }}
              required
            />
          </div>

          <div className="merma-value-summary">
            <span>Valor estimado (precio venta):</span>
            <strong>{formatMoney(estimatedValue)} MXN</strong>
          </div>

          {errorMessage && <Notice tone="error">{errorMessage}</Notice>}

          <div className="staff-modal-actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={availableStock <= 0 || quantity <= 0 || quantity > availableStock || !reason.trim()}
            >
              Confirmar merma
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
