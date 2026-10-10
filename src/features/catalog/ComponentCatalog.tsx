import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import type { AttendanceVisit } from '../../domain/models';
import { AttendanceCalendar } from '../attendance/AttendanceCalendar';
import { Badge, Button, EmptyState, Field, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';
import { CatalogCharts } from './catalog-charts';
import { demoMovements, demoStock } from './catalog-data';
import type { DemoMovement } from './catalog-data';
import { ThemeControl } from './feedback';

const catalogTabs = ['Componentes', 'Vistas de datos', 'Flujos de trabajo'] as const;
type CatalogTab = typeof catalogTabs[number];

const movementColumns: ColumnDef<DemoMovement>[] = [
  { accessorKey: 'member', header: 'Socio', cell: info => info.getValue<string>() },
  { accessorKey: 'kind', header: 'Tipo', cell: info => info.getValue<string>() },
  { accessorKey: 'amountMinor', header: 'Monto demo', cell: info => `$${(info.getValue<number>() / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` },
  { accessorKey: 'status', header: 'Estado', cell: info => info.getValue<string>() },
  { accessorKey: 'date', header: 'Fecha de muestra', cell: info => info.getValue<string>() },
];

const attendanceExamples: AttendanceVisit[] = [
  { id: 'AS-01', memberId: 'demo-member-01', observedCheckIn: '2026-10-02T14:00:00-06:00', observedCheckOut: '2026-10-02T14:45:00-06:00', autoClosedAt: null, illustrativeSeed: true },
  { id: 'AS-02', memberId: 'demo-member-01', observedCheckIn: '2026-10-03T14:10:00-06:00', observedCheckOut: '2026-10-03T15:00:00-06:00', autoClosedAt: null, illustrativeSeed: true },
  { id: 'AS-03', memberId: 'demo-member-01', observedCheckIn: '2026-10-05T13:00:00-06:00', observedCheckOut: null, autoClosedAt: null, illustrativeSeed: true },
];

function MovementTable() {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: demoMovements,
    columns: movementColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return <TableRegion label="Movimientos de ejemplo"><div className="catalog-table"><table aria-label="Movimientos de ejemplo">
    <caption>Movimientos ficticios; no son cobros ni saldos reales.</caption>
    <thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} scope="col" aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'}>
      {header.isPlaceholder ? null : <button type="button" aria-label={`Ordenar por ${String(header.column.columnDef.header).toLocaleLowerCase('es-MX')}`} onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}</button>}
    </th>)}</tr>)}</thead>
    <tbody>{table.getRowModel().rows.map(row => <tr key={row.id}>{row.getVisibleCells().map(cell => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody>
  </table></div></TableRegion>;
}

function StockTable() {
  return <TableRegion label="Inventario de demostración"><div className="catalog-table"><table>
    <caption>Ejemplo de cálculo: inicial + recibido − vendido − merma = esperado. No compara conteo físico.</caption>
    <thead><tr><th scope="col">Producto</th><th scope="col">Inicial</th><th scope="col">Recibido</th><th scope="col">Vendido</th><th scope="col">Merma</th><th scope="col">Esperado</th></tr></thead>
    <tbody>{demoStock.map(item => <tr key={item.id}><th scope="row">{item.product}</th><td>{item.opening}</td><td>{item.received}</td><td>{item.sold}</td><td>{item.waste}</td><td>{item.expected}</td></tr>)}</tbody>
  </table></div></TableRegion>;
}

function DataViews() {
  const [period, setPeriod] = useState<4 | 12>(4);
  return <div className="bento-grid">
    <Panel className="span-full"><h2>Tabla ordenable</h2><p className="muted">Encabezados activables con teclado; usa el botón de cada columna para ordenar.</p><MovementTable /></Panel>
    <Panel className="span-full"><h2>Comparación y tendencia</h2><p className="muted">Vistas de consulta con equivalentes tabulares y valores exactos para teclado, lector de pantalla y captura.</p>
      <label className="catalog-period">Periodo de análisis (demo)<select aria-label="Periodo de análisis (demo)" value={period} onChange={event => setPeriod(Number(event.target.value) as 4 | 12)}><option value={4}>4 semanas</option><option value={12}>12 semanas</option></select></label>
      <CatalogCharts weeks={period} />
    </Panel>
    <Panel className="span-full"><h2>Inventario ilustrativo</h2><StockTable /></Panel>
    <Panel className="span-full"><AttendanceCalendar visits={attendanceExamples} now="2026-10-10T12:00:00-06:00" /></Panel>
  </div>;
}

function ComponentFiches() {
  return <div className="bento-grid">
    <Panel><h2>Acciones y estados</h2><div className="flow"><Button>Acción principal</Button><Button variant="secondary">Acción secundaria</Button><Button disabled>Acción pendiente</Button></div>
      <p className="muted">La acción pendiente necesita una regla de negocio acordada.</p><div className="flow"><Badge>Sin evaluar</Badge><Badge tone="success">Confirmado</Badge><Badge tone="warning">Pendiente</Badge><Badge tone="error">Error</Badge></div>
      <dl className="component-fiche"><dt>Botón</dt><dd>Primario para la tarea central; secundario para salida o alternativa; disabled con explicación visible.</dd><dt>Estado</dt><dd>Tono y texto se combinan: el color no es la única señal.</dd></dl></Panel>
    <Panel><h2>Campos con contexto</h2><Field id="catalog-name" label="Nombre" placeholder="Nombre de demostración" /><Field id="catalog-error" label="Referencia" error="Escribe una referencia de muestra para continuar." />
      <p className="muted">Las etiquetas permanecen visibles; el error se asocia al campo y no borra lo capturado.</p><dl className="component-fiche"><dt>Campo</dt><dd>Etiqueta, valor, error anunciado y foco visible; evita depender del placeholder.</dd></dl></Panel>
    <Panel><h2>Información y resultado</h2><Notice>Estado desconocido: verifica el resultado antes de repetir una operación.</Notice><Notice tone="warning">La libreta física sigue siendo obligatoria.</Notice><Notice tone="error">Ejemplo de error: los datos capturados se conservan.</Notice><Notice tone="success">Ejemplo de resultado confirmado.</Notice>
      <dl className="component-fiche"><dt>Feedback</dt><dd>Éxito, advertencia, error y desconocido se expresan en texto; una transición no implica una operación.</dd></dl></Panel>
    <Panel><EmptyState title="Sin registros">No hay movimientos para el periodo de muestra. Un estado vacío no equivale a un error.</EmptyState><p className="muted" aria-busy="true">Ejemplo de carga: consultando datos de demostración…</p><Badge tone="warning">Ejemplo de datos desactualizados</Badge>
      <dl className="component-fiche"><dt>Estados</dt><dd>Vacío, carga y desactualizado se distinguen de datos en cero y de un fallo.</dd></dl></Panel>
    <Panel className="span-full"><h2>Pasos y jerarquía</h2><div className="catalog-steps" aria-label="Pasos de un flujo ficticio"><span aria-current="step">1 · Captura</span><span>2 · Revisión</span><span>3 · Resultado</span></div><p className="muted">Indicador solo informativo; cada paso real debe controlar avance y retorno de foco.</p></Panel>
  </div>;
}

export function ComponentCatalog() {
  const [activeTab, setActiveTab] = useState<CatalogTab>(catalogTabs[0]);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const destination = event.key === 'Home' ? 0 : event.key === 'End' ? catalogTabs.length - 1 : (index + direction + catalogTabs.length) % catalogTabs.length;
    if (!direction && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    setActiveTab(catalogTabs[destination]);
    tabRefs.current[destination]?.focus();
  }

  const activeIndex = catalogTabs.indexOf(activeTab);
  return <div className="catalog-page">
    <PageHeader eyebrow="DESARROLLO · SISTEMA COMPARTIDO" title="Componentes compartidos" description="Referencia interactiva de componentes, estados y patrones asociados a los 18 flujos. Los datos son ficticios; no representa operaciones reales." action={<ThemeControl />} />
    <div className="catalog-toolbar"><span className="muted">EvoGym · referencia local de interfaz</span></div>
    <div className="catalog-tabs" role="tablist" aria-label="Secciones del catálogo">
      {catalogTabs.map((tab, index) => <button key={tab} ref={element => { tabRefs.current[index] = element; }} type="button" role="tab" id={`catalog-tab-${index}`} aria-controls="catalog-panel" aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1} className="catalog-tab" onClick={() => setActiveTab(tab)} onKeyDown={event => moveTab(event, index)}>{tab}</button>)}
    </div>
    <section id="catalog-panel" className="catalog-content" role="tabpanel" aria-labelledby={`catalog-tab-${activeIndex}`} tabIndex={0}>
      {activeTab === 'Componentes' && <ComponentFiches />}
      {activeTab === 'Vistas de datos' && <><h2>Vistas de datos</h2><p className="muted">Los gráficos respetan tokens de tema y reducen movimiento según las preferencias del sistema; cada tendencia tiene datos equivalentes fuera del SVG.</p><DataViews /></>}
      {activeTab === 'Flujos de trabajo' && <><h2>Flujos de trabajo</h2><p className="muted">Galería de pantallas de demostración.</p></>}
    </section>
  </div>;
}
