import { useEffect, useMemo, useState } from 'react';
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
  Add01Icon,
  Alert01Icon,
  Cash01Icon,
  Coins01Icon,
  PencilEdit02Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons';

import { useDemo } from '../../demo/DemoProvider';
import {
  createProduct,
  getInventoryAnalytics,
  toggleProductActive,
  updateProduct,
  type InventoryPeriod,
  type ProductAnalyticsRow,
  type TopSellerItem,
} from '../../demo/inventoryAnalyticsSelector';
import { Badge, Button, EmptyState, PageHeader, Panel, TableRegion } from '../../shared/ui';
import './InventoryAnalytics.css';

type FilterPillOption = 'all' | 'active' | 'lowStock' | 'zeroSales' | 'inactive';

const PERIOD_OPTIONS: { id: InventoryPeriod; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'all', label: 'Todo' },
];

export function InventoryAnalytics() {
  const { state, transact } = useDemo();

  const [period, setPeriod] = useState<InventoryPeriod>('month');
  const [chartMetric, setChartMetric] = useState<'units' | 'revenue'>('units');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<FilterPillOption>('all');
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'currentStock', desc: false },
  ]);

  // Modals state
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductCategory, setNewProductCategory] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductCost, setNewProductCost] = useState('');
  const [newProductStock, setNewProductStock] = useState('0');
  const [newProductError, setNewProductError] = useState('');

  const [editingProduct, setEditingProduct] = useState<ProductAnalyticsRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editError, setEditError] = useState('');

  const [confirmToggleProduct, setConfirmToggleProduct] = useState<ProductAnalyticsRow | null>(null);

  // Compute analytics via pure selector
  const analytics = useMemo(() => {
    return getInventoryAnalytics(state, period);
  }, [state, period]);

  // Filter items in the table
  const filteredProducts = useMemo(() => {
    return analytics.productRows.filter(p => {
      // Filter pill
      if (selectedFilter === 'active' && !p.active) return false;
      if (selectedFilter === 'inactive' && p.active) return false;
      if (selectedFilter === 'lowStock' && (!p.active || !p.isLowStock)) return false;
      if (selectedFilter === 'zeroSales' && (!p.active || !p.isZeroSales)) return false;

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = p.name.toLowerCase().includes(query);
        const matchesCat = p.category.toLowerCase().includes(query);
        return matchesName || matchesCat;
      }

      return true;
    });
  }, [analytics.productRows, selectedFilter, searchQuery]);

  // Pill counts
  const pillCounts = useMemo(() => {
    let all = 0;
    let active = 0;
    let lowStock = 0;
    let zeroSales = 0;
    let inactive = 0;

    for (const p of analytics.productRows) {
      all += 1;
      if (p.active) {
        active += 1;
        if (p.isLowStock) lowStock += 1;
        if (p.isZeroSales) zeroSales += 1;
      } else {
        inactive += 1;
      }
    }

    return { all, active, lowStock, zeroSales, inactive };
  }, [analytics.productRows]);

  // Top 5 data for chart
  const topSellersList = useMemo<TopSellerItem[]>(() => {
    return chartMetric === 'units'
      ? analytics.topSellersRankings.byUnits.slice(0, 5)
      : analytics.topSellersRankings.byRevenue.slice(0, 5);
  }, [analytics, chartMetric]);

  const chartData = useMemo(() => {
    return topSellersList.map(item => ({
      name: item.name.length > 14 ? item.name.slice(0, 12) + '…' : item.name,
      fullName: item.name,
      value: chartMetric === 'units' ? item.unitsSold : Math.round(item.revenueMinor / 100),
      unitsSold: item.unitsSold,
      revenueFormatted: item.revenueFormatted,
      percent: item.percent,
    }));
  }, [topSellersList, chartMetric]);

  // TanStack Chart definition
  const chartDefinition = useMemo(() => {
    if (!chartData.length) return null;
    return defineChart({
      marks: [
        barY(chartData, {
          x: 'name',
          y: 'value',
          fill: '#FC6C06',
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
            label: chartMetric === 'units' ? 'Unidades vendidas' : 'Total MXN ($)',
            ticks: {
              format: (val: number) =>
                chartMetric === 'units' ? `${val} pzas` : `$${val.toLocaleString()}`,
            },
          },
        },
      },
      tooltip,
      keyboard: true,
    });
  }, [chartData, chartMetric]);

  // TanStack Table columns
  const columns = useMemo<ColumnDef<ProductAnalyticsRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <button
            type="button"
            className="inventory-sort-header-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Producto {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <div className="inventory-prod-cell">
            <span className="inventory-prod-name">{row.original.name}</span>
          </div>
        ),
      },
      {
        accessorKey: 'category',
        header: ({ column }) => (
          <button
            type="button"
            className="inventory-sort-header-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Categoría {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => <Badge tone="neutral">{row.original.category}</Badge>,
      },
      {
        accessorKey: 'currentStock',
        header: ({ column }) => (
          <button
            type="button"
            className="inventory-sort-header-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Stock actual {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <div className="inventory-stock-badge-wrap">
            <span>{row.original.currentStock}</span>
            {row.original.active && row.original.isLowStock && (
              <span className="inventory-stock-warning" title="Bajo stock (≤ 5 unidades)">
                Bajo stock
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'costMinor',
        header: ({ column }) => (
          <button
            type="button"
            className="inventory-sort-header-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Costo unit. {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => <span>{row.original.costFormatted} MXN</span>,
      },
      {
        accessorKey: 'priceMinor',
        header: ({ column }) => (
          <button
            type="button"
            className="inventory-sort-header-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Precio venta {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <div>
            <strong>{row.original.priceFormatted} MXN</strong>
          </div>
        ),
      },
      {
        accessorKey: 'unitsSold',
        header: ({ column }) => (
          <button
            type="button"
            className="inventory-sort-header-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Ventas período {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <div>
            <span>{row.original.unitsSold} pzas</span>
            {row.original.unitsSold > 0 && (
              <span className="muted" style={{ display: 'block', fontSize: '12px' }}>
                {row.original.revenueFormatted}
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'active',
        header: 'Estado',
        cell: ({ row }) => (
          <Badge tone={row.original.active ? 'success' : 'neutral'}>
            {row.original.active ? 'Activo' : 'Inactivo'}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: 'Acciones',
        cell: ({ row }) => (
          <div className="inventory-table-actions">
            <Button
              variant="secondary"
              className="inventory-action-btn-sm"
              onClick={() => handleOpenEditModal(row.original)}
              aria-label={`Editar ${row.original.name}`}
            >
              <HugeiconsIcon icon={PencilEdit02Icon} size={14} aria-hidden="true" />
              <span>Editar</span>
            </Button>

            <Button
              variant="secondary"
              className="inventory-action-btn-sm"
              onClick={() => setConfirmToggleProduct(row.original)}
              aria-label={row.original.active ? `Desactivar ${row.original.name}` : `Activar ${row.original.name}`}
            >
              {row.original.active ? 'Desactivar' : 'Activar'}
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: filteredProducts,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // Modal Handlers
  function handleOpenNewModal() {
    setNewProductName('');
    setNewProductCategory('General');
    setNewProductPrice('');
    setNewProductCost('');
    setNewProductStock('0');
    setNewProductError('');
    setIsNewModalOpen(true);
  }

  function handleSaveNewProduct(e: React.FormEvent) {
    e.preventDefault();
    setNewProductError('');

    if (!newProductName.trim()) {
      setNewProductError('El nombre del producto es obligatorio.');
      return;
    }

    const priceNum = parseFloat(newProductPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      setNewProductError('El precio de venta debe ser un número positivo.');
      return;
    }

    const costNum = newProductCost.trim() ? parseFloat(newProductCost) : 0;
    if (isNaN(costNum) || costNum < 0) {
      setNewProductError('El costo debe ser un número mayor o igual a 0.');
      return;
    }

    const stockNum = parseInt(newProductStock, 10);
    if (isNaN(stockNum) || stockNum < 0) {
      setNewProductError('El stock inicial debe ser un entero positivo o 0.');
      return;
    }

    const result = transact(currentState =>
      createProduct(currentState, {
        name: newProductName.trim(),
        category: newProductCategory.trim() || 'General',
        priceMinor: Math.round(priceNum * 100),
        costMinor: Math.round(costNum * 100),
        openingQuantity: stockNum,
      })
    );

    if (result.status === 'ok') {
      setIsNewModalOpen(false);
    } else {
      setNewProductError(result.message);
    }
  }

  function handleOpenEditModal(prod: ProductAnalyticsRow) {
    setEditingProduct(prod);
    setEditName(prod.name);
    setEditCategory(prod.category);
    setEditPrice((prod.priceMinor / 100).toString());
    setEditCost((prod.costMinor / 100).toString());
    setEditError('');
  }

  function handleSaveEditProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!editingProduct) return;
    setEditError('');

    if (!editName.trim()) {
      setEditError('El nombre del producto es obligatorio.');
      return;
    }

    const priceNum = parseFloat(editPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      setEditError('El precio de venta debe ser un número positivo.');
      return;
    }

    const costNum = editCost.trim() ? parseFloat(editCost) : 0;
    if (isNaN(costNum) || costNum < 0) {
      setEditError('El costo debe ser un número mayor o igual a 0.');
      return;
    }

    const result = transact(currentState =>
      updateProduct(currentState, editingProduct.id, {
        name: editName.trim(),
        category: editCategory.trim() || 'General',
        priceMinor: Math.round(priceNum * 100),
        costMinor: Math.round(costNum * 100),
      })
    );

    if (result.status === 'ok') {
      setEditingProduct(null);
    } else {
      setEditError(result.message);
    }
  }

  function handleConfirmToggle() {
    if (!confirmToggleProduct) return;
    transact(currentState => toggleProductActive(currentState, confirmToggleProduct.id));
    setConfirmToggleProduct(null);
  }

  // Close modals on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (isNewModalOpen) setIsNewModalOpen(false);
        if (editingProduct) setEditingProduct(null);
        if (confirmToggleProduct) setConfirmToggleProduct(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isNewModalOpen, editingProduct, confirmToggleProduct]);

  return (
    <div className="inventory-analytics-root">
      {/* Page Header */}
      <PageHeader
        eyebrow="PROPIETARIO · INVENTARIO Y CATÁLOGO"
        title="Gestión y Análisis de Inventario"
        description="Control de catálogo de productos, existencias en tiempo real, rotación de inventario y análisis de ventas."
        action={
          <Button
            variant="primary"
            onClick={handleOpenNewModal}
            aria-label="Nuevo producto"
          >
            <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" />
            <span>Nuevo producto</span>
          </Button>
        }
      />

      {/* Period Selection Controls */}
      <section className="inventory-analytics-controls" aria-label="Controles de período">
        <div className="inventory-period-group">
          <span className="inventory-period-label">Período de análisis:</span>
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              className={`inventory-period-btn ${period === opt.id ? 'active' : ''}`}
              onClick={() => setPeriod(opt.id)}
              aria-pressed={period === opt.id}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* Bento Top Row (3 KPIs) */}
      <section className="inventory-bento-kpi-grid" aria-label="Indicadores de inventario">
        {/* KPI 1: Productos activos y valor de catálogo */}
        <Panel className="inventory-kpi-card">
          <div className="inventory-kpi-header">
            <p className="inventory-kpi-title">Catálogo y valor en piso</p>
            <div className="inventory-kpi-icon-wrap" aria-hidden="true">
              <HugeiconsIcon icon={Coins01Icon} size={20} />
            </div>
          </div>
          <p className="inventory-kpi-value">{analytics.kpis.catalogValueFormatted} MXN</p>
          <div className="inventory-kpi-footer">
            <Badge tone="neutral">
              {analytics.kpis.activeProductsCount} activos de {analytics.kpis.totalProductsCount} en catálogo
            </Badge>
          </div>
        </Panel>

        {/* KPI 2: Unidades vendidas e ingresos */}
        <Panel className="inventory-kpi-card">
          <div className="inventory-kpi-header">
            <p className="inventory-kpi-title">Ventas de productos ({analytics.period === 'all' ? 'Histórico' : analytics.period})</p>
            <div className="inventory-kpi-icon-wrap" aria-hidden="true">
              <HugeiconsIcon icon={Cash01Icon} size={20} />
            </div>
          </div>
          <p className="inventory-kpi-value">{analytics.kpis.totalRevenueFormatted} MXN</p>
          <div className="inventory-kpi-footer">
            <span>{analytics.kpis.totalUnitsSold} unidades vendidas</span>
            <span aria-hidden="true">·</span>
            <span>Margen: {analytics.kpis.totalProfitFormatted}</span>
          </div>
        </Panel>

        {/* KPI 3: Alertas de rotación */}
        <Panel className="inventory-kpi-card">
          <div className="inventory-kpi-header">
            <p className="inventory-kpi-title">Alertas de rotación</p>
            <div className="inventory-kpi-icon-wrap" aria-hidden="true">
              <HugeiconsIcon icon={Alert01Icon} size={20} />
            </div>
          </div>
          <p className="inventory-kpi-value">
            {analytics.kpis.lowStockCount} con bajo stock
          </p>
          <div className="inventory-kpi-footer">
            <Badge tone={analytics.kpis.zeroSalesCount > 0 ? 'warning' : 'neutral'}>
              {analytics.kpis.zeroSalesCount} productos sin ventas
            </Badge>
          </div>
        </Panel>
      </section>

      {/* Visual Organizer: TanStack Chart Top Sellers & Ranking Cards */}
      <section className="inventory-visual-bento" aria-label="Productos más vendidos">
        {/* Chart Panel */}
        <Panel className="inventory-chart-panel">
          <div className="inventory-panel-header">
            <div>
              <h2 className="inventory-panel-title">Productos más vendidos</h2>
              <p className="inventory-panel-desc">
                Top 5 productos con mayor rotación en el período seleccionado
              </p>
            </div>
            <div
              className="inventory-chart-controls"
              role="group"
              aria-label="Métrica de visualización"
            >
              <button
                type="button"
                className={`inventory-toggle-btn ${chartMetric === 'units' ? 'active' : ''}`}
                onClick={() => setChartMetric('units')}
                aria-pressed={chartMetric === 'units'}
              >
                Por unidades
              </button>
              <button
                type="button"
                className={`inventory-toggle-btn ${chartMetric === 'revenue' ? 'active' : ''}`}
                onClick={() => setChartMetric('revenue')}
                aria-pressed={chartMetric === 'revenue'}
              >
                Por ingresos
              </button>
            </div>
          </div>

          <div className="inventory-chart-wrapper">
            {chartDefinition ? (
              <Chart
                definition={chartDefinition}
                height={230}
                ariaLabel="Gráfico de barras de los productos más vendidos"
              />
            ) : (
              <EmptyState title="Sin ventas registradas">
                No se registraron ventas de productos en el período seleccionado.
              </EmptyState>
            )}
          </div>
        </Panel>

        {/* Top 5 Rankings Cards */}
        <Panel className="inventory-chart-panel">
          <div className="inventory-panel-header">
            <div>
              <h2 className="inventory-panel-title">Ranking de rotación</h2>
              <p className="inventory-panel-desc">
                Ordenado por {chartMetric === 'units' ? 'unidades desplazadas' : 'ingreso total'}
              </p>
            </div>
          </div>

          {topSellersList.length > 0 ? (
            <div className="inventory-rankings-list">
              {topSellersList.map((item, index) => (
                <div key={item.productId} className="inventory-rank-item">
                  <div className="inventory-rank-left">
                    <span className="inventory-rank-badge">#{index + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <p className="inventory-rank-name">{item.name}</p>
                      <p className="inventory-rank-meta">{item.category}</p>
                    </div>
                  </div>
                  <div className="inventory-rank-right">
                    <p className="inventory-rank-primary-val">
                      {chartMetric === 'units' ? `${item.unitsSold} pzas` : item.revenueFormatted}
                    </p>
                    <p className="inventory-rank-secondary-val">
                      {chartMetric === 'units' ? item.revenueFormatted : `${item.unitsSold} pzas`} ({item.percent}%)
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Sin datos">
              No hay productos con ventas en este período.
            </EmptyState>
          )}
        </Panel>
      </section>

      {/* Product Catalog Management: TanStack Table */}
      <Panel className="inventory-table-panel">
        <div className="inventory-panel-header">
          <div>
            <h2 className="inventory-panel-title">Catálogo de productos y existencias</h2>
            <p className="inventory-panel-desc">
              Administración de precios, costos, disponibilidad de inventario y estado en catálogo
            </p>
          </div>
        </div>

        {/* Toolbar: Search and Filter Pills */}
        <div className="inventory-table-toolbar">
          <div className="inventory-search-row">
            <div className="inventory-search-field">
              <span className="inventory-search-icon" aria-hidden="true">
                <HugeiconsIcon icon={Search01Icon} size={18} />
              </span>
              <input
                id="inventory-catalog-search"
                type="search"
                className="inventory-search-input"
                placeholder="Buscar por producto o categoría..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                aria-label="Buscar productos"
              />
            </div>
          </div>

          <div
            className="inventory-filter-pills"
            role="group"
            aria-label="Filtros rápidos de catálogo"
          >
            <button
              type="button"
              className={`inventory-pill-btn ${selectedFilter === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('all')}
              aria-pressed={selectedFilter === 'all'}
            >
              <span>Todos</span>
              <span className="inventory-pill-count">({pillCounts.all})</span>
            </button>

            <button
              type="button"
              className={`inventory-pill-btn ${selectedFilter === 'active' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('active')}
              aria-pressed={selectedFilter === 'active'}
            >
              <span>Activos</span>
              <span className="inventory-pill-count">({pillCounts.active})</span>
            </button>

            <button
              type="button"
              className={`inventory-pill-btn ${selectedFilter === 'lowStock' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('lowStock')}
              aria-pressed={selectedFilter === 'lowStock'}
            >
              <span>Bajo stock</span>
              <span className="inventory-pill-count">({pillCounts.lowStock})</span>
            </button>

            <button
              type="button"
              className={`inventory-pill-btn ${selectedFilter === 'zeroSales' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('zeroSales')}
              aria-pressed={selectedFilter === 'zeroSales'}
            >
              <span>Sin ventas</span>
              <span className="inventory-pill-count">({pillCounts.zeroSales})</span>
            </button>

            <button
              type="button"
              className={`inventory-pill-btn ${selectedFilter === 'inactive' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('inactive')}
              aria-pressed={selectedFilter === 'inactive'}
            >
              <span>Inactivos</span>
              <span className="inventory-pill-count">({pillCounts.inactive})</span>
            </button>
          </div>
        </div>

        {/* Table Region */}
        <TableRegion label="Tabla de catálogo de productos e inventario">
          <div className="inventory-table-container">
            <table className="inventory-data-table">
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
                {table.getRowModel().rows.length > 0 ? (
                  table.getRowModel().rows.map(row => (
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
                  ))
                ) : (
                  <tr>
                    <td colSpan={columns.length} style={{ textAlign: 'center', padding: '32px' }}>
                      <p className="muted" role="status">
                        No se encontraron productos con los criterios seleccionados.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TableRegion>
      </Panel>

      {/* MODAL 1: Nuevo Producto */}
      {isNewModalOpen && (
        <div
          className="inventory-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-new-title"
          onClick={e => {
            if (e.target === e.currentTarget) setIsNewModalOpen(false);
          }}
        >
          <div className="inventory-modal-dialog">
            <div className="inventory-modal-header">
              <div>
                <h2 id="modal-new-title" className="inventory-modal-title">
                  Nuevo producto
                </h2>
                <p className="inventory-modal-desc">
                  Registra un producto en el catálogo y asigna sus precios y existencias iniciales.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveNewProduct} className="inventory-modal-form">
              {newProductError && (
                <p className="field-error" role="alert">
                  {newProductError}
                </p>
              )}

              <div className="field">
                <label htmlFor="new-product-name">Nombre del producto *</label>
                <input
                  id="new-product-name"
                  type="text"
                  required
                  placeholder="Ej. Bebida Isotónica 600ml"
                  value={newProductName}
                  onChange={e => setNewProductName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="field">
                <label htmlFor="new-product-category">Categoría</label>
                <input
                  id="new-product-category"
                  type="text"
                  placeholder="Ej. Bebidas, Snacks, Suplementos, Accesorios"
                  value={newProductCategory}
                  onChange={e => setNewProductCategory(e.target.value)}
                />
              </div>

              <div className="inventory-form-grid-2">
                <div className="field">
                  <label htmlFor="new-product-price">Precio de venta MXN ($) *</label>
                  <input
                    id="new-product-price"
                    type="number"
                    step="0.5"
                    min="0"
                    required
                    placeholder="0.00"
                    value={newProductPrice}
                    onChange={e => setNewProductPrice(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="new-product-cost">Costo unitario MXN ($)</label>
                  <input
                    id="new-product-cost"
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder="0.00"
                    value={newProductCost}
                    onChange={e => setNewProductCost(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="new-product-stock">Stock inicial (unidades)</label>
                <input
                  id="new-product-stock"
                  type="number"
                  step="1"
                  min="0"
                  placeholder="0"
                  value={newProductStock}
                  onChange={e => setNewProductStock(e.target.value)}
                />
                <span className="muted" style={{ fontSize: '12px', marginTop: '4px', display: 'block' }}>
                  Se registrará un movimiento de recepción inicial en el turno activo.
                </span>
              </div>

              <div className="inventory-modal-footer">
                <Button
                  variant="secondary"
                  onClick={() => setIsNewModalOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="primary">
                  Guardar producto
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Editar Producto */}
      {editingProduct && (
        <div
          className="inventory-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-edit-title"
          onClick={e => {
            if (e.target === e.currentTarget) setEditingProduct(null);
          }}
        >
          <div className="inventory-modal-dialog">
            <div className="inventory-modal-header">
              <div>
                <h2 id="modal-edit-title" className="inventory-modal-title">
                  Editar producto
                </h2>
                <p className="inventory-modal-desc">
                  Actualiza precios, costos o datos de catálogo sin alterar registros de ventas previas.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveEditProduct} className="inventory-modal-form">
              {editError && (
                <p className="field-error" role="alert">
                  {editError}
                </p>
              )}

              <div className="field">
                <label htmlFor="edit-product-name">Nombre del producto *</label>
                <input
                  id="edit-product-name"
                  type="text"
                  required
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="field">
                <label htmlFor="edit-product-category">Categoría</label>
                <input
                  id="edit-product-category"
                  type="text"
                  value={editCategory}
                  onChange={e => setEditCategory(e.target.value)}
                />
              </div>

              <div className="inventory-form-grid-2">
                <div className="field">
                  <label htmlFor="edit-product-price">Precio de venta MXN ($) *</label>
                  <input
                    id="edit-product-price"
                    type="number"
                    step="0.5"
                    min="0"
                    required
                    value={editPrice}
                    onChange={e => setEditPrice(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="edit-product-cost">Costo unitario MXN ($)</label>
                  <input
                    id="edit-product-cost"
                    type="number"
                    step="0.5"
                    min="0"
                    value={editCost}
                    onChange={e => setEditCost(e.target.value)}
                  />
                </div>
              </div>

              <div className="inventory-modal-footer">
                <Button
                  variant="secondary"
                  onClick={() => setEditingProduct(null)}
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="primary">
                  Guardar cambios
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Confirmación Activar / Desactivar */}
      {confirmToggleProduct && (
        <div
          className="inventory-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-toggle-title"
          onClick={e => {
            if (e.target === e.currentTarget) setConfirmToggleProduct(null);
          }}
        >
          <div className="inventory-modal-dialog">
            <div className="inventory-modal-header">
              <div>
                <h2 id="modal-toggle-title" className="inventory-modal-title">
                  {confirmToggleProduct.active ? '¿Desactivar producto?' : '¿Activar producto?'}
                </h2>
                <p className="inventory-modal-desc">
                  {confirmToggleProduct.active
                    ? `El producto "${confirmToggleProduct.name}" ya no estará disponible para venta en recepción. Sus movimientos y ventas históricas se conservarán intactos.`
                    : `El producto "${confirmToggleProduct.name}" volverá a estar disponible para cobro y control de inventario en recepción.`}
                </p>
              </div>
            </div>

            <div className="inventory-modal-footer">
              <Button
                variant="secondary"
                onClick={() => setConfirmToggleProduct(null)}
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={handleConfirmToggle}
              >
                {confirmToggleProduct.active ? 'Confirmar desactivación' : 'Confirmar activación'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
