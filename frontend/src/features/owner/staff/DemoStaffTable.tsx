import { flexRender, type Table } from '@tanstack/react-table';
import type { ManagedStaffProfile } from './utils';

interface Props {
  table: Table<ManagedStaffProfile>;
  columnCount: number;
}

export function DemoStaffTable({ table, columnCount }: Props) {
  const rows = table.getRowModel().rows;
  return (
    <div className="table-region staff-table-region" role="region" aria-label="Listado de recepcionistas">
      <table className="staff-table">
        <thead>
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const label = typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : 'columna';
                const content = flexRender(header.column.columnDef.header, header.getContext());
                return (
                  <th key={header.id} style={header.id === 'actions' ? { textAlign: 'right' } : undefined}
                    aria-sort={canSort ? (sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none') : undefined}>
                    {header.isPlaceholder ? null : canSort ? (
                      <button type="button" className="staff-table-sort-btn" onClick={header.column.getToggleSortingHandler()}
                        aria-label={`Ordenar por ${label.toLowerCase()}`}>
                        <span>{content}</span>
                        <span className="sort-indicator" aria-hidden="true">{sorted === 'asc' ? ' ▲' : sorted === 'desc' ? ' ▼' : ' ⇅'}</span>
                      </button>
                    ) : content}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columnCount} style={{ textAlign: 'center', padding: '32px', color: 'var(--color-muted)' }}>
                No se encontraron recepcionistas con los criterios actuales.
              </td>
            </tr>
          ) : rows.map(row => (
            <tr key={row.id}>
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} style={cell.column.id === 'actions' ? { textAlign: 'right' } : undefined}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
