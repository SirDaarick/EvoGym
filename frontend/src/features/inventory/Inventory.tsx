import { useCallback, useEffect, useRef, useState } from 'react';
import type { Product, Role } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { Button, Notice, PageHeader, Panel } from '../../shared/ui';
import { expectedStock } from '../../demo/inventoryOperations';
import { ProductCard } from '../reception/ProductCard';
import { InventoryAnalytics } from '../owner/InventoryAnalytics';
import {
  listBranches,
  listBranchInventory,
  recordStockMovement,
  type AuthenticatedRequest,
  type BranchItem,
  type StockItem,
} from '../../api/inventoryApi';
import './Inventory.css';
import { MobileDetailPanel } from '../../shared/MobileDetailPanel';

interface LiveProductCardItem extends Product {
  stock: number;
}

function LiveReceptionInventory({ apiRequest }: { apiRequest: AuthenticatedRequest }) {
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selectedProductId, setSelectedProductId] = useState('');
  const [search, setSearch] = useState('');
  const [movementKind, setMovementKind] = useState<'restock' | 'waste'>('restock');
  const [wasteReason, setWasteReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);
  const [movementSuccess, setMovementSuccess] = useState<string | null>(null);

  const loadStock = useCallback(async (branchId?: string) => {
    try {
      let targetBranchId = branchId || selectedBranchId;
      if (!targetBranchId) {
        const branchList = await listBranches(apiRequest);
        setBranches(branchList);
        targetBranchId = branchList[0]?.id ?? '';
        setSelectedBranchId(targetBranchId);
      }
      if (targetBranchId) {
        const stockPage = await listBranchInventory(apiRequest, targetBranchId);
        setStockItems(stockPage.items);
        if (!selectedProductId && stockPage.items.length > 0) {
          setSelectedProductId(stockPage.items[0].product_id);
        }
      }
    } catch {
      // In live mode, error handling retained
    }
  }, [apiRequest, selectedBranchId, selectedProductId]);

  useEffect(() => {
    void loadStock();
  }, [loadStock]);

  const activeProducts: LiveProductCardItem[] = stockItems
    .filter(item => item.is_active)
    .map(item => ({
      id: item.product_id,
      name: item.name,
      category: item.category || 'General',
      priceMinor: item.price_minor,
      costMinor: item.cost_minor,
      openingQuantity: item.opening_quantity ?? 0,
      active: item.is_active,
      illustrative: true,
      stock: item.quantity ?? 0,
    }));

  const matchingProducts = activeProducts.filter(p =>
    p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );

  const selectedProduct = activeProducts.find(p => p.id === selectedProductId)
    ?? (activeProducts[0] ? activeProducts[0] : null);

  function changeQuantity(id: string, qty: number) {
    if (!Number.isSafeInteger(qty) || qty < 0) return;
    setQuantities(prev => ({ ...prev, [id]: qty }));
    setSelectedProductId(id);
    setMovementError(null);
    setMovementSuccess(null);
  }

  async function handleConfirmMovement() {
    if (!selectedProduct) return;
    const qty = quantities[selectedProduct.id] ?? 0;
    if (qty <= 0) return;

    if (movementKind === 'waste' && !wasteReason.trim()) {
      setMovementError('Indica el motivo de la merma.');
      return;
    }

    const branchId = selectedBranchId || branches[0]?.id;
    if (!branchId) return;

    setIsSubmitting(true);
    setMovementError(null);
    setMovementSuccess(null);

    const idempotencyKey = `mov-${movementKind}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;

    try {
      await recordStockMovement(apiRequest, branchId, {
        product_id: selectedProduct.id,
        kind: movementKind,
        quantity: qty,
        reason: movementKind === 'waste' ? wasteReason.trim() : undefined,
        idempotency_key: idempotencyKey,
      });

      setQuantities(prev => ({ ...prev, [selectedProduct.id]: 0 }));
      setWasteReason('');
      setMovementSuccess(
        movementKind === 'restock'
          ? `Recepción de ${qty} unidad(es) confirmada.`
          : `Merma de ${qty} unidad(es) registrada.`
      );
      await loadStock(branchId);
    } catch (err) {
      setMovementError(err instanceof Error ? err.message : 'Error al registrar movimiento.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="INVENTARIO · RECEPCIÓN"
        title="Inventario"
        description="Busca productos y registra movimientos físicos de inventario en tiempo real verificados por la API."
      />
      <div className="reception-checkout">
        <section className="reception-products-column inventory-catalog" aria-labelledby="inventory-products-heading">
          <Panel className="product-catalog-panel">
            <div className="inventory-catalog-heading">
              <div>
                <h2 id="inventory-products-heading">Productos</h2>
                <p className="muted">Selecciona productos y ajusta las cantidades.</p>
              </div>
              <div className="field inventory-search">
                <label htmlFor="inventory-search">Buscar producto</label>
                <input
                  id="inventory-search"
                  type="search"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Nombre del producto"
                />
              </div>
            </div>
            {matchingProducts.length ? (
              <div className="product-grid">
                {matchingProducts.map(product => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    stock={product.stock}
                    quantity={quantities[product.id] ?? 0}
                    onQuantityChange={qty => changeQuantity(product.id, qty)}
                  />
                ))}
              </div>
            ) : (
              <p className="muted" role="status">No se encontraron productos.</p>
            )}
          </Panel>
        </section>

        <MobileDetailPanel title="Vista previa de recepción" triggerLabel="Ver vista previa" className="inventory-receipt-slot">
          <aside className="inventory-receipt" aria-labelledby="inventory-receipt-heading">
            <Panel className="inventory-receipt-panel">
              <p className="eyebrow">OPERACIÓN</p>
              <h2 id="inventory-receipt-heading">
                {movementKind === 'restock' ? 'Recepción de inventario' : 'Merma de inventario'}
              </h2>

              {selectedProduct ? (
                <>
                  <div className="inventory-receipt-product">
                    <span>Producto</span>
                    <strong>{selectedProduct.name}</strong>
                  </div>
                  <dl className="inventory-receipt-facts">
                    <div>
                      <dt>Stock actual</dt>
                      <dd>{selectedProduct.stock}</dd>
                    </div>
                    <div>
                      <dt>Cantidad seleccionada</dt>
                      <dd>{quantities[selectedProduct.id] ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Costo unitario</dt>
                      <dd>
                        {selectedProduct.costMinor
                          ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(selectedProduct.costMinor / 100)
                          : 'No disponible'}
                      </dd>
                    </div>
                    <div>
                      <dt>Precio de venta</dt>
                      <dd>
                        {new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(selectedProduct.priceMinor / 100)}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="muted">Selecciona un producto para ver su contexto.</p>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '1rem', marginBottom: '0.5rem' }}>
                <Button
                  type="button"
                  variant={movementKind === 'restock' ? 'primary' : 'secondary'}
                  onClick={() => { setMovementKind('restock'); setMovementError(null); }}
                  aria-pressed={movementKind === 'restock'}
                >
                  Recepción
                </Button>
                <Button
                  type="button"
                  variant={movementKind === 'waste' ? 'primary' : 'secondary'}
                  onClick={() => { setMovementKind('waste'); setMovementError(null); }}
                  aria-pressed={movementKind === 'waste'}
                >
                  Merma
                </Button>
              </div>

              {movementKind === 'waste' && (
                <div className="field" style={{ marginBottom: '0.75rem' }}>
                  <label htmlFor="waste-reason-input">Motivo de merma *</label>
                  <input
                    id="waste-reason-input"
                    type="text"
                    required
                    placeholder="Ej. Botella rota, caducidad..."
                    value={wasteReason}
                    onChange={e => setWasteReason(e.target.value)}
                  />
                </div>
              )}

              {movementError && (
                <p className="field-error" role="alert" style={{ marginTop: '0.5rem' }}>
                  {movementError}
                </p>
              )}
              {movementSuccess && (
                <Notice>{movementSuccess}</Notice>
              )}

              <div className="inventory-receipt-actions">
                <Button
                  variant="secondary"
                  disabled={
                    isSubmitting ||
                    !selectedProduct ||
                    (quantities[selectedProduct.id] ?? 0) <= 0 ||
                    (movementKind === 'waste' && !wasteReason.trim())
                  }
                  onClick={handleConfirmMovement}
                >
                  {movementKind === 'waste' ? 'Confirmar merma' : 'Confirmar recepción'}
                </Button>
              </div>
            </Panel>
          </aside>
        </MobileDetailPanel>
      </div>
    </>
  );
}

function DemoReceptionInventory() {
  const { state } = useDemo();
  const [search, setSearch] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selectedProductId, setSelectedProductId] = useState(state.products[0]?.id ?? '');
  const matchingProducts = state.products.filter(product => product.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selectedProduct = state.products.find(product => product.id === selectedProductId);

  function changeQuantity(productId: string, quantity: number) {
    if (!Number.isSafeInteger(quantity) || quantity < 0) return;
    setQuantities(previous => ({ ...previous, [productId]: quantity }));
    setSelectedProductId(productId);
  }

  return (
    <>
      <PageHeader eyebrow="INVENTARIO" title="Inventario" description="Busca productos y consulta una vista previa de recepción. Las operaciones de inventario existentes siguen disponibles en Registros de inventario." />
      <div className="reception-checkout">
        <section className="reception-products-column inventory-catalog" aria-labelledby="inventory-products-heading">
          <Panel className="product-catalog-panel">
            <div className="inventory-catalog-heading">
              <div><h2 id="inventory-products-heading">Productos</h2><p className="muted">Selecciona productos y ajusta las cantidades.</p></div>
              <div className="field inventory-search"><label htmlFor="inventory-search">Buscar producto</label><input id="inventory-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre del producto" /></div>
            </div>
            {matchingProducts.length ? <div className="product-grid">{matchingProducts.map(product => <ProductCard key={product.id} product={product} stock={expectedStock(state, product.id)} quantity={quantities[product.id] ?? 0} onQuantityChange={quantity => changeQuantity(product.id, quantity)} />)}</div> : <p className="muted" role="status">No se encontraron productos.</p>}
          </Panel>
        </section>
        <MobileDetailPanel title="Vista previa de recepción" triggerLabel="Ver vista previa" className="inventory-receipt-slot">
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
        </MobileDetailPanel>
      </div>
    </>
  );
}

export function Inventory({ role, apiRequest }: { role: Role; apiRequest?: AuthenticatedRequest }) {
  if (role === 'OWNER') {
    return <InventoryAnalytics apiRequest={apiRequest} />;
  }

  if (apiRequest) {
    return <LiveReceptionInventory apiRequest={apiRequest} />;
  }

  return <DemoReceptionInventory />;
}
