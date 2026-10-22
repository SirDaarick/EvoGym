import { useMemo } from 'react';
import { formatMoney } from '../../../demo/adapter';
import type { FinanceRow, FinanceSourceFamily, FinanceSourceTotal } from '../../../demo/financeReportSelector';
import { Badge, EmptyState, Field, Panel } from '../../../shared/ui';
import { FinanceRankingChart, FinanceSourcesDonutChart } from './FinanceCharts';
import { FinanceTable } from './FinanceTable';
import type { FinanceContextData } from './types';
import { isCollectionRow } from './types';
import type { ColumnDef } from '@tanstack/react-table';

const sourceLabels: Record<string, string> = {
  membership: 'Membresías',
  product: 'Productos',
  visit: 'Visitas',
  supplement: 'Suplementos',
  glove: 'Renta de guantes',
  locker: 'Renta de casilleros',
  unknown: 'Origen desconocido',
};
const methodLabels: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };
const statusLabels: Record<string, string> = { confirmed: 'Confirmado', paid: 'Pagado', refunded: 'Reembolsado', pending: 'Pendiente' };
const mxn = (minor: number) => `${formatMoney(minor)} MXN`;
const dateTime = (value: string) => new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  dateStyle: 'short',
  timeStyle: 'short',
}).format(new Date(value));

type CollectionsViewProps = Pick<FinanceContextData,
  'projection' | 'collectionFilters' | 'setCollectionFilters' |
  'collectionTable' | 'setCollectionSorting' | 'setCollectionPagination'>;

