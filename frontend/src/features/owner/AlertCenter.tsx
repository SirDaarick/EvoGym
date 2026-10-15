import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Chart } from '@tanstack/charts/react';
import { defineChart } from '@tanstack/charts';
import { pie, polar, radialArc } from '@tanstack/charts/polar';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert01Icon, Cash01Icon, CreditCardIcon } from '@hugeicons/core-free-icons';

import { Badge, EmptyState, PageHeader, Panel, TableRegion } from '../../shared/ui';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney } from '../../demo/adapter';
import {
  ALERT_CATEGORY_CONFIG,
  getOperationalAlerts,
  type AlertCategory,
  type AlertPeriod,
  type OperationalAlert,
} from '../../demo/alertCenterSelector';
import './AlertCenter.css';

const PERIOD_OPTIONS: { id: 'today' | 'week' | 'month' | 'all'; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'all', label: 'Todo' },
];

function categoryTone(category: AlertCategory): 'error' | 'warning' | 'neutral' {
  switch (category) {
    case 'cash_difference':
      return 'error';
    case 'waste':
    case 'pending_transfer':
      return 'warning';
    case 'expense':
      return 'neutral';
  }
}

function formatDateTime(timestamp: string): string {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  } catch {
    return timestamp;
  }
}

export function AlertCenter() {
  const { state } = useDemo();
  const [period, setPeriod] = useState<AlertPeriod>('today');
  const [selectedCategory, setSelectedCategory] = useState<AlertCategory | 'all'>('all');
  const [activeLegendCategory, setActiveLegendCategory] = useState<AlertCategory | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'timestamp', desc: true }]);

  const result = useMemo(
    () => getOperationalAlerts(state, period),
    [state, period]
  );

  const tableData = useMemo(() => {
    if (selectedCategory === 'all') return result.alerts;
    return result.alerts.filter(alert => alert.category === selectedCategory);
  }, [result.alerts, selectedCategory]);

  const slices = useMemo(
    () =>
      result.categoryCounts.map(item => ({
        category: item.category,
        count: item.count,
        label: item.label,
        percent: item.percent,
        color: item.color,
      })),
    [result.categoryCounts]
  );

  const donutDefinition = useMemo(() => {
    if (!slices.length) return null;
    return defineChart({
      marks: [
        polar({
          inset: 6,
          radiusRatio: 0.94,
          marks: [
            radialArc(pie(slices, { value: 'count' }), {
              innerRadius: ({ radius }) => radius * 0.65,
              cornerRadius: 4,
              color: 'category',
              key: 'category',
            }),
          ],
          scales: { angle: null, radius: null },
        }),
      ],
      scales: { x: null, y: null },
      color: {
        domain: ['cash_difference', 'waste', 'expense', 'pending_transfer'],
        range: ['#A32222', '#F59E0B', '#2455A4', '#FC6C06'],
      },
      keyboard: true,
    });
  }, [slices]);

  const columns = useMemo<ColumnDef<OperationalAlert>[]>(
    () => [
      {
        accessorKey: 'timestamp',
        header: 'Fecha / Turno',
        cell: ({ row }) => (
          <div className="alert-date-cell">
            <span className="alert-date-time">{formatDateTime(row.original.timestamp)}</span>
            {row.original.shiftId && (
              <span className="alert-shift-tag">{row.original.shiftId}</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'category',
        header: 'Categoría',
        cell: ({ row }) => (
          <Badge tone={categoryTone(row.original.category)}>
            {row.original.categoryLabel}
          </Badge>
        ),
      },
      {
        accessorKey: 'detail',
        header: 'Detalle',
        cell: ({ row }) => (
          <div className="alert-detail-cell">
            <span className="alert-detail-title">{row.original.title}</span>
            <p className="alert-detail-text">{row.original.detail}</p>
          </div>
        ),
      },
      {
        accessorKey: 'responsible',
        header: 'Responsable',
        cell: ({ getValue }) => <span>{String(getValue() ?? '—')}</span>,
      },
      {
        accessorKey: 'impactMinor',
        header: 'Impacto',
        cell: ({ row }) => (
          <span
            className={`alert-impact-cell ${
              row.original.category === 'cash_difference'
                ? 'impact-critical'
                : 'impact-warning'
            }`}
          >
            {row.original.impactFormatted}
          </span>
        ),
      },
      {
        id: 'action',
        header: 'Acción',
        cell: ({ row }) => (
          <Link
            to={row.original.targetRoute}
            className="button button-secondary alert-action-btn"
          >
            {row.original.actionLabel}
          </Link>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="alert-center-container">
      <PageHeader
        eyebrow="PROPIETARIO · CENTRO DE CONTROL"
        title="Centro de alertas operativas"
        description="Consolidación de diferencias de caja, mermas de inventario, salidas de efectivo y transferencias bancarias pendientes de conciliación."
      />

      {/* Period Selection Bar */}
      <Panel className="alert-period-bar">
        <p className="alert-period-label">Periodo a consultar</p>
        <div
          className="alert-period-group"
          role="group"
          aria-label="Seleccionar periodo de alertas"
        >
          {PERIOD_OPTIONS.map(option => (
            <button
              key={option.id}
              type="button"
              className={`alert-period-btn ${period === option.id ? 'active' : ''}`}
              aria-pressed={period === option.id}
              onClick={() => {
                setPeriod(option.id);
                setSelectedCategory('all');
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Panel>

      {/* Top Bento Row: 3 KPIs + Donut Chart */}
      <div className="alert-top-bento">
        {/* KPI 1: Total Alerts */}
        <Panel className="alert-kpi-card">
          <div className="alert-kpi-header">
            <span className="alert-kpi-title">Alertas activas</span>
            <span className="alert-kpi-icon">
              <HugeiconsIcon icon={Alert01Icon} size={20} />
            </span>
          </div>
          <p className="alert-kpi-value">{result.totalCount}</p>
          <p className="alert-kpi-note">
            {result.totalCount === 1
              ? '1 evento operativo requiere atención.'
              : `${result.totalCount} eventos operativos requieren atención.`}
          </p>
        </Panel>

        {/* KPI 2: Cash Impact */}
        <Panel className="alert-kpi-card">
          <div className="alert-kpi-header">
            <span className="alert-kpi-title">Descuadres y gastos</span>
            <span className="alert-kpi-icon icon-danger">
              <HugeiconsIcon icon={Cash01Icon} size={20} />
            </span>
          </div>
          <p className="alert-kpi-value">
            {formatMoney(result.kpis.cashImpactMinor)} MXN
          </p>
          <p className="alert-kpi-note">
            Salidas no programadas y faltantes observados en arqueo.
          </p>
          <Link to="/owner/shifts" className="alert-kpi-link">
            Revisar turnos →
          </Link>
        </Panel>

        {/* KPI 3: Pending Transfers */}
        <Panel className="alert-kpi-card">
          <div className="alert-kpi-header">
            <span className="alert-kpi-title">Transferencias pendientes</span>
            <span className="alert-kpi-icon icon-warning">
              <HugeiconsIcon icon={CreditCardIcon} size={20} />
            </span>
          </div>
          <p className="alert-kpi-value">
            {formatMoney(result.kpis.pendingTransfersMinor)} MXN
          </p>
          <p className="alert-kpi-note">
            Fondos no acreditados ni conciliados con estado bancario.
          </p>
          <Link to="/owner/history" className="alert-kpi-link">
            Auditar historial →
          </Link>
        </Panel>

        {/* Donut Chart Panel */}
        <Panel className="alert-chart-card">
          <h2>Distribución por categoría</h2>
          <div className="alert-chart-body">
            <div
              className="alert-donut-wrap"
              aria-label={`Distribución de alertas: ${result.totalCount} eventos`}
            >
              {donutDefinition ? (
                <Chart
                  definition={donutDefinition}
                  height={170}
                  ariaLabel="Distribución de alertas por categoría"
                />
              ) : (
                <div
                  className="alert-donut-empty"
                  role="img"
                  aria-label="Sin alertas registradas en este periodo"
                />
              )}
              <div className="alert-donut-center">
                <strong>{result.totalCount}</strong>
                <span>{result.totalCount === 1 ? 'alerta' : 'alertas'}</span>
              </div>
            </div>

            <div className="alert-chart-legend" aria-label="Desglose por categoría">
              {slices.map(item => (
                <button
                  key={item.category}
                  type="button"
                  className="alert-legend-item"
                  onMouseEnter={() => setActiveLegendCategory(item.category)}
                  onMouseLeave={() => setActiveLegendCategory(null)}
                  onFocus={() => setActiveLegendCategory(item.category)}
                  onBlur={() => setActiveLegendCategory(null)}
                  onClick={() =>
                    setSelectedCategory(prev =>
                      prev === item.category ? 'all' : item.category
                    )
                  }
                  aria-label={`${item.label}: ${item.count} alertas, ${item.percent} por ciento`}
                >
                  <span
                    className="alert-legend-dot"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="alert-legend-label">
                    {ALERT_CATEGORY_CONFIG[item.category].shortLabel}
                  </span>
                  <strong>{item.count}</strong>
                  <span className="alert-legend-pct">{item.percent}%</span>
                </button>
              ))}
              {activeLegendCategory && (
                <p className="sr-only" role="status">
                  {ALERT_CATEGORY_CONFIG[activeLegendCategory].label} seleccionada
                </p>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {/* Table Section */}
      <Panel className="alert-table-card">
        <div className="alert-table-header">
          <h2>Detalle de incidencias</h2>

          {/* Category Filter Pills */}
          <div
            className="alert-filter-pills"
            role="group"
            aria-label="Filtrar incidencias por categoría"
          >
            <button
              type="button"
              className={`alert-filter-pill ${selectedCategory === 'all' ? 'active' : ''}`}
              aria-pressed={selectedCategory === 'all'}
              onClick={() => setSelectedCategory('all')}
            >
              <span>Todos</span>
              <span className="alert-pill-count">{result.totalCount}</span>
            </button>
            {(Object.keys(ALERT_CATEGORY_CONFIG) as AlertCategory[]).map(cat => {
              const count = result.alerts.filter(a => a.category === cat).length;
              if (count === 0 && selectedCategory !== cat) return null;
              return (
                <button
                  key={cat}
                  type="button"
                  className={`alert-filter-pill ${selectedCategory === cat ? 'active' : ''}`}
                  aria-pressed={selectedCategory === cat}
                  onClick={() => setSelectedCategory(cat)}
                >
                  <span>{ALERT_CATEGORY_CONFIG[cat].label}</span>
                  <span className="alert-pill-count">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {tableData.length === 0 ? (
          <EmptyState title="Sin alertas registradas">
            No se observaron diferencias de caja, mermas, gastos no planificados ni
            transferencias pendientes para los criterios seleccionados.
          </EmptyState>
        ) : (
          <TableRegion label="Centro de alertas operativas">
            <table className="alert-table">
              <caption>
                Alertas operativas del periodo · Montos expresados en moneda nacional (MXN).
              </caption>
              <thead>
                {table.getHeaderGroups().map(group => (
                  <tr key={group.id}>
                    {group.headers.map(header => (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={
                          header.column.getIsSorted() === 'asc'
                            ? 'ascending'
                            : header.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : 'none'
                        }
                      >
                        <button
                          type="button"
                          className="alert-sort-btn"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {header.column.getIsSorted() === 'asc'
                            ? ' ↑'
                            : header.column.getIsSorted() === 'desc'
                            ? ' ↓'
                            : ''}
                        </button>
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
        )}
      </Panel>
    </div>
  );
}
