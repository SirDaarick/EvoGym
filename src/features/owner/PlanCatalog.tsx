import { useDemo } from '../../demo/DemoProvider';
import { formatMoney } from '../../demo/adapter';
import { plans } from '../../demo/plans';
import { Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';

export function PlanCatalog() {
  const { state } = useDemo();
  return <>
    <PageHeader eyebrow="PROPIETARIO · CATÁLOGO DE SOLO LECTURA" title="Catálogo de planes" description="Precios confirmados en entrevista; las fechas de vigencia y reglas de elegibilidad siguen pendientes de validación." />
    <Panel><TableRegion label="Planes y visitas"><table><caption>MXN · fuente: catálogo confirmado por el propietario</caption><thead><tr><th scope="col">Plan / visita</th><th scope="col">Precio</th><th scope="col">Aplicación</th><th scope="col">Límite en la demo</th></tr></thead><tbody>{plans.map(plan => <tr key={plan.id}><td>{plan.name}</td><td>{formatMoney(plan.amountMinor)}</td><td>{plan.applicability}</td><td>{plan.restriction ?? 'Cobro completo simulado; no concede acceso real.'}</td></tr>)}</tbody></table></TableRegion></Panel>
    <Notice tone="warning">La beca de Box requiere selección del entrenador; no es tarifa general. Estudiantes y Box kids no se aprueban automáticamente. No se calculan fechas mensuales ni periodos de 30 días.</Notice>
    <Panel className="mt-6"><h2>Productos ilustrativos</h2><p className="muted">Precio y cantidad ilustrativos; no confirmados por el propietario. No representan el inventario real.</p><TableRegion label="Productos de demostración"><table><caption>Solo ejemplos para validar el flujo de venta</caption><thead><tr><th scope="col">Producto</th><th scope="col">Precio demo MXN</th><th scope="col">Cantidad inicial demo</th></tr></thead><tbody>{state.products.map(product => <tr key={product.id}><td>{product.name}</td><td>{formatMoney(product.priceMinor)}</td><td>{product.openingQuantity}</td></tr>)}</tbody></table></TableRegion></Panel>
  </>;
}
