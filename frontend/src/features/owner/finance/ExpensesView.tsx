import { useMemo } from 'react';
import { barX, defineChart } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { formatMoney } from '../../../demo/adapter';
import { EXPENSE_CATEGORIES, type ExpenseCategoryKey, type ExpenseReportItem } from '../../../demo/expenseReportSelector';
import { EmptyState, Field, Panel } from '../../../shared/ui';
import { FinanceTable } from './FinanceTable';
import type { ExpenseFilters, TableState } from './types';
import type { ColumnDef } from '@tanstack/react-table';

const mxn = (minor: number) => `${formatMoney(minor)} MXN`;

interface ExpensesViewProps {
  items: ExpenseReportItem[];
  filters: ExpenseFilters;
  onFiltersChange: (update: Partial<ExpenseFilters>) => void;
  table: TableState;
  setSorting: (updater: import('@tanstack/react-table').Updater<import('@tanstack/react-table').SortingState>) => void;
  setPagination: (updater: import('@tanstack/react-table').Updater<import('@tanstack/react-table').PaginationState>) => void;
}

export function ExpensesView({ items, filters, onFiltersChange, table, setSorting, setPagination }: ExpensesViewProps) {
  const filteredItems = useMemo(() => {
    const needle = filters.search.trim().toLocaleLowerCase('es-MX');
    return items.filter(item => {
      const matchesSearch = !needle
        || `${item.concept} ${item.payeeName}`.toLocaleLowerCase('es-MX').includes(needle);
      const matchesCategory = filters.category === 'all'
        || item.categoryKey === filters.category
        || (filters.category === 'mantenimiento' && item.categoryKey.startsWith('mantenimiento_'));
      return matchesSearch && matchesCategory;
    });
  }, [items, filters]);
  const totalMinor = filteredItems.reduce((total, item) => total + item.amountMinor, 0);
  const categories = useMemo(() => {
    const sums = new Map<ExpenseCategoryKey, { totalMinor: number; count: number }>();
    for (const item of filteredItems) {
      const value = sums.get(item.categoryKey) ?? { totalMinor: 0, count: 0 };
      value.totalMinor += item.amountMinor;
      value.count++;
      sums.set(item.categoryKey, value);
    }
    return [...sums].sort((left, right) => right[1].totalMinor - left[1].totalMinor).map(([key, value]) => ({
      key, category: EXPENSE_CATEGORIES[key].label, amount: value.totalMinor / 100, amountMinor: value.totalMinor, count: value.count,
    }));
  }, [filteredItems]);
  const chart = defineChart({ marks: [barX(categories, { x: 'amount', y: 'category', fill: 'var(--finance-accent)', inset: 3, radius: 4 })], scales: {
    x: { scale: scaleLinear, nice: true, zero: true, grid: true, axis: { label: 'Importe (MXN)' } }, y: { scale: () => scaleBand().padding(0.18) },
  }, keyboard: true });
  const columns = useMemo<ColumnDef<ExpenseReportItem, unknown>[]>(() => [
    { accessorKey: 'recordedAt', header: 'Fecha', cell: ({ row }) => row.original.formattedDate },
    { accessorKey: 'concept', header: 'Concepto' },
    { accessorKey: 'payeeName', header: 'Proveedor' },
    { accessorKey: 'category', header: 'Categoría inferida' },
    { accessorKey: 'amountMinor', header: 'Importe (MXN)', cell: ({ getValue }) => mxn(Number(getValue())) },
  ], []);
  return <div className="finance-view finance-expenses-view">
    <section className="finance-kpis" aria-label="Gastos filtrados">
      <Panel className="finance-kpi">
        <span>Gastos registrados filtrados</span>
        <strong>{mxn(totalMinor)}</strong>
        <small>Salidas registradas; no incluye presupuesto</small>
      </Panel>
      <Panel className="finance-kpi">
        <span>Registros filtrados</span>
        <strong>{filteredItems.length}</strong>
        <small>Sobre todos los movimientos que cumplen los filtros</small>
      </Panel>
    </section>
    <Panel>
      <div className="finance-section-heading">
        <div>
          <p className="eyebrow">SALIDAS REGISTRADAS</p>
          <h2>Gastos en efectivo registrados</h2>
          <p className="muted">
            La categoría es una sugerencia inferida del concepto y no reemplaza una clasificación contable.
          </p>
        </div>
        <strong>Importe filtrado: {mxn(totalMinor)}</strong>
      </div>
      <div className="finance-filter-grid">
        <Field
          id="expense-search"
          label="Buscar concepto o proveedor"
          type="search"
          value={filters.search}
          onChange={event => onFiltersChange({ search: event.target.value })}
        />
        <label htmlFor="expense-category">
          Categoría
          <select
            id="expense-category"
            value={filters.category}
            onChange={event => onFiltersChange({ category: event.target.value })}
          >
            <option value="all">Todas</option>
            <option value="consumibles">Consumibles</option>
            <option value="limpieza">Limpieza</option>
            <option value="mantenimiento">Mantenimiento</option>
            <option value="servicios">Servicios</option>
            <option value="general">General</option>
          </select>
        </label>
      </div>
      {filteredItems.length ? (
        <FinanceTable
          label="Detalle de gastos filtrados"
          rows={filteredItems}
          columns={columns}
          sorting={table.sorting}
          onSortingChange={setSorting}
          pagination={table.pagination}
          onPaginationChange={setPagination}
        />
      ) : (
        <EmptyState title="Sin gastos registrados">
          No hay gastos que coincidan con estos filtros.
        </EmptyState>
      )}
      <div className="finance-print-only">
        <p>
          Filtros impresos: búsqueda «{filters.search || '—'}» · Categoría:{' '}
          {filters.category === 'all' ? 'Todas' : filters.category}
        </p>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th>Proveedor</th>
              <th>Categoría inferida</th>
              <th>Importe MXN</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map(item => (
              <tr key={item.id}>
                <td>{item.formattedDate}</td>
                <td>{item.concept}</td>
                <td>{item.payeeName}</td>
                <td>{item.category}</td>
                <td>{mxn(item.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
    <Panel>
      <div className="finance-section-heading">
        <div>
          <p className="eyebrow">DISTRIBUCIÓN</p>
          <h2>Importe por categoría inferida</h2>
          <p className="muted">Totales calculados sobre la misma lista filtrada.</p>
        </div>
      </div>
      {categories.length ? (
        <Chart
          definition={chart}
          height={Math.max(180, categories.length * 42)}
          ariaLabel="Gastos filtrados por categoría inferida"
        />
      ) : <p>Sin categorías con importe en este periodo.</p>}
      {categories.length > 0 && (
        <ul className="finance-ranking-list">
          {categories.map(item => (
            <li key={item.key}>
              <span>{item.category}</span>
              <strong>{mxn(item.amountMinor)}</strong>
              <small>{item.count} movimientos</small>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  </div>;
}
