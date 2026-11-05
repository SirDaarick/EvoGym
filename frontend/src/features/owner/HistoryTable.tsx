import { formatMoney } from '@/shared/formatters/money';
import { categoryLabels } from '@/domain/reporting';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import type { PaymentMethod } from '../../domain/models';
import type { HistoryCategory } from '@/domain/reporting';
import { TableRegion, Badge, Button } from '../../shared/ui';
import { paymentMethods } from '../../shared/operationPresentation';

export interface HistoryTableRecord {
  id: string;
  category: HistoryCategory;
  recordedAt: string;
  shiftId: string;
  description: string;
  detail: string;
  status: string;
  amountMinor: number | null;
  method: PaymentMethod | null;
  memberId?: string;
  memberName?: string;
  actorName?: string;
}

/** Sortable history table shared by the demo and live views. `paginated=false` shows every row (server paging). */
export function HistoryTable({ records, caption, timezone = 'America/Mexico_City', paginated = true }: {
  records: HistoryTableRecord[]; caption: ReactNode; timezone?: string; paginated?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'recordedAt', desc: true }]);
  const columns = useMemo<ColumnDef<HistoryTableRecord>[]>(
    () => [
      {
        accessorKey: 'recordedAt',
        header: 'Fecha / categoría',
        cell: ({ row }) => (
          <div>
            <time dateTime={row.original.recordedAt}>
              {new Date(row.original.recordedAt).toLocaleString('es-MX', {
                timeZone: timezone,
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
            <strong style={{ display: 'block', color: 'var(--color-ink)' }}>{row.original.description}</strong>
            {row.original.memberName && (
              <p className="muted" style={{ fontSize: '12px', margin: '2px 0 0' }}>
                Socio: {row.original.memberName}
              </p>
            )}
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
        header: 'Turno / Atendido por',
        cell: ({ row, getValue }) => {
          const actor = row.original.actorName;
          const shift = String(getValue() || '');
          if (actor) {
            return (
              <div>
                <strong>{actor}</strong>
                <p className="muted" style={{ fontSize: '11px', margin: 0 }}>
                  {shift && shift.length > 20 ? 'Turno en caja' : (shift || 'Turno activo')}
                </p>
              </div>
            );
          }
          if (!shift) return '—';
          return shift.length > 20 ? 'Turno en caja' : shift;
        },
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
    [timezone]
  );

  const table = useReactTable({
    data: records,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(paginated ? { getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize: 15 } } } : {}),
  });

  return (
    <>
      <TableRegion label="Historial global">
        <table>
          <caption>
            {caption}
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
      {paginated && records.length > 15 && (
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
  );
}
