import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { barY, defineChart } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { tooltip } from '@tanstack/charts/tooltip';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Building01Icon,
  Cash01Icon,
  Coins01Icon,
  FilterIcon,
  Invoice01Icon,
  PencilEdit02Icon,
  PrinterIcon,
  Search01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';

import { useDemo } from '../../demo/DemoProvider';
import { formatMoney } from '../../demo/adapter';
import {
  useFixedCosts,
  saveFixedCosts,
} from '../../demo/fixedCostsStore';
import { useStaff } from '../staff/staffStore';
import {
  getExpenseReport,
  type ExpenseCategoryKey,
  type ExpensePeriod,
  type ExpenseReportItem,
  type MajorCostBlock,
  type StaffPayrollItem,
} from '../../demo/expenseReportSelector';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Panel,
  TableRegion,
} from '../../shared/ui';
import logo from '../../../Logo_Evo.png';
import './ExpenseReport.css';

const PERIOD_OPTIONS: { id: ExpensePeriod; label: string }[] = [
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'all', label: 'Todo' },
];

type ExpenseFilterCategory = 'all' | 'consumibles' | 'limpieza' | 'mantenimiento' | 'servicios';

const FILTER_PILLS: { id: ExpenseFilterCategory; label: string; color: string }[] = [
  { id: 'all', label: 'Todas', color: 'var(--color-primary)' },
  { id: 'consumibles', label: 'Consumibles', color: '#2455A4' },
  { id: 'limpieza', label: 'Limpieza', color: '#0284C7' },
  { id: 'mantenimiento', label: 'Mantenimiento', color: '#EA580C' },
  { id: 'servicios', label: 'Servicios', color: '#FC6C06' },
];

function categoryTone(
  categoryKey: ExpenseCategoryKey
): 'neutral' | 'warning' | 'error' | 'success' {
  switch (categoryKey) {
    case 'servicios':
    case 'mantenimiento_piso':
    case 'mantenimiento_peso':
    case 'mantenimiento_cardio':
    case 'mantenimiento_box':
      return 'warning';
    case 'consumibles':
    case 'limpieza':
    case 'general':
    default:
      return 'neutral';
  }
}

