import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Chart } from '@tanstack/charts/react';
import { barX, defineChart, text } from '@tanstack/charts';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { pie, polar, radialArc } from '@tanstack/charts/polar';
import { flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cash01Icon, ChartBarBigIcon, CreditCardIcon, PackageIcon } from '@hugeicons/core-free-icons';
import type { Role, ShiftWindow } from '../../domain/models';
import { rolePath } from '../../app/navigation';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { openShift, shiftSummary } from '../../demo/shiftOperations';
import { shiftDashboard, type ShiftActivityRow, type ShiftInventoryRow } from '../../demo/shiftDashboard';
import { Badge, Button, Field, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';
import { ShiftCloseDialog } from './ShiftCloseDialog';
import { ShiftOpenModal } from './ShiftOpenModal';
import './ShiftDashboard.css';

export function Shifts({ role }: { role: Role }) {
  const { state, transact } = useDemo();
  const [selectedId, setSelectedId] = useState(state.currentShiftId);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [closingOpen, setClosingOpen] = useState(false);
  const [openModalOpen, setOpenModalOpen] = useState(false);
  const selected = role === 'RECEPTION' ? state.currentShiftId : selectedId;
  const shift = state.shifts.find(item => item.id === selected);
  const current = state.shifts.find(item => item.id === state.currentShiftId);
  const summary = shiftSummary(state, selected);
  const dashboard = shiftDashboard(state, selected);
  const expectedCashBreakdown = {
    openingMinor: shift?.openingCashMinor ?? 0,
    receiptsMinor: state.ledger.filter(item => item.shiftId === selected && item.method === 'cash').reduce((total, item) => total + item.amountMinor, 0),
    extrasMinor: (state.extras ?? []).filter(item => item.shiftId === selected).reduce((total, item) => total + item.amountMinor, 0),
    expensesMinor: (state.expenses ?? []).filter(item => item.shiftId === selected).reduce((total, item) => total + item.amountMinor, 0),
  };
  const cash = (value: number | undefined) => value === undefined ? 'Sin registrar' : `${formatMoney(value)} MXN`;
  if (!shift || !dashboard) return <><PageHeader eyebrow="TURNO" title="Turno de trabajo" description="Resumen operativo del turno seleccionado." /><Panel><p>No hay un turno disponible para mostrar.</p></Panel></>;
  const shiftDate = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(shift.openedAt));
  const shiftName = shift.window.startsWith('06:00') ? 'Matutino' : 'Vespertino';
  const isCurrentOpenShift = shift.status === 'open' && selected === state.currentShiftId;
  const closeDialog = () => { setClosingOpen(false); setTimeout(() => document.getElementById('shift-close-trigger')?.focus(), 0); };
  return <>
    <PageHeader eyebrow="TURNO · CONTROL MANUAL" title={`Turno: ${shiftName} ${shiftDate}`} description="Control de cobros, efectivo y actividad del turno."
      action={isCurrentOpenShift ? <Button id="shift-close-trigger" onClick={() => setClosingOpen(true)}>Cerrar turno</Button> : <Button id="shift-open-trigger" onClick={() => setOpenModalOpen(true)}>Abrir Turno</Button>} />
    <p className="shift-status-label">{shift.status === 'open' ? 'Turno abierto' : 'Turno cerrado'}</p>
    {!closingOpen && !openModalOpen && message && <div role={error ? 'alert' : 'status'}><Notice tone={error ? 'error' : 'success'}>{message}</Notice></div>}
    {role === 'OWNER' && <div className="field"><label htmlFor="shift-selection">Turno a consultar</label><select id="shift-selection" value={selectedId} onChange={event => { setSelectedId(event.target.value); setClosingOpen(false); }}>{state.shifts.map(item => <option key={item.id} value={item.id}>{item.id} · {item.window} · {item.status === 'open' ? 'Abierto' : 'Cerrado'}</option>)}</select></div>}
    {isCurrentOpenShift && closingOpen && <ShiftCloseDialog key={shift.id} isOpen shiftId={shift.id} shiftName={shiftName}
      expectedCashMinor={summary.expectedCashMinor} expectedCashBreakdown={expectedCashBreakdown} onClose={closeDialog} onSuccess={() => { setClosingOpen(false); setError(false); setMessage('Cierre registrado.'); }} />}
    {openModalOpen && <ShiftOpenModal isOpen state={state} onClose={() => setOpenModalOpen(false)} onConfirm={data => {
      const id = `shift-${crypto.randomUUID()}`;
      const result = transact(currentState => openShift(currentState, {
        id,
        window: data.window,
        openingCashMinor: data.openingCashMinor,
        cashDenominations: data.cashDenominations,
        openingCashDenominations: data.cashDenominations,
        responsibleStaffId: data.responsibleStaffId,
        responsibleStaffName: data.responsibleStaffName,
        stockAdjustments: data.stockAdjustments,
        counts: data.counts,
      }));
      setError(result.status === 'error');
      setMessage(result.status === 'error' ? result.message : 'Turno abierto exitosamente.');
      if (result.status === 'ok') {
        setSelectedId(id);
      }
    }} />}
    <div className="shift-kpis">
      <Panel className="shift-kpi"><span className="shift-kpi-icon"><HugeiconsIcon icon={ChartBarBigIcon} size={22} /></span><h2>Cobros confirmados</h2><p className="shift-kpi-value">{cash(dashboard.confirmedMinor)}</p><p>Operaciones {dashboard.activities.reduce((total, item) => total + item.count, 0)} · Pendiente {cash(dashboard.pendingTransferMinor)}</p></Panel>
      <Panel className="shift-kpi"><span className="shift-kpi-icon"><HugeiconsIcon icon={Cash01Icon} size={22} /></span><h2>Gastos</h2><p className="shift-kpi-value">{cash(dashboard.expenseMinor)}</p><p>{dashboard.expenseCount} {dashboard.expenseCount === 1 ? 'movimiento' : 'movimientos'}</p></Panel>
      <Panel className="shift-kpi"><span className="shift-kpi-icon"><HugeiconsIcon icon={CreditCardIcon} size={22} /></span><h2>Efectivo esperado</h2><p className="shift-kpi-value">{cash(shift.status === 'closed' ? shift.expectedCashAtCloseMinor : dashboard.expectedCashMinor)}</p><details className="shift-formula"><summary>Ver cálculo</summary><p>Fondo + efectivo cobrado + Extra − Gastos</p></details>{shift.status === 'open' && dashboard.expectedCashMinor < 0 && <Notice tone="warning">El efectivo esperado es negativo; revisa los movimientos.</Notice>}</Panel>
    </div>
    <div className="shift-dashboard-grid mt-6"><Panel className="shift-method-panel"><h2><HugeiconsIcon icon={CreditCardIcon} size={20} /> Cobros por método</h2><ShiftPaymentMethods paymentMethods={dashboard.paymentMethods} pendingTransferMinor={dashboard.pendingTransferMinor} /></Panel>
      <Panel className="shift-activity-panel"><h2><HugeiconsIcon icon={ChartBarBigIcon} size={20} /> Actividad</h2><ShiftCharts activities={dashboard.activities} /></Panel></div>
    <Panel className="mt-6"><h2>Movimientos financieros</h2><ShiftActivityTable key={shift.id} rows={dashboard.rows} /></Panel>
    <Panel className="mt-6"><h2><HugeiconsIcon icon={PackageIcon} size={20} /> Movimientos de inventario</h2><ShiftInventoryTable key={`inventory-${shift.id}`} rows={dashboard.inventoryRows} /></Panel>
    {(shift.status === 'closed' || current?.status === 'closed') && <Panel className="mt-6"><h2>Cierre y continuidad</h2><p className="muted">Reapertura y correcciones excepcionales no disponibles.</p>{shift.closedAt && <p>Cierre: {shift.closedAt}</p>}
      {shift.status === 'closed' && (shift.cashDenominations ? <TableRegion label="Conteo registrado"><table><caption>Desglose de efectivo guardado al cerrar</caption><thead><tr><th scope="col">Valor MXN</th><th scope="col">Cantidad</th><th scope="col">Subtotal MXN</th></tr></thead><tbody>{shift.cashDenominations.filter(row => row.quantity > 0).map(row => <tr key={row.valueMinor}><td>{formatMoney(row.valueMinor)}</td><td>{row.quantity}</td><td>{formatMoney(row.valueMinor * row.quantity)}</td></tr>)}</tbody></table></TableRegion> : <p>Sin desglose por denominación registrado.</p>)}
      {current?.status === 'closed' && <div className="mt-6 clay-card" style={{ padding: '1.25rem', border: '1px solid var(--color-divider)', borderRadius: '18px', background: 'var(--color-surface)', boxShadow: 'var(--shadow-clay)' }}>
        <h3>Abrir siguiente turno</h3>
        <p className="muted" style={{ margin: '0 0 1rem' }}>El turno anterior ha finalizado. Realiza el conteo de caja chica y la verificación de inventario inicial para comenzar.</p>
        <Button id="shift-open-bottom-trigger" onClick={() => setOpenModalOpen(true)}>Abrir turno</Button>
      </div>}
      <div role={error ? 'alert' : 'status'}>{message && <Notice tone={error ? 'error' : 'success'}>{message}</Notice>}</div>
    </Panel>}
    <div className="flow"><Link to={rolePath(role, 'sales')}>Registrar venta</Link><Link to={rolePath(role, 'inventory')}>Revisar conteo de inventario</Link></div>
  </>;
}

