import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import type { Member, Role } from '../../domain/models';
import { rolePath } from '../../app/navigation';
import { useDemo } from '../../demo/DemoProvider';
import { addMember } from '../../demo/operations';
import { Badge, Button, EmptyState, Field, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';
import type { Tone } from '../../shared/ui';
import { NotebookNotice } from '../../shared/operationPresentation';
import { memberStatus } from '../../demo/memberStatus';
import { enterMember, exitMember, openAttendance } from '../../demo/attendanceOperations';
import { MemberDetailSections } from './MemberDetail';
import { formatAttendanceError } from './memberDetailUtils';
import { NewMemberRegistration } from './NewMemberRegistration';
import { OwnerMemberAnalytics } from '../owner/OwnerMemberAnalytics';

function getMemberInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function getMemberStatusInfo(member: Member, referenceDate?: string) {
  const st = memberStatus(member, referenceDate);
  let badgeLabel = 'Sin confirmar';
  let tone: Tone = 'neutral';
  if (st.status === 'active') {
    if (st.provisional || member.demoScenario === 'expiry-today') {
      badgeLabel = 'Vence hoy';
      tone = 'warning';
    } else {
      badgeLabel = 'Activa';
      tone = 'success';
    }
  } else if (st.status === 'expired' || st.status === 'inactive') {
    badgeLabel = 'Vencida';
    tone = 'error';
  } else {
    badgeLabel = 'Sin confirmar';
    tone = 'neutral';
  }
  return { badgeLabel, tone, status: st.status, provisional: st.provisional };
}

export function Members({ role }: { role: Role }) {
  const { state } = useDemo();
  const [query, setQuery] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es-MX');
    if (!q) return state.members;
    return state.members.filter(member =>
      `${member.name} ${member.phone} ${member.id} ${member.membership?.planName ?? ''}`
        .toLocaleLowerCase('es-MX')
        .includes(q)
    );
  }, [state.members, query]);

  const columns = useMemo<ColumnDef<Member>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Socio',
        cell: ({ row }) => {
          const member = row.original;
          return (
            <div className="member-info-cell">
              <span className="member-avatar" aria-hidden="true">
                {getMemberInitials(member.name)}
              </span>
              <div className="member-info-text">
                <Link
                  to={rolePath(role, `members/${member.id}`)}
                  className="member-name-link"
                >
                  {member.name}
                </Link>
                <span className="muted member-id">{member.id}</span>
              </div>
            </div>
          );
        },
      },
      {
        id: 'phone',
        accessorFn: member => member.phone || '',
        header: 'Numero',
        cell: ({ row }) => {
          const phone = row.original.phone;
          return (
            <span className={phone ? 'member-phone' : 'muted member-phone-empty'}>
              {phone || 'No capturado'}
            </span>
          );
        },
      },
      {
        id: 'membership',
        accessorFn: member => member.membership?.planName || '',
        header: 'Membresia',
        cell: ({ row }) => {
          const member = row.original;
          const info = getMemberStatusInfo(member, state.demoClock);
          return (
            <div className="member-plan-cell">
              <span className="member-plan-name">
                {member.membership ? member.membership.planName : 'Sin membresía'}
              </span>
              <Badge tone={info.tone}>{info.badgeLabel}</Badge>
            </div>
          );
        },
      },
      {
        id: 'endsOn',
        accessorFn: member => member.membership?.endsOn || '',
        header: 'Fecha vencimiento',
        cell: ({ row }) => {
          const member = row.original;
          const endsOn = member.membership?.endsOn;
          const info = getMemberStatusInfo(member, state.demoClock);
          const isExpired = member.membership && (info.status === 'expired' || info.status === 'inactive');
          const isExpiryToday = member.membership && (info.provisional || member.demoScenario === 'expiry-today');

          return (
            <div className="member-expiry-cell">
              <span className="member-expiry-date">{endsOn || '—'}</span>
              {isExpired && <Badge tone="error">Vencida</Badge>}
              {isExpiryToday && <Badge tone="warning">Vence hoy</Badge>}
            </div>
          );
        },
      },
      {
        id: 'actions',
        enableSorting: false,
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => {
          const member = row.original;
          return (
            <div className="member-action-cell">
              <Link
                to={rolePath(role, `members/${member.id}`)}
                className="button button-secondary member-detail-link"
                aria-label={`Ver detalle de ${member.name}`}
              >
                Ver detalle
              </Link>
            </div>
          );
        },
      },
    ],
    [role, state.demoClock]
  );

  const table = useReactTable({
    data: filteredMembers,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <>
      <PageHeader
        eyebrow={role === 'OWNER' ? 'PROPIETARIO · INTELIGENCIA DE SOCIOS' : 'RECEPCIÓN · SOCIOS'}
        title={role === 'OWNER' ? 'Directorio y análisis de socios' : 'Socios y membresías'}
        description={
          role === 'OWNER'
            ? 'Métricas de retención, distribución de membresías y antigüedad de la base activa.'
            : 'Encuentra a la persona antes de registrar una operación.'
        }
        action={
          <Link className="button button-primary" to={rolePath(role, 'members/new')}>
            Nuevo socio
          </Link>
        }
      />
      {role === 'OWNER' && (
        <OwnerMemberAnalytics
          members={state.members}
          referenceDate={state.demoClock.slice(0, 10)}
          attendanceVisits={state.attendance}
          sales={state.sales}
          supplementSales={state.supplementSales}
        />
      )}
      <Panel>
        <Field
          id="member-search"
          label="Buscar socio"
          placeholder="Nombre, teléfono o referencia local"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        {filteredMembers.length ? (
          <div className="members-table-card">
            <div
              className="members-table-region"
              role="region"
              aria-label="Socios registrados"
              tabIndex={0}
            >
              <table className="members-table" aria-label="Socios registrados">
                <caption>{filteredMembers.length} socios registrados</caption>
                <thead>
                  {table.getHeaderGroups().map(group => (
                    <tr key={group.id}>
                      {group.headers.map(header => {
                        const isSorted = header.column.getIsSorted();
                        const indicator = isSorted === 'asc' ? '▲' : isSorted === 'desc' ? '▼' : '↕';
                        return (
                          <th
                            key={header.id}
                            scope="col"
                            aria-sort={
                              header.column.getCanSort()
                                ? isSorted === 'asc'
                                  ? 'ascending'
                                  : isSorted === 'desc'
                                    ? 'descending'
                                    : 'none'
                                : undefined
                            }
                          >
                            {header.isPlaceholder ? null : header.column.getCanSort() ? (
                              <button
                                type="button"
                                className="members-table-sort-btn"
                                aria-label={`Ordenar por ${String(header.column.columnDef.header)}`}
                                onClick={header.column.getToggleSortingHandler()}
                              >
                                <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                                <span className="sort-indicator" aria-hidden="true">
                                  {indicator}
                                </span>
                              </button>
                            ) : (
                              flexRender(header.column.columnDef.header, header.getContext())
                            )}
                          </th>
                        );
                      })}
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
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState title="Sin coincidencias">
            Busca otro nombre o registra un socio.
          </EmptyState>
        )}
      </Panel>
    </>
  );
}

export function NewMember({ role }: { role: Role }) {
  return <NewMemberRegistration role={role} />;
}

export function MemberDetail({ role }: { role: Role }) {
  const { memberId } = useParams();
  const { state, resetVersion } = useDemo();
  const member = state.members.find(item => item.id === memberId);
  if (!member) return <Panel><EmptyState title="Socio no disponible">No se encontró el perfil solicitado. <Link to={rolePath(role, 'members')}>Volver a socios</Link></EmptyState></Panel>;
  const payments = state.payments.filter(payment => payment.memberId === member.id);
  return <><PageHeader eyebrow="Socio" title={member.name} description={member.phone || 'Teléfono no capturado'} action={<MemberAttendance key={`${member.id}-${resetVersion}`} memberId={member.id} />} />
    <MemberDetailSections
      member={member}
      now={state.demoClock}
      visits={state.attendance.filter(visit => visit.memberId === member.id)}
      gloves={state.gloves ?? []}
      gloveRentals={state.gloveRentals ?? []}
      lockers={state.lockers ?? []}
      lockerRentals={state.lockerRentals ?? []}
      payments={payments}
      supplementSales={state.supplementSales ?? []}
      sales={state.sales ?? []}
      role={role}
    />
    <div className="flow"><Link to={rolePath(role, 'members')}>Volver a socios</Link></div></>;
}

function MemberAttendance({ memberId }: { memberId: string }) {
  const { state, transact } = useDemo();
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const member = state.members.find(item => item.id === memberId)!;
  const status = memberStatus(member);
  const visits = state.attendance.filter(visit => visit.memberId === memberId);
  const open = visits.find(openAttendance);
  return <div className="member-attendance-action">
      <Button className="member-attendance-btn" disabled={!open && status.status !== 'active'} onClick={() => {
        const result = transact(current => open ? exitMember(current, memberId, current.demoClock)
          : enterMember(current, { id: `attendance-${crypto.randomUUID()}`, memberId, now: current.demoClock }));
        setError(result.status === 'error');
        setMessage(result.status === 'error' ? formatAttendanceError(result.message) : open ? 'Salida registrada.' : 'Entrada registrada.');
      }}>{open ? 'Registrar salida' : 'Registrar entrada'}</Button>
    <div className="member-attendance-feedback" role={error ? 'alert' : 'status'} aria-label="Resultado de asistencia">{message}</div>
  </div>;
}
