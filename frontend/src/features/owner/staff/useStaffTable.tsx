import { useMemo, useState } from 'react';
import { getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { formatMoney } from '@/shared/formatters/money';
import { Button } from '@/shared/ui';
import type { AdminStaffAccountChoice } from '@/api/staffCredentialsApi';
import type { StaffProfile } from '@/features/staff/staffStore';
import { validUuid, type ManagedStaffProfile, type StatusFilter } from './utils';

export interface StaffTableActions {
  /** True when an Admin session exists so initial PINs can be issued. */
  canIssuePin: boolean;
  pinIssuingId: string | null;
  onIssuePin: (staff: ManagedStaffProfile) => void;
  onPair: (staff: StaffProfile) => void;
  onEdit: (staff: StaffProfile) => void;
  onToggle: (staff: StaffProfile) => void;
}

/** Merges the local store with live Admin accounts. */
export function mergeStaff(staffList: StaffProfile[], liveAccounts: AdminStaffAccountChoice[]): ManagedStaffProfile[] {
  const list: ManagedStaffProfile[] = staffList.map(s => {
    const matched = liveAccounts.find(a => a.linked_profile_id === s.id || a.id === s.id);
    return matched ? { ...s, staffUserId: matched.id, active: matched.is_active } : { ...s };
  });
  for (const account of liveAccounts) {
    const known = list.some(s => s.id === account.id || s.staffUserId === account.id || s.id === account.linked_profile_id);
    if (!known) {
      list.push({
        id: account.id, name: account.login_identifier, role: 'RECEPTION', shift: 'General', salaryMinor: 0, hasPin: true,
        active: account.is_active, avatarInitials: account.login_identifier.slice(0, 2).toUpperCase(), department: 'Staff',
        staffUserId: account.id,
      });
    }
  }
  return list;
}

function buildColumns(a: StaffTableActions): ColumnDef<ManagedStaffProfile>[] {
  return [
    {
      accessorKey: 'name', header: 'Recepcionista',
      cell: ({ row }) => (
        <div className="staff-cell">
          <div className="staff-avatar staff-avatar-recep" aria-hidden="true">{row.original.avatarInitials}</div>
          <div className="staff-info"><strong>{row.original.name}</strong><span className="muted">ID: {row.original.id}</span></div>
        </div>
      ),
    },
    { accessorKey: 'shift', header: 'Turno', cell: ({ row }) => row.original.shift },
    {
      accessorKey: 'salaryMinor', header: 'Sueldo mensual', sortDescFirst: false,
      cell: ({ row }) => <span className="staff-salary-cell"><strong>{formatMoney(row.original.salaryMinor)}</strong></span>,
    },
    {
      accessorKey: 'hasPin', header: 'Credencial',
      cell: ({ row }) => <span className="badge-pin">{row.original.hasPin ? '🔒 Con PIN' : '⚡ Acceso directo'}</span>,
    },
    {
      accessorKey: 'active', header: 'Estado',
      cell: ({ row }) => (
        <span className={`badge ${row.original.active ? 'badge-success' : 'badge-neutral'}`}>{row.original.active ? '● Activo' : '○ Inactivo'}</span>
      ),
    },
    {
      id: 'actions', header: 'Acciones', enableSorting: false,
      cell: ({ row }) => {
        const staff = row.original;
        const eligible = a.canIssuePin && validUuid(staff.staffUserId ?? staff.id);
        return (
          <div style={{ display: 'inline-flex', gap: '8px', justifyContent: 'flex-end', width: '100%', flexWrap: 'wrap' }}>
            {a.canIssuePin && (
              <Button variant="secondary" disabled={!eligible || a.pinIssuingId === staff.id} onClick={() => a.onIssuePin(staff)}
                title={eligible ? 'Emitir PIN inicial para acceso seguro' : 'Requiere ID UUID de personal'}>
                {a.pinIssuingId === staff.id ? 'Emitiendo…' : 'Emitir PIN'}
              </Button>
            )}
            <Button variant="secondary" onClick={() => a.onPair(staff)} title="Vincular teléfono del empleado sin contraseñas">Vincular Dispositivo</Button>
            <Button variant="secondary" onClick={() => a.onEdit(staff)}>Editar</Button>
            <Button variant="secondary" onClick={() => a.onToggle(staff)}
              style={{ color: staff.active ? 'var(--catalog-field-error, #A32222)' : 'inherit' }}>
              {staff.active ? 'Desactivar' : 'Activar'}
            </Button>
          </div>
        );
      },
    },
  ];
}

/** Receptionist filtering, sorting and TanStack Table column definitions for the demo list. */
export function useStaffTable(staff: ManagedStaffProfile[], actions: StaffTableActions) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sorting, setSorting] = useState<SortingState>([]);

  const receptionStaff = useMemo(() => staff.filter(s => s.role === 'RECEPTION'), [staff]);
  const filtered = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return receptionStaff.filter(s =>
      (statusFilter === 'all' || (statusFilter === 'active' ? s.active : !s.active)) &&
      (query === '' || s.name.toLowerCase().includes(query) || s.shift.toLowerCase().includes(query)));
  }, [receptionStaff, statusFilter, searchQuery]);

  const { canIssuePin, pinIssuingId, onIssuePin, onPair, onEdit, onToggle } = actions;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const columns = useMemo(() => buildColumns({ canIssuePin, pinIssuingId, onIssuePin, onPair, onEdit, onToggle }),
    [canIssuePin, pinIssuingId, onIssuePin, onPair, onEdit, onToggle]);

  const table = useReactTable({
    data: filtered, columns, getRowId: row => row.id, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  });
  const activeCount = receptionStaff.filter(s => s.active).length;

  return {
    table, columnCount: columns.length, searchQuery, setSearchQuery, statusFilter, setStatusFilter,
    activeCount, inactiveCount: receptionStaff.length - activeCount, totalCount: receptionStaff.length,
  };
}