function ShiftPaymentMethods({ paymentMethods, pendingTransferMinor }: { paymentMethods: { method: 'cash' | 'card'; count: number; amountMinor: number }[]; pendingTransferMinor: number }) {
  const labels = { cash: 'Efectivo', card: 'Tarjeta' };
  const [activeMethod, setActiveMethod] = useState<'cash' | 'card' | null>(null);
  const confirmedOperationCount = paymentMethods.reduce((total, item) => total + item.count, 0);
  const slices = paymentMethods.map(item => ({ ...item, label: labels[item.method], percent: confirmedOperationCount ? item.count / confirmedOperationCount * 100 : 0 }));
  const donut = defineChart({ marks: [polar({ inset: 8, radiusRatio: 0.92, marks: [radialArc(pie(slices, { value: 'count' }), {
    innerRadius: ({ radius }) => radius * 0.66, cornerRadius: 5, color: 'method', key: 'method',
  })], scales: { angle: null, radius: null } })], scales: { x: null, y: null },
    color: { domain: ['cash', 'card'], range: ['#FC6C06', '#2455A4'] }, keyboard: true });
  return <div className="shift-payment-methods">
    <div className="shift-donut-wrap" aria-label={`Total de cobros confirmados ${confirmedOperationCount} operaciones`}>
      {slices.length ? <Chart definition={donut} height={210} ariaLabel="Operaciones confirmadas por método de pago" /> : <div className="shift-donut-empty" role="img" aria-label="Sin cobros confirmados" />}
      <div className="shift-donut-center"><strong>{confirmedOperationCount}</strong><span>operaciones</span></div>
    </div>
    <div className="shift-payment-legend" aria-label="Detalle por método">{slices.map(item => <button type="button" className={`shift-legend-item shift-legend-${item.method}`} key={item.method} onMouseEnter={() => setActiveMethod(item.method)} onFocus={() => setActiveMethod(item.method)} onBlur={() => setActiveMethod(null)} onMouseLeave={() => setActiveMethod(null)} aria-label={`${labels[item.method]}: ${item.count} operaciones, ${Math.round(item.percent)} por ciento, ${formatMoney(item.amountMinor)} MXN`}>
      <span className="shift-legend-dot" /> <span>{labels[item.method]}</span><strong>{item.count}</strong>
    </button>)}</div>
    {activeMethod && slices.filter(item => item.method === activeMethod).map(item => <p className="shift-method-detail" role="status" key={item.method}>{labels[item.method]} · {item.count} operaciones · {Math.round(item.percent)}% · {formatMoney(item.amountMinor)} MXN</p>)}
    {slices.map(item => <span className="sr-only" key={`amount-${item.method}`}>{labels[item.method]}: {item.count} operaciones · {formatMoney(item.amountMinor)} MXN</span>)}
    <p className="shift-transfer-pending">Pendiente <strong>{formatMoney(pendingTransferMinor)} MXN</strong></p>
  </div>;
}

