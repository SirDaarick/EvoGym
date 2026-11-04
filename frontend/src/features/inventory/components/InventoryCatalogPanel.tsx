import type { ReactNode } from 'react';
import { Panel } from '../../../shared/ui';

export function InventoryCatalogPanel({
  search,
  onSearchChange,
  children,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
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
              onChange={event => onSearchChange(event.target.value)}
              placeholder="Nombre del producto"
            />
          </div>
        </div>
        {children}
      </Panel>
    </section>
  );
}
