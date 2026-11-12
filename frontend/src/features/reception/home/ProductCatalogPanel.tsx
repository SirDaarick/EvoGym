import type { BranchItem, StockItem } from '@/api/inventoryApi';
import type { CashRegisterDTO } from '@/api/shiftsApi';
import { Button, EmptyState, Panel } from '@/shared/ui';
import { ProductCard } from '../ProductCard';

interface Props {
  registers: CashRegisterDTO[];
  branches: BranchItem[];
  registerId: string;
  stock: StockItem[];
  quantities: Record<string, number>;
  locked: boolean;
  hasSelectedItems?: boolean;
  onRegisterChange(registerId: string): void;
  onQuantityChange(productId: string, quantity: number): void;
  onOpenReturns(): void;
  onOpenWaste?: () => void;
}

export function ProductCatalogPanel({
  registers, branches, registerId, stock, quantities, locked, hasSelectedItems = false,
  onRegisterChange, onQuantityChange, onOpenReturns, onOpenWaste,
}: Props) {
  const products = stock.filter(item => item.unit !== 'scoop');
  const wasteDisabled = !registerId || locked || !hasSelectedItems || !onOpenWaste;
  return <Panel className="product-catalog-panel">
    <div className="product-catalog-header-row"><div><h2>Productos disponibles</h2><p className="muted">Selecciona productos y ajusta las cantidades antes de revisar el cobro.</p></div>
      <div className="catalog-header-actions">
        <Button
          variant="secondary"
          className="catalog-devolucion-header-btn"
          aria-label="Devoluciones"
          disabled={!registerId || locked}
          onClick={onOpenReturns}
          title="Registrar devolución de compras del día o servicios activos"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          <span>Devoluciones</span>
        </Button>
        <Button
          variant="secondary"
          className={`catalog-merma-header-btn ${hasSelectedItems ? 'active-merma' : ''}`}
          aria-label="Merma"
          aria-describedby={wasteDisabled ? 'catalog-merma-hint' : undefined}
          disabled={wasteDisabled}
          onClick={onOpenWaste}
          title={
            hasSelectedItems
              ? 'Registrar merma para los productos seleccionados'
              : 'Para registrar merma, selecciona primero los productos en el catálogo.'
          }
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
          <span>Merma</span>
        </Button>
      </div>
    </div>
    {registerId && !hasSelectedItems && onOpenWaste && (
      <p id="catalog-merma-hint" className="muted catalog-merma-hint">
        Para registrar merma, selecciona primero los productos en el catálogo.
      </p>
    )}
    <div className="field"><label htmlFor="product-sale-register">Caja</label><select id="product-sale-register" value={registerId} disabled={locked || registers.length === 1} onChange={event => onRegisterChange(event.target.value)}>
      <option value="">Selecciona una caja</option>{registers.map(register => <option key={register.id} value={register.id}>{branches.find(branch => branch.id === register.branch_id)?.name ?? register.branch_id} · {register.name} · {register.code}</option>)}
    </select></div>
    {products.length ? <div className="product-grid">{products.map(item => <ProductCard key={item.product_id}
      product={{ id: item.product_id, name: item.name, priceMinor: item.price_minor }} stock={item.quantity ?? 0}
      quantity={quantities[item.product_id] ?? 0} disabled={locked} onQuantityChange={quantity => onQuantityChange(item.product_id, quantity)} />)}</div>
      : <EmptyState title="Sin productos">Selecciona una caja y revisa el inventario.</EmptyState>}
  </Panel>;
}