function ShiftCharts({ activities }: { activities: { family: string; count: number; amountMinor: number }[] }) {
  const labels: Record<string, string> = { membership: 'Membresías', product: 'Productos', visit: 'Visitas', supplement: 'Suplementos', glove: 'Guantes', locker: 'Casilleros' };
  const rows = activities.map(item => ({ family: labels[item.family] ?? item.family, count: item.count, amountMinor: item.amountMinor })).filter(item => item.count > 0);
  if (!rows.length) return <p className="shift-chart-empty">Sin operaciones confirmadas en este turno.</p>;
  const countChart = defineChart({ marks: [barX(rows, { x: 'count', y: 'family', fill: '#FC6C06', inset: 3, radius: 4 }),
    text(rows, { x: 'count', y: 'family', text: 'count', dx: 8, anchor: 'start', fill: 'var(--color-ink)', fontSize: 12, fontWeight: 700, key: 'family' })], scales: {
    x: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'Operaciones' } }, y: { scale: () => scaleBand().padding(0.16) },
  } });
  return <div className="shift-chart-grid"><section aria-label="Operaciones confirmadas por familia"><Chart definition={countChart} height={200} ariaLabel="Operaciones confirmadas por familia" />
    <div className="shift-chart-amounts" aria-label="Montos confirmados por familia">{rows.map(item => <span key={item.family}>{item.family} {formatMoney(item.amountMinor)} MXN</span>)}</div></section></div>;
}

