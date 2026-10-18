import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef, PaginationState, SortingState, Updater } from '@tanstack/react-table';
import { Button, TableRegion } from '../../../shared/ui';

interface FinanceTableProps<TData> {
  label: string;
  rows: TData[];
  columns: ColumnDef<TData, unknown>[];
  sorting: SortingState;
  onSortingChange: (updater: Updater<SortingState>) => void;
  pagination: PaginationState;
  onPaginationChange: (updater: Updater<PaginationState>) => void;
  pageSize?: number;
}

export function FinanceTable<TData>({
  label,
  rows,
  columns,
  sorting,
  onSortingChange,
  pagination,
  onPaginationChange,
  pageSize = 20,
}: FinanceTableProps<TData>) {
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, pagination },
    onSortingChange,
    onPaginationChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
    initialState: { pagination: { pageIndex: 0, pageSize } },
  });

  return <>
    <div className="finance-screen-table">
      <TableRegion label={label}>
        <table>
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => {
                  const sort = header.column.getIsSorted();
                  const ariaSort = sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none';
                  return (
                    <th key={header.id} scope="col" aria-sort={ariaSort}>
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span aria-hidden="true">
                            {sort === 'asc' ? ' ↑' : sort === 'desc' ? ' ↓' : ' ↕'}
                          </span>
                        </button>
                      ) : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length ? table.getRowModel().rows.map(row => (
              <tr key={row.id}>
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            )) : (
              <tr>
                <td colSpan={columns.length}>Sin resultados para estos filtros.</td>
              </tr>
            )}
          </tbody>
        </table>
      </TableRegion>
    </div>
    <div className="finance-pagination">
      <span aria-live="polite">
        Página {table.getState().pagination.pageIndex + 1} de {Math.max(1, table.getPageCount())}
        {' · '}{rows.length} resultados filtrados
      </span>
      <div>
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
    </div>
  </>;
}
