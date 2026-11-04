import type { StockItem } from '../../../api/inventoryApi';
import { Button, Notice, Panel } from '../../../shared/ui';
import type { LiveProductCardItem } from '../hooks/useReceptionInventory';

const money = (minor: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(minor / 100);

export interface InventoryReceiptPanelProps {
  product: LiveProductCardItem | null;
  stock: StockItem | undefined;
  quantity: number;
  kind: 'restock' | 'waste';
  onKindChange: (kind: 'restock' | 'waste') => void;
  wasteReason: string;
  onWasteReasonChange: (value: string) => void;
  reasonError: string | null;
  error: string | null;
  success: string | null;
  isSubmitting: boolean;
  onOpenContainer: () => void;
  onEmptyScoops: () => void;
  onConfirm: () => void;
}

export function InventoryReceiptPanel(props: InventoryReceiptPanelProps) {
  const { product, stock, quantity, kind, wasteReason, reasonError, error, success, isSubmitting } = props;
  const isScoop = stock?.unit === 'scoop';
  return (
    <aside className="inventory-receipt" aria-labelledby="inventory-receipt-heading">
      <Panel className="inventory-receipt-panel">
        <p className="eyebrow">OPERACIÓN</p>
        <h2 id="inventory-receipt-heading">
          {kind === 'restock' ? 'Recepción de inventario' : 'Merma de inventario'}
        </h2>

        {product ? (
          <>
            <div className="inventory-receipt-product">
              <span>Producto</span>
              <strong>{product.name}</strong>
            </div>
            <dl className="inventory-receipt-facts">
              <div>
                <dt>Stock actual</dt>
                <dd>{isScoop ? `~${product.stock} scoops aprox.` : product.stock}</dd>
              </div>
              <div>
                <dt>Cantidad seleccionada</dt>
                <dd>{quantity}</dd>
              </div>
              <div>
                <dt>Costo unitario</dt>
                <dd>{product.costMinor ? money(product.costMinor) : 'No disponible'}</dd>
              </div>
              <div>
                <dt>Precio de venta</dt>
                <dd>{money(product.priceMinor)}</dd>
              </div>
            </dl>
            {isScoop && stock?.servings_per_container && (
              <p>{stock.servings_per_container} scoops/bote (equiv. ~{(product.stock / stock.servings_per_container).toFixed(1)} botes)</p>
            )}
          </>
        ) : (
          <p className="muted">Selecciona un producto para ver su contexto.</p>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '1rem', marginBottom: '0.5rem' }}>
          <Button type="button" variant={kind === 'restock' ? 'primary' : 'secondary'} onClick={() => props.onKindChange('restock')} aria-pressed={kind === 'restock'}>
            Recepción
          </Button>
          <Button type="button" variant={kind === 'waste' ? 'primary' : 'secondary'} onClick={() => props.onKindChange('waste')} aria-pressed={kind === 'waste'}>
            Merma
          </Button>
        </div>

        {isScoop && kind === 'restock' && stock?.container_product_id && (
          <Button type="button" disabled={isSubmitting} onClick={props.onOpenContainer}>+1 bote (+{stock.servings_per_container} scoops)</Button>
        )}
        {isScoop && kind === 'waste' && (
          <Button type="button" disabled={isSubmitting || !product?.stock} onClick={props.onEmptyScoops}>Vaciar / ajustar resto</Button>
        )}

        {kind === 'waste' && (
          <div className="field" style={{ marginBottom: '0.75rem' }}>
            <label htmlFor="waste-reason-input">Motivo de merma *</label>
            <input
              id="waste-reason-input"
              type="text"
              required
              placeholder="Ej. Botella rota, caducidad..."
              value={wasteReason}
              aria-invalid={Boolean(reasonError)}
              aria-describedby={reasonError ? 'waste-reason-input-error' : undefined}
              onChange={e => props.onWasteReasonChange(e.target.value)}
            />
            {reasonError && <p id="waste-reason-input-error" className="field-error">{reasonError}</p>}
          </div>
        )}

        {error && (
          <p className="field-error" role="alert" style={{ marginTop: '0.5rem' }}>{error}</p>
        )}
        {success && <Notice>{success}</Notice>}

        <div className="inventory-receipt-actions">
          <Button
            variant="secondary"
            disabled={isSubmitting || !product || quantity <= 0 || (kind === 'waste' && !wasteReason.trim())}
            onClick={props.onConfirm}
          >
            {kind === 'waste' ? 'Confirmar merma' : 'Confirmar recepción'}
          </Button>
        </div>
      </Panel>
    </aside>
  );
}
