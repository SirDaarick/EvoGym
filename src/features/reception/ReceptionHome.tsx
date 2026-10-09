import { Link } from 'react-router';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney } from '../../demo/adapter';
import { expectedStock } from '../../demo/inventoryOperations';
import { EmptyState, Notice, PageHeader, Panel } from '../../shared/ui';
import { OwnerQuestions } from '../demo/OwnerQuestions';

export function ReceptionHome() {
  const { state } = useDemo();
  return <>
    <PageHeader eyebrow="RECEPCIÓN · INICIO" title="Inicio de recepción" description="Socios y ventas, a un paso." />
    <div className="flow reception-shortcuts">
      <Link className="button button-secondary" to="/reception/members">Buscar socio</Link>
      <Link className="button button-primary" to="/reception/sales">Registrar venta</Link>
      <Link to="/reception/shifts">Revisar turno</Link>
    </div>
    <Panel><h2>Productos de demostración</h2>
      <p className="muted">El carrito se agregará en el siguiente bloque. Por ahora registra la venta en Ventas.</p>
      {state.products.length ? <div className="product-grid">{state.products.map(product => <article className="product-card" key={product.id}>
        <div className="product-placeholder" aria-hidden="true">▧</div>
        <h3>{product.name}</h3><p className="product-price">{formatMoney(product.priceMinor)} MXN</p>
        <p className="muted">Disponibles en demo: {expectedStock(state, product.id)}</p>
      </article>)}</div> : <EmptyState title="Sin productos">Revisa el inventario de demostración.</EmptyState>}
      <Notice>Imágenes pendientes · Los productos, precios y existencias son ilustrativos.</Notice>
    </Panel>
    <OwnerQuestions ids={['Q-11', 'Q-12', 'Q-14']} />
  </>;
}
