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
  onRegisterChange(registerId: string): void;
  onQuantityChange(productId: string, quantity: number): void;
  onOpenReturns(): void;
}

export function ProductCatalogPanel({ registers, branches, registerId, stock, quantities, locked, onRegisterChange, onQuantityChange, onOpenReturns }: Props) {
  const products = stock.filter(item => item.unit !== 'scoop');
  return <Panel className="product-catalog-panel">
    <div className="product-catalog-header-row"><div><h2>Productos disponibles</h2><p className="muted">Selecciona productos y ajusta las cantidades antes de revisar el cobro.</p></div>
      <div className="catalog-header-actions"><Button variant="secondary" disabled={!registerId || locked} onClick={onOpenReturns}>Devoluciones</Button><Button variant="secondary" disabled title="Aún no disponible">Merma</Button></div>
    </div>
    <div className="field"><label htmlFor="product-sale-register">Caja</label><select id="product-sale-register" value={registerId} disabled={locked || registers.length === 1} onChange={event => onRegisterChange(event.target.value)}>
      <option value="">Selecciona una caja</option>{registers.map(register => <option key={register.id} value={register.id}>{branches.find(branch => branch.id === register.branch_id)?.name ?? register.branch_id} · {register.name} · {register.code}</option>)}
    </select></div>
    {products.length ? <div className="product-grid">{products.map(item => <ProductCard key={item.product_id}
      product={{ id: item.product_id, name: item.name, priceMinor: item.price_minor }} stock={item.quantity ?? 0}
      quantity={quantities[item.product_id] ?? 0} disabled={locked} onQuantityChange={quantity => onQuantityChange(item.product_id, quantity)} />)}</div>
      : <EmptyState title="Sin productos">Selecciona una caja y revisa el inventario.</EmptyState>}
  </Panel>;
}
