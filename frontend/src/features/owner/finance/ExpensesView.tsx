import { formatMoney } from '@/shared/formatters/money';
import { EXPENSE_CATEGORIES, type ExpenseCategoryKey } from '@/domain/expenses';
import { useMemo, useState } from 'react';
import { barX, defineChart } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { type ExpenseReportItem } from '../../../demo/expenseReportSelector';
import { Badge, Button, EmptyState, Field, FormField, Panel } from '../../../shared/ui';
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
  onAdd?: () => void;
  onVoid?: (id: string, reason: string) => Promise<void>;
  branches?: { id: string; name: string }[];
  selectedBranchId?: string;
  onBranchChange?: (id: string) => void;
}

export function ExpensesView({ items, filters, onFiltersChange, table, setSorting, setPagination, onAdd, onVoid, branches = [], selectedBranchId = 'ALL', onBranchChange }: ExpensesViewProps) {
  const [voidTarget, setVoidTarget] = useState<ExpenseReportItem | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidReasonError, setVoidReasonError] = useState('');
  const [voidError, setVoidError] = useState('');
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
  const totalMinor = filteredItems.reduce((total, item) => total + (item.voided ? 0 : item.amountMinor), 0);
  const categories = useMemo(() => {
    const sums = new Map<ExpenseCategoryKey, { totalMinor: number; count: number }>();
    for (const item of filteredItems) {
      if (item.voided) continue;
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
    { accessorKey: 'category', header: 'Categoría' },
    { accessorKey: 'method', header: 'Método', cell: ({ row }) => ({ cash: 'Efectivo', transfer: 'Transferencia', card: 'Tarjeta' }[row.original.method ?? 'cash']) },
    { accessorKey: 'origin', header: 'Origen', cell: ({ row }) => row.original.origin === 'business' ? 'Negocio' : 'Turno' },
    { id: 'voucher', header: 'Comprobante', cell: ({ row }) => <>{row.original.voucherReference || '—'} {row.original.evidenceUrl && <a href={row.original.evidenceUrl} target="_blank" rel="noreferrer">Ver foto</a>}</> },
    { id: 'status', header: 'Estado', cell: ({ row }) => row.original.voided ? <Badge tone="warning">Anulado</Badge> : <Badge tone="success">Activo</Badge> },
    ...(onVoid ? [{ id: 'void', header: 'Acción', cell: ({ row }: { row: { original: ExpenseReportItem } }) => !row.original.voided && <Button variant="secondary" onClick={() => { setVoidTarget(row.original); setVoidReason(''); setVoidError(''); }}>Anular</Button> }] : []),
    { accessorKey: 'amountMinor', header: 'Importe (MXN)', cell: ({ getValue }) => mxn(Number(getValue())) },
  ], [onVoid]);
  return <div className="finance-view finance-expenses-view">
    <section className="finance-kpis" aria-label="Gastos filtrados">
      <Panel className="finance-kpi">
        <span>Gastos registrados filtrados</span>
        <strong>{mxn(totalMinor)}</strong>
        <small>Salidas registradas; no incluye presupuesto</small>
      </Panel>
      <Panel className="finance-kpi">
        <span>Registros filtrados</span>
        <strong>{filteredItems.filter(item => !item.voided).length}</strong>
        <small>Sobre todos los movimientos que cumplen los filtros</small>
      </Panel>
    </section>
    <Panel>
      <div className="finance-section-heading">
        <div>
          <p className="eyebrow">SALIDAS REGISTRADAS</p>
          <h2>Gastos registrados</h2>
        </div>
        <strong>Importe filtrado: {mxn(totalMinor)}</strong>{onAdd && <Button onClick={onAdd}>Registrar gasto</Button>}
      </div>
      <div className="finance-filter-grid">
        {onBranchChange && <label htmlFor="expense-branch-filter">Sucursal<select id="expense-branch-filter" value={selectedBranchId} onChange={event => onBranchChange(event.target.value)}><option value="ALL">Todas</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
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
              <th>Categoría</th><th>Método</th><th>Origen</th><th>Comprobante</th><th>Estado</th>
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
                <td>{item.method ?? 'cash'}</td><td>{item.origin === 'business' ? 'Negocio' : 'Turno'}</td><td>{item.voucherReference || '—'}</td><td>{item.voided ? 'Anulado' : 'Activo'}</td>
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
          <h2>Importe por categoría</h2>
          <p className="muted">Totales calculados sobre la misma lista filtrada.</p>
        </div>
      </div>
      {categories.length ? (
        <Chart
          definition={chart}
          height={Math.max(180, categories.length * 42)}
          ariaLabel="Gastos filtrados por categoría"
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
    {voidTarget && <div className="staff-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="owner-void-title"><div className="staff-modal-card">
      <h2 id="owner-void-title">Anular gasto</h2><p>{voidTarget.concept} · {mxn(voidTarget.amountMinor)}</p>
      <form noValidate onSubmit={async event => { event.preventDefault(); if (!onVoid) return; if (!voidReason.trim()) { setVoidReasonError('Escribe el motivo de la anulación.'); document.getElementById('owner-void-reason')?.focus(); return; } try { await onVoid(voidTarget.id, voidReason.trim()); setVoidTarget(null); } catch (error) { setVoidError(error instanceof Error ? error.message : 'No se pudo anular el gasto.'); } }}>
        <FormField label="Motivo *" id="owner-void-reason" error={voidReasonError}><textarea value={voidReason} onChange={event => { setVoidReason(event.target.value); setVoidReasonError(''); }} required /></FormField>
        {voidError && <p role="alert">{voidError}</p>}<Button type="submit">Confirmar anulación</Button><Button variant="secondary" onClick={() => setVoidTarget(null)}>Cancelar</Button>
      </form></div></div>}
  </div>;
}
