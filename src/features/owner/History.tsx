import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import type { PaymentMethod } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney } from '../../demo/adapter';
import {
  categoryLabels,
  defaultPeriod,
  ownerHistory,
  validPeriod,
  type HistoryFilter,
  type HistoryRecord,
} from '../../demo/ownerOperations';
import { Badge, Button, EmptyState, PageHeader, Panel, TableRegion } from '../../shared/ui';
import { NotebookNotice, paymentMethods } from '../members/Members';
import { PeriodFields } from './PeriodFields';

export function History() {
  const { state } = useDemo();
  const [filter, setFilter] = useState<HistoryFilter>(() => ({
    ...defaultPeriod(state),
    category: 'all',
    method: 'all',
  }));
  const [sorting, setSorting] = useState<SortingState>([{ id: 'recordedAt', desc: true }]);

  const records = useMemo(() => ownerHistory(state, filter), [state, filter]);

  const columns = useMemo<ColumnDef<HistoryRecord>[]>(
    () => [
      {
        accessorKey: 'recordedAt',
        header: 'Fecha / categoría',
        cell: ({ row }) => (
          <div>
            <time dateTime={row.original.recordedAt}>
              {new Date(row.original.recordedAt).toLocaleString('es-MX', {
                timeZone: 'America/Mexico_City',
              })}
            </time>
            <p className="muted">{categoryLabels[row.original.category]}</p>
          </div>
        ),
      },
      {
        accessorKey: 'description',
        header: 'Registro y referencia',
        cell: ({ row }) => (
          <div>
            <span>{row.original.description}</span>
            <p className="muted break-words">{row.original.id}</p>
            <details>
              <summary>Ver detalle</summary>
              <p className="mt-2">{row.original.detail}</p>
              {row.original.memberId && (
                <Link to={`/owner/members/${row.original.memberId}`}>Ver socio</Link>
              )}
            </details>
          </div>
        ),
      },
      {
        accessorKey: 'shiftId',
        header: 'Turno',
        cell: ({ getValue }) => String(getValue() ?? '—'),
      },
      {
        accessorKey: 'amountMinor',
        header: 'Importe MXN',
        cell: ({ getValue }) => {
          const val = getValue<number | null>();
          return val === null ? 'No aplica' : formatMoney(val);
        },
      },
      {
        accessorKey: 'method',
        header: 'Método / estado',
        cell: ({ row }) => (
          <div>
            {row.original.method ? paymentMethods[row.original.method] : 'No aplica'}
            <div className="mt-2">
              <Badge tone={row.original.method === 'transfer' ? 'warning' : 'neutral'}>
                {row.original.status}
              </Badge>
            </div>
          </div>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: records,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 15 } },
  });

  return (
    <>
      <PageHeader
        eyebrow="PROPIETARIO · TRAZABILIDAD LOCAL"
        title="Historial de movimientos"
        description="Pagos, ventas, cantidades, conteos y turnos. Consulta de solo lectura."
      />
      <Panel>
        <PeriodFields period={filter} onChange={period => setFilter({ ...filter, ...period })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="history-category">Categoría</label>
            <select
              id="history-category"
              value={filter.category}
              onChange={event =>
                setFilter({ ...filter, category: event.target.value as HistoryFilter['category'] })
              }
            >
              <option value="all">Todas las categorías</option>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="history-method">Método</label>
            <select
              id="history-method"
              value={filter.method}
              onChange={event =>
                setFilter({ ...filter, method: event.target.value as PaymentMethod | 'all' })
              }
            >
              <option value="all">Todos / no aplica</option>
              {Object.entries(paymentMethods).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="muted">
          Filtrar por método muestra solo operaciones de pago. Reposición, merma, conteo y turnos no tienen método ni importe de venta.
        </p>
      </Panel>

      {validPeriod(filter) && (
        <Panel className="mt-6">
          {records.length ? (
            <>
              <TableRegion label="Historial global">
                <table>
                  <caption>
                    {records.length} registros · referencias locales, no comprobantes ni folios físicos
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
                              className="font-inherit cursor-pointer"
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
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
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {table.getRowModel().rows.length === 0 && (
                      <tr>
                        <td colSpan={columns.length}>No hay movimientos que coincidan con los filtros.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </TableRegion>
              {records.length > 15 && (
                <div className="shift-pagination mt-4">
                  <span>
                    {records.length} registros · página {table.getState().pagination.pageIndex + 1} de {Math.max(1, table.getPageCount())}
                  </span>
                  <label>
                    Filas por página
                    <select
                      aria-label="Filas por página"
                      value={table.getState().pagination.pageSize}
                      onChange={event => table.setPageSize(Number(event.target.value))}
                    >
                      <option value={15}>15</option>
                      <option value={30}>30</option>
                      <option value={50}>50</option>
                    </select>
                  </label>
                  <Button
                    variant="secondary"
                    disabled={!table.getCanPreviousPage()}
                    onClick={() => table.previousPage()}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!table.getCanNextPage()}
                    onClick={() => table.nextPage()}
                  >
                    Siguiente
                  </Button>
                </div>
              )}
            </>
          ) : (
            <EmptyState title="Sin movimientos para estos filtros">
              No hay registros locales coincidentes. Cambia el periodo, categoría o método.
            </EmptyState>
          )}
        </Panel>
      )}

      <NotebookNotice />
      <div className="flow">
        <Link to="/owner/shifts">Consultar resumen por turno</Link>
      </div>
    </>
  );
}