export function ExpenseReport() {
  const { state } = useDemo();
  const fixedCostsConfig = useFixedCosts();
  const staffList = useStaff();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'variables' | 'fixed'>('variables');
  const [period, setPeriod] = useState<ExpensePeriod>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<ExpenseFilterCategory>('all');
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'recordedAt', desc: true },
  ]);

  // Adjust fixed costs modal state
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [rentInput, setRentInput] = useState('');
  const [aguaInput, setAguaInput] = useState('');
  const [luzInput, setLuzInput] = useState('');
  const [internetInput, setInternetInput] = useState('');
  const [basuraInput, setBasuraInput] = useState('');
  const [modalError, setModalError] = useState('');

  const report = useMemo(
    () =>
      getExpenseReport(state, period, undefined, {
        fixedCosts: fixedCostsConfig,
        staff: staffList,
      }),
    [state, period, fixedCostsConfig, staffList]
  );

  function openAdjustModal() {
    setRentInput((fixedCostsConfig.rentMinor / 100).toString());
    setAguaInput((fixedCostsConfig.aguaMinor / 100).toString());
    setLuzInput((fixedCostsConfig.luzMinor / 100).toString());
    setInternetInput((fixedCostsConfig.internetMinor / 100).toString());
    setBasuraInput((fixedCostsConfig.basuraMinor / 100).toString());
    setModalError('');
    setIsAdjustModalOpen(true);
  }

  function closeAdjustModal() {
    setIsAdjustModalOpen(false);
    setModalError('');
  }

  function handleSaveFixedCosts(e: React.FormEvent) {
    e.preventDefault();
    const r = parseFloat(rentInput);
    const a = parseFloat(aguaInput);
    const l = parseFloat(luzInput);
    const i = parseFloat(internetInput);
    const b = parseFloat(basuraInput);

    if (
      Number.isNaN(r) || r < 0 ||
      Number.isNaN(a) || a < 0 ||
      Number.isNaN(l) || l < 0 ||
      Number.isNaN(i) || i < 0 ||
      Number.isNaN(b) || b < 0
    ) {
      setModalError('Todos los montos deben ser números positivos válidos (mayores o iguales a 0).');
      return;
    }

    saveFixedCosts({
      rentMinor: Math.round(r * 100),
      aguaMinor: Math.round(a * 100),
      luzMinor: Math.round(l * 100),
      internetMinor: Math.round(i * 100),
      basuraMinor: Math.round(b * 100),
    });

    closeAdjustModal();
  }

  // Filter items in Tab 1
  const filteredItems = useMemo(() => {
    return report.items.filter(item => {
      if (selectedFilter !== 'all') {
        if (selectedFilter === 'mantenimiento') {
          if (!item.categoryKey.startsWith('mantenimiento')) return false;
        } else if (item.categoryKey !== selectedFilter) {
          return false;
        }
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchConcept = item.concept.toLowerCase().includes(query);
        const matchPayee = item.payeeName.toLowerCase().includes(query);
        const matchShift =
          item.shiftWindow.toLowerCase().includes(query) ||
          item.shiftId.toLowerCase().includes(query);
        return matchConcept || matchPayee || matchShift;
      }
      return true;
    });
  }, [report.items, selectedFilter, searchQuery]);

  // Counts for filter pills
  const pillCounts = useMemo(() => {
    const counts: Record<ExpenseFilterCategory, number> = {
      all: report.items.length,
      consumibles: 0,
      limpieza: 0,
      mantenimiento: 0,
      servicios: 0,
    };
    for (const item of report.items) {
      if (item.categoryKey === 'consumibles') counts.consumibles += 1;
      else if (item.categoryKey === 'limpieza') counts.limpieza += 1;
      else if (item.categoryKey.startsWith('mantenimiento')) counts.mantenimiento += 1;
      else if (item.categoryKey === 'servicios') counts.servicios += 1;
    }
    return counts;
  }, [report.items]);

  // TanStack Chart Definition comparing major cost blocks
  const chartDefinition = useMemo(() => {
    if (!report.majorCostBlocks.length) return null;
    return defineChart({
      marks: [
        barY(report.majorCostBlocks, {
          x: 'name',
          y: 'amount',
          fill: (d: MajorCostBlock) => d.color,
          radius: 4,
        }),
      ],
      scales: {
        x: {
          scale: () => scaleBand().padding(0.28),
        },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: {
            label: 'Total MXN',
            ticks: { format: (val: number) => `$${val.toLocaleString()}` },
          },
        },
      },
      tooltip,
      keyboard: true,
    });
  }, [report.majorCostBlocks]);

  // TanStack Table columns for Variable Expenses
  const columns = useMemo<ColumnDef<ExpenseReportItem>[]>(
    () => [
      {
        accessorKey: 'recordedAt',
        header: ({ column }) => (
          <button
            type="button"
            className="table-sort-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Fecha / Hora {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <div className="expense-date-cell">
            <span className="expense-date-val">{row.original.formattedDate}</span>
            <span className="expense-time-val">{row.original.formattedTime}</span>
          </div>
        ),
      },
      {
        accessorKey: 'shiftWindow',
        header: ({ column }) => (
          <button
            type="button"
            className="table-sort-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Turno {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <div className="expense-shift-cell">
            <span className="expense-shift-window">{row.original.shiftWindow}</span>
            <span className="expense-shift-id">{row.original.shiftId}</span>
          </div>
        ),
      },
      {
        accessorKey: 'category',
        header: ({ column }) => (
          <button
            type="button"
            className="table-sort-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Categoría {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <Badge tone={categoryTone(row.original.categoryKey)}>
            {row.original.category}
          </Badge>
        ),
      },
      {
        accessorKey: 'concept',
        header: ({ column }) => (
          <button
            type="button"
            className="table-sort-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Concepto {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <span className="expense-concept-text">{row.original.concept}</span>
        ),
      },
      {
        accessorKey: 'payeeName',
        header: ({ column }) => (
          <button
            type="button"
            className="table-sort-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Proveedor / Responsable {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <span className="expense-payee-text">{row.original.payeeName}</span>
        ),
      },
      {
        accessorKey: 'amountMinor',
        header: ({ column }) => (
          <button
            type="button"
            className="table-sort-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Monto {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <strong className="expense-amount-val">{row.original.amountFormatted} MXN</strong>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: filteredItems,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="expense-report-container">
      {/* Printable Document Header (Isolates during window.print()) */}
      <div className="expense-print-header" aria-hidden="true">
        <div className="expense-print-brand">
          <img src={logo} alt="EvoGym" className="expense-print-logo" />
          <div>
            <h1 className="expense-print-title">EvoGym — Reporte Oficial de Gastos y Estructura</h1>
            <p className="expense-print-subtitle">
              Punto de equilibrio: {report.fixedCosts.dailyBreakEvenFormatted}/día · Fijo mensual: {report.fixedCosts.totalFixedMonthlyFormatted} · Periodo: {report.dateRange.from} al {report.dateRange.to}
            </p>
          </div>
        </div>
        <div className="expense-print-badge">
          <strong>Auditoría Contable Oficial</strong>
          <p>Fuente: Matriz de Costos & Registros de Caja</p>
        </div>
      </div>

      {/* Screen Header */}
      <PageHeader
        eyebrow="PROPIETARIO · FINANZAS OPERATIVAS"
        title="Reporte y exportación de gastos"
        description="Estructura de costos fijos, nómina operativa y salidas de efectivo por compras de turno."
        action={
          <Button
            variant="secondary"
            className="expense-export-btn"
            onClick={() => window.print()}
            aria-label="Exportar reporte (PDF)"
            title="Exportar reporte a PDF mediante diálogo de impresión"
          >
            <HugeiconsIcon icon={PrinterIcon} size={18} aria-hidden="true" />
            <span>Exportar reporte (PDF)</span>
          </Button>
        }
      />

      {/* Bento Top Row: 3 Business KPIs */}
      <div className="expense-kpi-grid">
        <Panel className="expense-kpi-panel">
          <div className="expense-kpi-header">
            <p className="expense-kpi-label">Punto de equilibrio</p>
            <div className="expense-kpi-icon-wrap" aria-hidden="true">
              <HugeiconsIcon icon={Invoice01Icon} size={20} />
            </div>
          </div>
          <p className="expense-kpi-value">{report.kpis.dailyBreakEvenFormatted} <span className="expense-kpi-unit">MXN/día</span></p>
          <p className="expense-kpi-footer">
            Fijo mensual: <strong>{report.kpis.totalFixedMonthlyFormatted} MXN</strong> ({formatMoney(report.fixedCosts.perShiftBreakEvenMinor)}/turno)
          </p>
        </Panel>

        <Panel className="expense-kpi-panel">
          <div className="expense-kpi-header">
            <p className="expense-kpi-label">Gastos variables del período</p>
            <div className="expense-kpi-icon-wrap" aria-hidden="true">
              <HugeiconsIcon icon={Coins01Icon} size={20} />
            </div>
          </div>
          <p className="expense-kpi-value">{report.kpis.totalFormatted} MXN</p>
          <p className="expense-kpi-footer">
            {report.kpis.count === 1
              ? '1 registro de salida'
              : `${report.kpis.count} registros de salida`} · Caja chica / compras
          </p>
        </Panel>

        <Panel className="expense-kpi-panel">
          <div className="expense-kpi-header">
            <p className="expense-kpi-label">Total comprometido</p>
            <div className="expense-kpi-icon-wrap" aria-hidden="true">
              <HugeiconsIcon icon={Cash01Icon} size={20} />
            </div>
          </div>
          <p className="expense-kpi-value">{report.kpis.consolidatedTotalFormatted} MXN</p>
          <p className="expense-kpi-footer">
            Fijo ({report.kpis.proratedFixedFormatted}) + Variables ({report.kpis.totalFormatted})
          </p>
        </Panel>
      </div>

      {/* Visual Organizer: TanStack Chart & Major Cost Blocks */}
      <div className="expense-visual-bento">
        <Panel className="expense-chart-panel">
          <h2 className="expense-panel-title">Comparativa de bloques de costo</h2>
          <p className="expense-panel-desc">
            Distribución presupuestal entre nómina fija, renta de local, servicios y compras variables
          </p>
          <div className="expense-chart-container">
            {chartDefinition ? (
              <Chart
                definition={chartDefinition}
                height={230}
                ariaLabel="Gráfico de barras comparando bloques de costo"
              />
            ) : (
              <EmptyState title="Sin datos visuales">
                No hay información presupuestal disponible.
              </EmptyState>
            )}
          </div>
        </Panel>

        <Panel className="expense-chart-panel">
          <h2 className="expense-panel-title">Estructura presupuestal</h2>
          <p className="expense-panel-desc">
            Desglose porcentual sobre el total comprometido del período
          </p>
          <div className="expense-category-cards">
            {report.majorCostBlocks.map(block => (
              <div key={block.name} className="expense-category-card">
                <div className="expense-cat-meta">
                  <span
                    className="expense-cat-color-bar"
                    style={{ backgroundColor: block.color }}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="expense-cat-name">{block.name}</p>
                    <p className="expense-cat-count">{block.label}</p>
                  </div>
                </div>
                <div className="expense-cat-figures">
                  <p className="expense-cat-amount">{block.amountFormatted} MXN</p>
                  <p className="expense-cat-pct">{block.percent}% del total</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Two Tabbed Sub-views (Screen mode controls) */}
      <div className="expense-tab-nav" role="tablist" aria-label="Sub-vistas del reporte de gastos">
        <button
          type="button"
          role="tab"
          id="tab-variables"
          aria-selected={activeTab === 'variables'}
          aria-controls="panel-variables"
          className={`expense-tab-btn ${activeTab === 'variables' ? 'active' : ''}`}
          onClick={() => setActiveTab('variables')}
        >
          <HugeiconsIcon icon={Coins01Icon} size={16} aria-hidden="true" />
          <span>Gastos Variables y Caja Chica</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-fixed"
          aria-selected={activeTab === 'fixed'}
          aria-controls="panel-fixed"
          className={`expense-tab-btn ${activeTab === 'fixed' ? 'active' : ''}`}
          onClick={() => setActiveTab('fixed')}
        >
          <HugeiconsIcon icon={Building01Icon} size={16} aria-hidden="true" />
          <span>Estructura Fija y Nómina</span>
        </button>
      </div>

      {/* PESTAÑA 1: GASTOS VARIABLES Y CAJA CHICA */}
      <div
        id="panel-variables"
        role="tabpanel"
        aria-labelledby="tab-variables"
        className={`expense-subview ${activeTab === 'variables' ? 'view-active' : 'view-hidden'} print-section`}
      >
        {/* Controls Bar: Period selector & Search */}
        <Panel className="expense-controls-panel">
          <div className="expense-controls-row">
            <div
              className="expense-period-group"
              role="group"
              aria-label="Seleccionar periodo de reporte de gastos"
            >
              {PERIOD_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  className={`expense-period-btn ${period === opt.id ? 'active' : ''}`}
                  aria-pressed={period === opt.id}
                  onClick={() => setPeriod(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <p className="expense-period-range">
              Rango: <strong>{report.dateRange.from}</strong> al <strong>{report.dateRange.to}</strong>
            </p>

            <div className="expense-search-wrapper">
              <span className="expense-search-icon" aria-hidden="true">
                <HugeiconsIcon icon={Search01Icon} size={16} />
              </span>
              <input
                type="search"
                className="expense-search-input"
                placeholder="Buscar por concepto o proveedor..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                aria-label="Buscar gastos por concepto o proveedor"
              />
            </div>
          </div>

          {/* Category Filter Pills */}
          <div
            className="expense-category-filters"
            role="group"
            aria-label="Filtrar gastos por categoría"
          >
            <span className="expense-filter-label">
              <HugeiconsIcon icon={FilterIcon} size={14} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Categoría:
            </span>
            {FILTER_PILLS.map(pill => {
              const count = pillCounts[pill.id];
              return (
                <button
                  key={pill.id}
                  type="button"
                  className={`expense-filter-pill ${selectedFilter === pill.id ? 'active' : ''}`}
                  aria-pressed={selectedFilter === pill.id}
                  onClick={() => setSelectedFilter(pill.id)}
                >
                  <span
                    className="expense-pill-dot"
                    style={{ backgroundColor: pill.color }}
                    aria-hidden="true"
                  />
                  {pill.label} ({count})
                </button>
              );
            })}
          </div>
        </Panel>

        {/* Itemized Table Panel */}
        <Panel className="expense-table-panel">
          <h2 className="expense-panel-title">Auditoría de compras y caja chica</h2>
          <p className="expense-panel-desc">
            Comprobantes y salidas de efectivo por turno en recepción
          </p>

          {filteredItems.length > 0 ? (
            <TableRegion label="Detalle desglosado de gastos de caja">
              <table>
                <caption>
                  {filteredItems.length}{' '}
                  {filteredItems.length === 1 ? 'gasto registrado' : 'gastos registrados'} ·
                  Periodo {report.dateRange.from} a {report.dateRange.to}
                </caption>
                <thead>
                  {table.getHeaderGroups().map(headerGroup => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map(header => (
                        <th key={header.id} scope="col">
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map(row => (
                    <tr key={row.id}>
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
          ) : (
            <EmptyState title="Sin movimientos de gasto">
              {searchQuery.trim() || selectedFilter !== 'all'
                ? 'No hay registros que coincidan con los filtros aplicados. Prueba limpiar la búsqueda.'
                : 'No hay gastos registrados en el periodo seleccionado.'}
            </EmptyState>
          )}
        </Panel>
      </div>

      {/* PESTAÑA 2: ESTRUCTURA FIJA Y NÓMINA */}
      <div
        id="panel-fixed"
        role="tabpanel"
        aria-labelledby="tab-fixed"
        className={`expense-subview ${activeTab === 'fixed' ? 'view-active' : 'view-hidden'} print-section`}
      >
        {/* Action Header / Toolbar */}
        <div className="expense-fixed-toolbar">
          <div>
            <h2 className="expense-panel-title">Estructura Fija y Presupuesto Operativo</h2>
            <p className="expense-panel-desc">
              Punto de equilibrio base calculado a partir de costos mensuales y nómina activa
            </p>
          </div>
          <div className="expense-fixed-actions">
            <Button
              variant="secondary"
              onClick={openAdjustModal}
              className="expense-adjust-fixed-btn"
            >
              <HugeiconsIcon icon={PencilEdit02Icon} size={16} aria-hidden="true" />
              <span>Ajustar costos fijos</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate('/owner/staff')}
              className="expense-manage-staff-btn"
            >
              <span>Gestionar equipo y sueldos →</span>
            </Button>
          </div>
        </div>

        {/* Fixed Cost Breakdown Cards */}
        <div className="expense-fixed-cards-grid">
          <Panel className="expense-fixed-card">
            <div className="expense-fixed-card-header">
              <div>
                <p className="expense-fixed-card-eyebrow">ARRENDAMIENTO</p>
                <h3 className="expense-fixed-card-title">Renta de Local</h3>
              </div>
              <span className="expense-fixed-amount">{report.fixedCosts.rentFormatted} <small>MXN/mes</small></span>
            </div>
            <div className="expense-fixed-stats">
              <span className="expense-stat-chip">Día: <strong>{formatMoney(Math.round(report.fixedCosts.rentMinor / 20))} MXN</strong></span>
              <span className="expense-stat-chip">Semana: <strong>{formatMoney(Math.round(report.fixedCosts.rentMinor / 4))} MXN</strong></span>
            </div>
            <p className="expense-fixed-note">Inmueble comercial de operaciones gym.</p>
          </Panel>

          <Panel className="expense-fixed-card">
            <div className="expense-fixed-card-header">
              <div>
                <p className="expense-fixed-card-eyebrow">SERVICIOS OPERATIVOS</p>
                <h3 className="expense-fixed-card-title">Servicios Básicos</h3>
              </div>
              <span className="expense-fixed-amount">{report.fixedCosts.servicesFormatted} <small>MXN/mes</small></span>
            </div>
            <div className="expense-services-breakdown-list">
              <div className="expense-service-row">
                <span>Agua de la red</span>
                <strong>{report.fixedCosts.servicesBreakdown.aguaFormatted} MXN/mes ({formatMoney(Math.round(report.fixedCosts.servicesBreakdown.aguaMinor / 20))}/día)</strong>
              </div>
              <div className="expense-service-row">
                <span>Luz / CFE</span>
                <strong>{report.fixedCosts.servicesBreakdown.luzFormatted} MXN/mes ({formatMoney(Math.round(report.fixedCosts.servicesBreakdown.luzMinor / 20))}/día)</strong>
              </div>
              <div className="expense-service-row">
                <span>Internet / Teléfono</span>
                <strong>{report.fixedCosts.servicesBreakdown.internetFormatted} MXN/mes ({formatMoney(Math.round(report.fixedCosts.servicesBreakdown.internetMinor / 20))}/día)</strong>
              </div>
              <div className="expense-service-row">
                <span>Basura y recolección</span>
                <strong>{report.fixedCosts.servicesBreakdown.basuraFormatted} MXN/mes ({formatMoney(Math.round(report.fixedCosts.servicesBreakdown.basuraMinor / 20))}/día)</strong>
              </div>
            </div>
          </Panel>

          <Panel className="expense-fixed-card">
            <div className="expense-fixed-card-header">
              <div>
                <p className="expense-fixed-card-eyebrow">PLANTILLA LABORAL</p>
                <h3 className="expense-fixed-card-title">Nómina Fija</h3>
              </div>
              <span className="expense-fixed-amount">{report.fixedCosts.payrollFormatted} <small>MXN/mes</small></span>
            </div>
            <div className="expense-fixed-stats">
              <span className="expense-stat-chip">Semanal: <strong>{formatMoney(Math.round(report.fixedCosts.payrollMinor / 4))} MXN</strong></span>
              <span className="expense-stat-chip">Colaboradores: <strong>{report.fixedCosts.staffPayroll.length} personas</strong></span>
            </div>
            <p className="expense-fixed-note">Sueldos base por turnos matutinos y vespertinos.</p>
          </Panel>
        </div>

        {/* Dynamic Staff Payroll Table */}
        <Panel className="expense-table-panel">
          <div className="expense-table-header-group">
            <div>
              <h2 className="expense-panel-title">
                <HugeiconsIcon icon={UserGroupIcon} size={18} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Nómina de Personal ({report.fixedCosts.staffPayroll.length} Colaboradores)
              </h2>
              <p className="expense-panel-desc">
                Tabulador de sueldos fijos semanales y mensuales de plantilla operativa
              </p>
            </div>
            <Badge tone="success">Total semanal: {formatMoney(Math.round(report.fixedCosts.payrollMinor / 4))} MXN</Badge>
          </div>

          <TableRegion label="Plantilla de nómina fija de personal">
            <table className="expense-payroll-table">
              <caption>
                Plantilla de nómina mensual oficial · {report.fixedCosts.staffPayroll.length} colaboradores · Total {report.fixedCosts.payrollFormatted} MXN
              </caption>
              <thead>
                <tr>
                  <th scope="col">Colaborador</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Sueldo Diario</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Sueldo Semanal</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Total Mensual</th>
                </tr>
              </thead>
              <tbody>
                {report.fixedCosts.staffPayroll.map((staff: StaffPayrollItem) => (
                  <tr key={staff.id}>
                    <td>
                      <strong className="expense-staff-name">{staff.name}</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="expense-staff-daily">{staff.dailySalaryFormatted} MXN</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="expense-staff-weekly">{staff.weeklySalaryFormatted} MXN</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong className="expense-staff-monthly">{staff.monthlySalaryFormatted} MXN</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="expense-payroll-total-row">
                  <th scope="row">TOTAL NÓMINA ({report.fixedCosts.staffPayroll.length} COLABORADORES)</th>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{formatMoney(Math.round(report.fixedCosts.payrollMinor / 20))} MXN</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{formatMoney(Math.round(report.fixedCosts.payrollMinor / 4))} MXN</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong className="expense-payroll-grand-total">{report.fixedCosts.payrollFormatted} MXN</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </TableRegion>
        </Panel>
      </div>

      {/* Modal Dialog: Ajustar Costos Fijos */}
      {isAdjustModalOpen && (
        <div
          className="expense-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-fixed-costs-title"
        >
          <div className="expense-modal-card">
            <div className="expense-modal-header">
              <h2 id="modal-fixed-costs-title">Ajustar Costos Fijos Mensuales</h2>
              <p className="expense-modal-desc">
                Modifica los importes fijos del gimnasio. El punto de equilibrio y los totales se actualizarán de inmediato.
              </p>
            </div>

            <form onSubmit={handleSaveFixedCosts} noValidate className="expense-modal-form">
              {modalError && (
                <div className="expense-modal-error" role="alert">
                  {modalError}
                </div>
              )}

              <div className="expense-field">
                <label htmlFor="input-rent">Renta de local (MXN) *</label>
                <input
                  id="input-rent"
                  type="number"
                  min="0"
                  step="100"
                  required
                  value={rentInput}
                  onChange={e => setRentInput(e.target.value)}
                  placeholder="66000"
                />
              </div>

              <div className="expense-field-grid">
                <div className="expense-field">
                  <label htmlFor="input-agua">Agua potable (MXN) *</label>
                  <input
                    id="input-agua"
                    type="number"
                    min="0"
                    step="50"
                    required
                    value={aguaInput}
                    onChange={e => setAguaInput(e.target.value)}
                    placeholder="9000"
                  />
                </div>

                <div className="expense-field">
                  <label htmlFor="input-luz">Luz / CFE (MXN) *</label>
                  <input
                    id="input-luz"
                    type="number"
                    min="0"
                    step="50"
                    required
                    value={luzInput}
                    onChange={e => setLuzInput(e.target.value)}
                    placeholder="8000"
                  />
                </div>
              </div>

              <div className="expense-field-grid">
                <div className="expense-field">
                  <label htmlFor="input-internet">Internet / Teléfono (MXN) *</label>
                  <input
                    id="input-internet"
                    type="number"
                    min="0"
                    step="10"
                    required
                    value={internetInput}
                    onChange={e => setInternetInput(e.target.value)}
                    placeholder="800"
                  />
                </div>

                <div className="expense-field">
                  <label htmlFor="input-basura">Basura y recolección (MXN) *</label>
                  <input
                    id="input-basura"
                    type="number"
                    min="0"
                    step="10"
                    required
                    value={basuraInput}
                    onChange={e => setBasuraInput(e.target.value)}
                    placeholder="200"
                  />
                </div>
              </div>

              <div className="expense-modal-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeAdjustModal}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                >
                  Guardar cambios
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