function ShiftActivityTable({ rows }: { rows: ShiftActivityRow[] }) {
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState('all');
  const [method, setMethod] = useState('all');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'recordedAt', desc: true }]);
  const filtered = useMemo(() => rows.filter(row => {
    const needle = query.trim().toLocaleLowerCase('es-MX');
    return (!needle || `${row.description} ${row.actor ?? ''} ${row.reference ?? ''}`.toLocaleLowerCase('es-MX').includes(needle))
      && (family === 'all' || row.family === family)
      && (method === 'all' || row.method === method)
  }), [rows, query, family, method]);
  const columns = useMemo<ColumnDef<ShiftActivityRow>[]>(() => [
    { accessorKey: 'recordedAt', header: 'Fecha y hora', cell: ({ getValue }) => new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' }).format(new Date(String(getValue()))) },
    {
      accessorKey: 'description',
      header: 'Detalle',
      cell: ({ row }) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span>{row.original.description}</span>
          {row.original.isOvertime && (
            <span
              className="badge-overtime"
              title="Venta en corte de caja / transición: asignada como Overtime para no afectar el corte anterior y deslindar al siguiente turno en inventario"
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#C2410C',
                background: '#FFF3E7',
                border: '1px solid #FDBA74',
                padding: '1px 6px',
                borderRadius: '999px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
              }}
            >
              ⚡ Overtime
            </span>
          )}
        </span>
      ),
    },
    { accessorKey: 'actor', header: 'Comprador / persona', cell: ({ getValue }) => getValue<string | undefined>() ?? '—' },
    { accessorKey: 'method', header: 'Método de pago', cell: ({ row }) => <>{({ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' }[row.original.method ?? ''] ?? '—')}{row.original.status === 'pending' && <Badge tone="warning">Pendiente</Badge>}</> },
    { accessorKey: 'amountMinor', header: 'Monto', cell: ({ getValue }) => { const amount = getValue<number | undefined>(); return amount === undefined ? '—' : formatMoney(amount); } },
  ], []);
  const table = useReactTable({ data: filtered, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize: 10 } } });
  return <>
    <div className="shift-table-filters"><label>Buscar<input aria-label="Buscar actividad" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Tipo<select aria-label="Filtrar por tipo" value={family} onChange={event => setFamily(event.target.value)}><option value="all">Todos</option>{[...new Set(rows.map(row => row.family))].map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Método<select aria-label="Filtrar por método" value={method} onChange={event => setMethod(event.target.value)}><option value="all">Todos</option>{[...new Set(rows.map(row => row.method).filter((item): item is string => Boolean(item)))].map(item => <option key={item}>{item}</option>)}</select></label>
      </div>
    <TableRegion label="Actividad del turno"><table><caption>Movimientos financieros del turno · montos en MXN.</caption><thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} scope="col" aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'}><button type="button" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() === 'asc' ? ' ↑' : header.column.getIsSorted() === 'desc' ? ' ↓' : ''}</button></th>)}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map(row => <tr key={row.id}>{row.getVisibleCells().map(cell => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}{table.getRowModel().rows.length === 0 && <tr><td colSpan={columns.length}>No hay filas que coincidan con los filtros.</td></tr>}</tbody></table></TableRegion>
    <div className="shift-pagination"><span>{filtered.length} movimientos · página {table.getState().pagination.pageIndex + 1} de {Math.max(1, table.getPageCount())}</span><label>Filas por página<select aria-label="Filas por página" value={table.getState().pagination.pageSize} onChange={event => table.setPageSize(Number(event.target.value))}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label><Button variant="secondary" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>Anterior</Button><Button variant="secondary" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>Siguiente</Button></div>
  </>;
}

