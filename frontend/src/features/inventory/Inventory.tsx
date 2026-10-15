import { useRef, useState } from 'react';
import type { Role } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { activeShift, currentShiftStockBreakdown, recordCount, recordMovement, stockBreakdown } from '../../demo/inventoryOperations';
import { Button, Field, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';
import { NotebookNotice } from '../members/Members';
import { expectedStock } from '../../demo/inventoryOperations';
import { ProductCard } from '../reception/ProductCard';
import { InventoryAnalytics } from '../owner/InventoryAnalytics';
import './Inventory.css';

export function Inventory({ role }: { role: Role }) {
  if (role === 'OWNER') {
    return <InventoryAnalytics />;
  }

  const { state, transact } = useDemo();
  const [productId, setProductId] = useState(state.products[0]?.id ?? '');
  const [kind, setKind] = useState<'restock' | 'waste' | 'count'>('count');
  const [quantity, setQuantity] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [search, setSearch] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selectedProductId, setSelectedProductId] = useState(state.products[0]?.id ?? '');
  const matchingProducts = state.products.filter(product => product.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selectedProduct = state.products.find(product => product.id === selectedProductId);
  const locked = useRef(false);
  const counts = state.counts.filter(item => item.shiftId === state.currentShiftId);
  const movements = state.stockMovements.filter(item => item.shiftId === state.currentShiftId);
  function changeQuantity(productId: string, quantity: number) {
    if (!Number.isSafeInteger(quantity) || quantity < 0) return;
    setQuantities(previous => ({ ...previous, [productId]: quantity }));
    setSelectedProductId(productId);
  }

  return <>
    <PageHeader eyebrow="INVENTARIO" title="Inventario" description="Busca productos y consulta una vista previa de recepción. Las operaciones de inventario existentes siguen disponibles en Registros de inventario." />
    <div className="reception-checkout">
      <section className="reception-products-column inventory-catalog" aria-labelledby="inventory-products-heading">
        <Panel className="product-catalog-panel">
          <div className="inventory-catalog-heading"><div><h2 id="inventory-products-heading">Productos</h2><p className="muted">Selecciona productos y ajusta las cantidades.</p></div>
            <div className="field inventory-search"><label htmlFor="inventory-search">Buscar producto</label><input id="inventory-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre del producto" /></div>
          </div>
          {matchingProducts.length ? <div className="product-grid">{matchingProducts.map(product => <ProductCard key={product.id} product={product} stock={expectedStock(state, product.id)} quantity={quantities[product.id] ?? 0} onQuantityChange={quantity => changeQuantity(product.id, quantity)} />)}</div> : <p className="muted" role="status">No se encontraron productos.</p>}
        </Panel>
      </section>
      <aside className="inventory-receipt" aria-labelledby="inventory-receipt-heading">
        <Panel className="inventory-receipt-panel">
          <p className="eyebrow">VISTA PREVIA</p><h2 id="inventory-receipt-heading">Recepción de inventario</h2>
          {selectedProduct ? <>
            <div className="inventory-receipt-product"><span>Producto</span><strong>{selectedProduct.name}</strong></div>
            <dl className="inventory-receipt-facts"><div><dt>Cantidad recibida</dt><dd>{quantities[selectedProduct.id] ?? 0}</dd></div><div><dt>Costo unitario</dt><dd>No disponible</dd></div><div><dt>Precio de venta</dt><dd>{new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(selectedProduct.priceMinor / 100)}</dd></div><div><dt>Total de recepción</dt><dd>No disponible</dd></div></dl>
          </> : <p className="muted">Selecciona un producto para ver su contexto.</p>}
          <Notice>Las cantidades son una selección local. La recepción con costo aún no está disponible. No se guardará ningún movimiento.</Notice>
          <div className="inventory-receipt-actions"><Button disabled>Crear producto</Button><Button variant="secondary" disabled>Confirmar recepción</Button></div>
        </Panel>
      </aside>
    </div>
  </>;
}
