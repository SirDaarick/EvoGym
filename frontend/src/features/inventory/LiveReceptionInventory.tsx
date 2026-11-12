import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../shared/ui';
import { ProductCard } from '../reception/ProductCard';
import { MobileDetailPanel } from '../../shared/MobileDetailPanel';
import type { AuthenticatedRequest } from '../../api/inventoryApi';
import { useReceptionInventory } from './hooks/useReceptionInventory';
import { useStockMovement } from './hooks/useStockMovement';
import { useContainerOpening } from './hooks/useContainerOpening';
import { InventoryCatalogPanel } from './components/InventoryCatalogPanel';
import { InventoryReceiptPanel } from './components/InventoryReceiptPanel';
import { PurchasePanel } from './components/PurchasePanel';
import { queryKeys } from '../../api/queryKeys';
import './Inventory.css';

const messageOf = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export function LiveReceptionInventory({ apiRequest }: { apiRequest: AuthenticatedRequest }) {
  const inv = useReceptionInventory(apiRequest);
  const queryClient = useQueryClient();
  const movement = useStockMovement(apiRequest);
  const opening = useContainerOpening(apiRequest);
  const [movementKind, setMovementKind] = useState<'restock' | 'waste'>('restock');
  const [wasteReason, setWasteReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [movementSuccess, setMovementSuccess] = useState<string | null>(null);

  const { selectedProduct, selectedStock, branchId } = inv;
  const isSubmitting = movement.isPending || opening.isPending;
  const quantity = selectedProduct ? inv.quantities[selectedProduct.id] ?? 0 : 0;

  function clearMessages() {
    setActionError(null);
    setReasonError(null);
    setMovementSuccess(null);
  }

  function changeQuantity(id: string, qty: number) {
    if (inv.changeQuantity(id, qty)) clearMessages();
  }

  async function handleOpenContainer() {
    if (!selectedStock || !branchId || isSubmitting) return;
    setActionError(null);
    try {
      await opening.mutateAsync({ branchId, productId: selectedStock.product_id });
      setMovementSuccess('Bote abierto y porciones agregadas al inventario.');
    } catch (err) {
      setActionError(messageOf(err, 'Error al abrir el bote.'));
    }
  }

  async function handleConfirmMovement() {
    if (!selectedProduct || quantity <= 0) return;
    if (movementKind === 'waste' && !wasteReason.trim()) {
      setReasonError('Indica el motivo de la merma.');
      return;
    }
    if (!branchId) return;
    clearMessages();
    try {
      await movement.mutateAsync({
        branchId,
        productId: selectedProduct.id,
        kind: movementKind,
        quantity,
        reason: movementKind === 'waste' ? wasteReason.trim() : undefined,
      });
      inv.resetQuantity(selectedProduct.id);
      setWasteReason('');
      setMovementSuccess(
        movementKind === 'restock'
          ? `Recepción de ${quantity} unidad(es) confirmada.`
          : `Merma de ${quantity} unidad(es) registrada.`
      );
    } catch (err) {
      setActionError(messageOf(err, 'Error al registrar movimiento.'));
    }
  }

  const grid = inv.matchingProducts.length ? (
    <div className="product-grid">
      {inv.matchingProducts.map(product => (
        <ProductCard
          key={product.id}
          product={product}
          stock={product.stock}
          quantity={inv.quantities[product.id] ?? 0}
          onQuantityChange={qty => changeQuantity(product.id, qty)}
        />
      ))}
    </div>
  ) : (
    <p className="muted" role="status">No se encontraron productos.</p>
  );

  // A failed refetch must not discard data already on screen: keep the stale grid and show a non-blocking notice.
  const catalog = inv.isLoading ? (
    <p className="muted" role="status">Cargando inventario...</p>
  ) : inv.loadError && !inv.hasData ? (
    <p className="field-error" role="alert">{inv.loadError}</p>
  ) : (
    <>
      {inv.loadError && (
        <p className="field-error" role="alert">
          No se pudo actualizar el inventario; se muestran los últimos datos cargados. {inv.loadError}
        </p>
      )}
      {grid}
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow="INVENTARIO · RECEPCIÓN"
        title="Inventario"
        description="Busca productos y registra movimientos físicos de inventario en tiempo real verificados por la API."
      />
      <div className="reception-checkout">
        <InventoryCatalogPanel search={inv.search} onSearchChange={inv.setSearch}>{catalog}</InventoryCatalogPanel>
        <MobileDetailPanel title="Vista previa de recepción" triggerLabel="Ver vista previa" className="inventory-receipt-slot">
          <InventoryReceiptPanel
            product={selectedProduct}
            stock={selectedStock}
            quantity={quantity}
            kind={movementKind}
            onKindChange={kind => { setMovementKind(kind); setActionError(null); setReasonError(null); }}
            wasteReason={wasteReason}
            onWasteReasonChange={value => { setWasteReason(value); setReasonError(null); }}
            reasonError={reasonError}
            error={actionError}
            success={movementSuccess}
            isSubmitting={isSubmitting}
            onOpenContainer={handleOpenContainer}
            onEmptyScoops={() => {
              if (!selectedProduct) return;
              changeQuantity(selectedProduct.id, selectedProduct.stock);
              setWasteReason('Ajuste por fin de bote');
            }}
            onConfirm={handleConfirmMovement}
          />
          {branchId && <PurchasePanel
            key={branchId}
            request={apiRequest}
            branchId={branchId}
            products={inv.products.filter(product => (inv.quantities[product.id] ?? 0) > 0).map(product => ({
              id: product.id, name: product.name, quantity: inv.quantities[product.id],
            }))}
            onQuantityChange={(id, qty) => changeQuantity(id, qty)}
            onSuccess={() => {
              inv.products.forEach(product => inv.resetQuantity(product.id));
              void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
              setMovementSuccess('Compra registrada.');
            }}
          />}
        </MobileDetailPanel>
      </div>
    </>
  );
}