export function CollectionsView({
  projection,
  collectionFilters,
  setCollectionFilters,
  collectionTable,
  setCollectionSorting,
  setCollectionPagination,
}: CollectionsViewProps) {
  const collections = useMemo(() => projection.rows.filter(isCollectionRow), [projection.rows]);
  const filteredRows = useMemo(() => {
    const needle = collectionFilters.search.trim().toLocaleLowerCase('es-MX');
    return collections.filter(row => {
      const searchFields = [
        row.description,
        row.memberLabel ?? '',
        row.sourceReference,
        sourceLabels[row.sourceFamily] ?? row.sourceFamily,
        methodLabels[String(row.method)] ?? '',
        statusLabels[row.status] ?? row.status,
      ];
      const matchesSearch = !needle || searchFields.join(' ').toLocaleLowerCase('es-MX').includes(needle);
      return matchesSearch && (collectionFilters.source === 'all' || row.sourceFamily === collectionFilters.source)
        && (collectionFilters.method === 'all' || row.method === collectionFilters.method)
        && (collectionFilters.status === 'all' || row.status === collectionFilters.status);
    });
  }, [collections, collectionFilters]);
  const pendingRows = useMemo(() => projection.rows.filter(row => row.subtype === 'pending').filter(row => {
    const needle = collectionFilters.search.trim().toLocaleLowerCase('es-MX');
    return (collectionFilters.status === 'all' || collectionFilters.status === 'pending')
      && (!needle || [
        row.description,
        row.memberLabel ?? '',
        row.sourceReference,
        sourceLabels[row.sourceFamily] ?? row.sourceFamily,
        methodLabels[String(row.method)] ?? '',
        statusLabels[row.status] ?? row.status,
      ].join(' ').toLocaleLowerCase('es-MX').includes(needle))
      && (collectionFilters.source === 'all' || row.sourceFamily === collectionFilters.source)
      && (collectionFilters.method === 'all' || row.method === collectionFilters.method);
  }), [projection.rows, collectionFilters]);
  const grossMinor = filteredRows.reduce((total, row) => total + (row.subtype === 'collection' && row.amountMinor > 0 ? row.amountMinor : 0), 0);
  const refundsMinor = filteredRows.reduce((total, row) => total + (row.subtype === 'refund' ? Math.abs(row.amountMinor) : 0), 0);
  const netMinor = grossMinor - refundsMinor;
  const pendingMinor = pendingRows.reduce((total, row) => total + row.amountMinor, 0);
  const sourceTotals = useMemo<FinanceSourceTotal[]>(() => {
    const totals = new Map<FinanceSourceFamily, FinanceSourceTotal>();
    for (const row of filteredRows) {
      const current = totals.get(row.sourceFamily) ?? {
        sourceFamily: row.sourceFamily,
        amountMinor: 0,
        count: 0,
      };
      current.amountMinor += row.amountMinor;
      current.count += 1;
      totals.set(row.sourceFamily, current);
    }
    return [...totals.values()];
  }, [filteredRows]);
  const columns = useMemo<ColumnDef<FinanceRow, unknown>[]>(() => [
    {
      accessorKey: 'sourceFamily',
      header: 'Origen',
      cell: ({ row }) => <>
        {sourceLabels[row.original.sourceFamily] ?? row.original.sourceFamily}
        {row.original.orphan && <Badge tone="warning">Sin origen</Badge>}
      </>,
    },
    { accessorKey: 'recordedAt', header: 'Fecha y hora', cell: ({ getValue }) => dateTime(String(getValue())) },
    {
      accessorKey: 'description',
      header: 'Concepto',
      cell: ({ row }) => row.original.sourceFamily === 'glove'
        ? 'Renta de guantes'
        : row.original.sourceFamily === 'locker'
          ? 'Renta de casillero'
          : row.original.description,
    },
    { accessorKey: 'memberLabel', header: 'Socio', cell: ({ getValue }) => getValue<string | null>() ?? '—' },
    { accessorKey: 'sourceReference', header: 'Referencia' },
    { accessorKey: 'method', header: 'Método', cell: ({ getValue }) => methodLabels[String(getValue())] ?? '—' },
    { accessorKey: 'status', header: 'Estado', cell: ({ getValue }) => statusLabels[String(getValue())] ?? String(getValue()) },
    { accessorKey: 'amountMinor', header: 'Importe (MXN)', cell: ({ getValue }) => mxn(Number(getValue())) },
  ], []);
  return <div className="finance-view finance-collections-view">
    <section className="finance-kpis" aria-label="Totales de cobros filtrados">
      <Panel className="finance-kpi">
        <span>Cobros brutos filtrados</span>
        <strong>{mxn(grossMinor)}</strong>
        <small>{filteredRows.filter(row => row.subtype === 'collection').length} registros</small>
      </Panel>
      <Panel className="finance-kpi">
        <span>Reembolsos filtrados</span>
        <strong>−{mxn(refundsMinor)}</strong>
        <small>{filteredRows.filter(row => row.subtype === 'refund').length} eventos</small>
      </Panel>
      <Panel className="finance-kpi">
        <span>Neto de cobros filtrados</span>
        <strong>{mxn(netMinor)}</strong>
        <small>Calculado sobre las {filteredRows.length} filas filtradas, antes de paginar</small>
      </Panel>
    </section>
    <Panel>
      <div className="finance-section-heading">
        <div>
          <p className="eyebrow">COBROS CONFIRMADOS</p>
          <h2>Cobros y reembolsos</h2>
          <p className="muted">
            El total y el gráfico reflejan todos los resultados de los filtros, no solo la página visible.
          </p>
        </div>
      </div>
      <div className="finance-filter-grid">
        <Field
          id="collection-search"
          label="Buscar concepto, socio, referencia, método o estado"
          type="search"
          value={collectionFilters.search}
          onChange={event => setCollectionFilters({ search: event.target.value })}
        />
        <label htmlFor="collection-source">
          Origen
          <select
            id="collection-source"
            value={collectionFilters.source}
            onChange={event => setCollectionFilters({
              source: event.target.value as FinanceContextData['collectionFilters']['source'],
            })}
          >
            <option value="all">Todos</option>
            {Object.entries(sourceLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <label htmlFor="collection-method">
          Método
          <select
            id="collection-method"
            value={collectionFilters.method}
            onChange={event => setCollectionFilters({ method: event.target.value })}
          >
            <option value="all">Todos</option>
            {Object.entries(methodLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <label htmlFor="collection-status">
          Estado
          <select
            id="collection-status"
            value={collectionFilters.status}
            onChange={event => setCollectionFilters({ status: event.target.value })}
          >
            <option value="all">Todos</option>
            {Object.entries(statusLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="finance-sources-overview">
        <FinanceSourcesDonutChart totals={sourceTotals} />
        <FinanceRankingChart title="Cobros netos filtrados por origen" totals={sourceTotals} />
      </div>
      {filteredRows.length ? (
        <FinanceTable
          label="Movimientos de cobros filtrados"
          rows={filteredRows}
          columns={columns}
          sorting={collectionTable.sorting}
          onSortingChange={setCollectionSorting}
          pagination={collectionTable.pagination}
          onPaginationChange={setCollectionPagination}
        />
      ) : (
        <EmptyState title="Sin cobros confirmados">
          No hay movimientos que coincidan con estos filtros.
        </EmptyState>
      )}
      <div className="finance-print-only">
        <p>
          Filtros impresos: búsqueda «{collectionFilters.search || '—'}» · Origen:{' '}
          {sourceLabels[collectionFilters.source] ?? collectionFilters.source} · Método:{' '}
          {methodLabels[collectionFilters.method] ?? collectionFilters.method} · Estado:{' '}
          {statusLabels[collectionFilters.status] ?? collectionFilters.status}
        </p>
        <table>
          <thead>
            <tr>
              <th>Origen</th>
              <th>Fecha y hora</th>
              <th>Concepto</th>
              <th>Socio</th>
              <th>Referencia</th>
              <th>Método</th>
              <th>Estado</th>
              <th>Importe MXN</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => (
              <tr key={row.id}>
                <td>{sourceLabels[row.sourceFamily] ?? row.sourceFamily}</td>
                <td>{dateTime(row.recordedAt)}</td>
                <td>{row.description}</td>
                <td>{row.memberLabel ?? '—'}</td>
                <td>{row.sourceReference}</td>
                <td>{methodLabels[String(row.method)] ?? '—'}</td>
                <td>{statusLabels[row.status] ?? row.status}</td>
                <td>{mxn(row.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
    <Panel>
      <div className="finance-section-heading">
        <div>
          <p className="eyebrow">APARTE DE LO COBRADO</p>
          <h2>Transferencias pendientes</h2>
          <p className="muted">
            Importes pendientes según el mismo rango y filtros. No son cobros confirmados ni forman parte de los totales anteriores.
          </p>
        </div>
        <strong>{mxn(pendingMinor)}</strong>
      </div>
      {pendingRows.length ? (
        <ul className="finance-pending-list">
          {pendingRows.map(row => (
            <li key={row.id}>
              <span>
                {sourceLabels[row.sourceFamily] ?? row.sourceFamily} · {row.description} · {row.memberLabel ?? 'Socio sin resolver'}
              </span>
              <strong>{mxn(row.amountMinor)}</strong>
            </li>
          ))}
        </ul>
      ) : <p>No hay transferencias pendientes con estos filtros.</p>}
    </Panel>
  </div>;
}