function ShiftInventoryTable({ rows }: { rows: ShiftInventoryRow[] }) {
  const [query, setQuery] = useState('');
  const [movement, setMovement] = useState('all');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'recordedAt', desc: true }]);
  const filtered = useMemo(() => rows.filter(row => (!query || `${row.product} ${row.movement}`.toLocaleLowerCase('es-MX').includes(query.trim().toLocaleLowerCase('es-MX')))
    && (movement === 'all' || row.movement === movement)), [rows, query, movement]);
  const columns = useMemo<ColumnDef<ShiftInventoryRow>[]>(() => [
    { accessorKey: 'recordedAt', header: 'Fecha y hora', cell: ({ getValue }) => new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' }).format(new Date(String(getValue()))) },
    { accessorKey: 'movement', header: 'Movimiento' }, { accessorKey: 'product', header: 'Producto' }, { accessorKey: 'quantity', header: 'Cantidad / resultado' },
  ], []);
  const table = useReactTable({ data: filtered, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize: 10 } } });
  return <>
    <div className="shift-inventory-filters"><label>Buscar producto<input aria-label="Buscar inventario" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Movimiento<select aria-label="Filtrar inventario por movimiento" value={movement} onChange={event => setMovement(event.target.value)}><option value="all">Todos</option><option>Reposición</option><option>Merma</option><option>Conteo físico</option></select></label></div>
    <TableRegion label="Movimientos de inventario"><table><caption>Reposiciones, mermas y conteos físicos.</caption><thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} scope="col" aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'}><button type="button" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() === 'asc' ? ' ↑' : header.column.getIsSorted() === 'desc' ? ' ↓' : ''}</button></th>)}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map(row => <tr key={row.id}>{row.getVisibleCells().map(cell => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}{!table.getRowModel().rows.length && <tr><td colSpan={columns.length}>No hay movimientos de inventario.</td></tr>}</tbody></table></TableRegion>
    <div className="shift-pagination"><span>{filtered.length} movimientos · página {table.getState().pagination.pageIndex + 1} de {Math.max(1, table.getPageCount())}</span><label>Filas por página<select aria-label="Filas de inventario por página" value={table.getState().pagination.pageSize} onChange={event => table.setPageSize(Number(event.target.value))}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label><Button variant="secondary" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>Anterior</Button><Button variant="secondary" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>Siguiente</Button></div>
  </>;
}
