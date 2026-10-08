import { Badge, Button, EmptyState, Field, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';

export function ComponentCatalog() {
  return <><PageHeader eyebrow="DESARROLLO · SISTEMA COMPARTIDO" title="Componentes compartidos" description="Estados de referencia para construir tareas consistentes; no son operaciones reales." />
    <div className="bento-grid">
      <Panel><h2>Acciones y estados</h2><div className="flow"><Button>Acción principal</Button><Button variant="secondary">Acción secundaria</Button><Button disabled>Acción pendiente</Button></div>
        <p className="muted">La acción pendiente necesita una regla de negocio acordada.</p><div className="flow"><Badge>Sin evaluar</Badge><Badge tone="success">Confirmado</Badge><Badge tone="warning">Pendiente</Badge><Badge tone="error">Error</Badge></div></Panel>
      <Panel><h2>Campos con contexto</h2><Field id="catalog-name" label="Nombre" placeholder="Nombre del socio" /><Field id="catalog-error" label="Referencia" error="Escribe la referencia para continuar." /></Panel>
      <Panel><h2>Información y resultado</h2><Notice>Estado desconocido: verifica el resultado antes de repetir una operación.</Notice><Notice tone="warning">La libreta física sigue siendo obligatoria.</Notice><Notice tone="error">No fue posible completar la acción. Los datos capturados se conservan.</Notice><Notice tone="success">Ejemplo de resultado confirmado.</Notice></Panel>
      <Panel><EmptyState title="Sin registros">No hay movimientos para el periodo seleccionado. Un estado vacío no equivale a un error.</EmptyState><p className="muted" aria-busy="true">Ejemplo de carga: consultando datos…</p><Badge tone="warning">Ejemplo de datos desactualizados</Badge></Panel>
      <Panel className="span-full"><h2>Lista tabular</h2><TableRegion label="Ejemplo de tabla"><table><caption>Datos ficticios para revisión visual</caption><thead><tr><th scope="col">Registro</th><th scope="col">Estado</th><th scope="col">Fuente</th></tr></thead><tbody><tr><td>Operación de muestra</td><td>Sin evaluar</td><td>Demostración local</td></tr></tbody></table></TableRegion></Panel>
    </div></>;
}
