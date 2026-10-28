import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import type { DemoState, Member, Role } from '../../domain/models';
import { rolePath } from '../../app/navigation';
import { DemoProvider, useDemo } from '../../demo/DemoProvider';
import { addMember } from '../../demo/operations';
import { Badge, Button, EmptyState, Field, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';
import type { Tone } from '../../shared/ui';
import { NotebookNotice } from '../../shared/operationPresentation';
import { memberStatus } from '../../demo/memberStatus';
import { enterMember, exitMember, openAttendance } from '../../demo/attendanceOperations';
import { membershipRenewalStreak } from '../../demo/memberNotes';
import { MemberCounterView, MemberDetailSections } from './MemberDetail';
import { formatAttendanceError, getMemberStatusInfo } from './memberDetailUtils';
import { NewMemberRegistration } from './NewMemberRegistration';
import { OwnerMemberAnalytics } from '../owner/OwnerMemberAnalytics';
import { getMemberReload, type MemberReloadResponse } from '../../api/memberReadsApi';
import type { MemberNoteDTO } from '../../api/membersApi';
import { readOperationalToken } from '../../api/receptionApi';

export { getMemberStatusInfo };

function getMemberInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

type LiveMemberStatus = { status: string; memberNumber?: string; searchAliases?: string };

export function Members({ role, liveData }: { role: Role; liveData?: {
  members: Member[];
  statuses: Record<string, LiveMemberStatus>;
  loading: boolean;
  error: string;
  onRefresh: () => void;
} }) {
  if (liveData) return <MemberDirectory role={role} members={liveData.members} statuses={liveData.statuses} loading={liveData.loading} error={liveData.error} onRefresh={liveData.onRefresh} />;
  return <DemoMemberDirectory role={role} />;
}

function DemoMemberDirectory({ role }: { role: Role }) {
  const { state } = useDemo();
  return <MemberDirectory role={role} members={state.members} demoClock={state.demoClock} attendanceVisits={state.attendance} sales={state.sales} supplementSales={state.supplementSales} />;
}

function MemberDirectory({ role, members, demoClock, attendanceVisits, sales, supplementSales, statuses, loading = false, error = '', onRefresh }: {
  role: Role;
  members: Member[];
  demoClock?: string;
  attendanceVisits?: DemoState['attendance'];
  sales?: DemoState['sales'];
  supplementSales?: DemoState['supplementSales'];
  statuses?: Record<string, LiveMemberStatus>;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es-MX');
    if (!q) return members;
    return members.filter(member =>
      `${member.name} ${member.phone} ${member.id} ${statuses?.[member.id]?.memberNumber ?? ''} ${statuses?.[member.id]?.searchAliases ?? ''} ${member.membership?.planName ?? ''}`
        .toLocaleLowerCase('es-MX')
        .includes(q)
    );
  }, [members, query, statuses]);

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
                <span className="muted member-id">{statuses?.[member.id]?.memberNumber ?? member.id}</span>
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
        header: statuses ? 'Estado' : 'Membresia',
        cell: ({ row }) => {
          const member = row.original;
          const info = getMemberStatusInfo(member, demoClock ?? new Date().toISOString());
          const apiStatus = statuses?.[member.id]?.status;
          return (
            <div className="member-plan-cell">
              <span className="member-plan-name">
                {member.membership ? member.membership.planName : apiStatus ? 'Estado registrado' : 'Sin membresía'}
              </span>
              <Badge tone={apiStatus === 'active' ? 'success' : apiStatus ? 'neutral' : info.tone}>{apiStatus ? ({ active: 'Activo', inactive: 'Inactivo', expired: 'Vencido', suspended: 'Suspendido', pending: 'Pendiente' } as Record<string, string>)[apiStatus] ?? apiStatus : info.badgeLabel}</Badge>
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
          const info = getMemberStatusInfo(member, demoClock ?? new Date().toISOString());
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
    [role, demoClock, statuses]
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
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Link className="button button-primary" to={rolePath(role, 'members/new')}>Nuevo socio</Link>
            {onRefresh && <Button variant="secondary" disabled={loading} onClick={onRefresh}>Actualizar</Button>}
          </div>
        }
      />
      {role === 'OWNER' && demoClock && (
        <OwnerMemberAnalytics
          members={members}
          referenceDate={demoClock.slice(0, 10)}
          attendanceVisits={attendanceVisits ?? []}
          sales={sales ?? []}
          supplementSales={supplementSales ?? []}
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
        {error ? <Notice tone="error">{error}</Notice> : loading ? <div role="status">Cargando socios…</div> : filteredMembers.length ? (
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
          <EmptyState title={members.length ? 'Sin coincidencias' : 'Sin socios registrados'}>
            {members.length ? 'Busca otro nombre o registra un socio.' : 'La API no devolvió socios para esta consulta.'}
          </EmptyState>
        )}
      </Panel>
    </>
  );
}

export function NewMember({ role }: { role: Role }) {
  return <NewMemberRegistration role={role} />;
}

function resolveOperationalToken(): string | null {
  return readOperationalToken();
}

export function MemberDetail({
  role,
  liveData,
}: {
  role: Role;
  liveData?: {
    member: Member;
    reload: MemberReloadResponse;
    notes: string | null;
    status: string;
    isAdmin: boolean;
    onRefresh?: () => void;
    onCheckIn?: () => Promise<{ ok: boolean; message: string }>;
    legalFullName?: string;
    email?: string | null;
    liveNotesList?: MemberNoteDTO[];
    onAddLiveNote?: (body: string) => Promise<void>;
    noteSubmitting?: boolean;
    noteError?: string;
    onUpdateMember?: (payload: { full_name: string; phone: string; email: string | null }) => Promise<void>;
  };
}) {
  if (liveData) return <LiveMemberDetail role={role} {...liveData} />;
  return <DemoMemberDetail role={role} />;
}

function LiveMemberDetail({
  role,
  member,
  reload,
  notes,
  status,
  isAdmin,
  onRefresh,
  onCheckIn,
  legalFullName,
  email,
  liveNotesList,
  onAddLiveNote,
  noteSubmitting,
  noteError,
  onUpdateMember,
}: {
  role: Role;
  member: Member;
  reload: MemberReloadResponse;
  notes: string | null;
  status: string;
  isAdmin: boolean;
  onRefresh?: () => void;
  onCheckIn?: () => Promise<{ ok: boolean; message: string }>;
  legalFullName?: string;
  email?: string | null;
  liveNotesList?: MemberNoteDTO[];
  onAddLiveNote?: (body: string) => Promise<void>;
  noteSubmitting?: boolean;
  noteError?: string;
  onUpdateMember?: (payload: { full_name: string; phone: string; email: string | null }) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<'counter' | 'record'>('counter');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean }>({ message: '', error: false });
  const [isEditing, setIsEditing] = useState(false);
  const [editFullName, setEditFullName] = useState(legalFullName ?? member.name);
  const [editPhone, setEditPhone] = useState(member.phone ?? '');
  const [editEmail, setEditEmail] = useState(email ?? '');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  // shortcut: entry-only check-in, add exit event when turnstile hardware contract exists
  const visits = reload.recent_visits.map(visit => ({ id: visit.visit_id, memberId: member.id, observedCheckIn: visit.occurred_at, observedCheckOut: visit.occurred_at, autoClosedAt: null }));
  const currentPeriod = reload.active_periods.find(period => period.is_current) ?? reload.active_periods[0];
  const statusTone = currentPeriod?.access_status === 'eligible' || (!currentPeriod && status === 'active') ? 'success' : currentPeriod ? 'warning' : 'neutral';

  function handleOpenEdit() {
    setEditFullName(legalFullName ?? member.name);
    setEditPhone(member.phone ?? '');
    setEditEmail(email ?? '');
    setEditError('');
    setIsEditing(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editFullName.trim() || !editPhone.trim() || savingEdit) return;
    setSavingEdit(true);
    setEditError('');
    try {
      if (onUpdateMember) {
        await onUpdateMember({
          full_name: editFullName.trim(),
          phone: editPhone.trim(),
          email: editEmail.trim() || null,
        });
      }
      setIsEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'No se pudo actualizar el socio.');
    } finally {
      setSavingEdit(false);
    }
  }

  return <>
    <div className="member-hero-banner">
      <div className="member-hero-avatar-wrap"><div className="member-hero-avatar" aria-hidden="true">{getMemberInitials(member.name)}</div></div>
      <div className="member-hero-details">
        <PageHeader
          eyebrow="Socio"
          title={member.name}
          description={member.phone || 'Teléfono no capturado'}
          action={
            <div className="member-hero-actions">
              <Badge tone={statusTone}>
                {currentPeriod?.access_status ?? ({ active: 'Activo', inactive: 'Inactivo', expired: 'Vencido', suspended: 'Suspendido', pending: 'Pendiente' } as Record<string, string>)[status] ?? 'Estado no disponible'}
              </Badge>
              {onCheckIn && (
                <div className="member-attendance-action">
                  <Button className="member-attendance-btn" disabled={loading || currentPeriod?.access_status !== 'eligible'} onClick={async () => { setLoading(true); try { const result = await onCheckIn(); setFeedback({ message: result.message, error: !result.ok }); } catch (err) { setFeedback({ message: err instanceof Error ? err.message : 'No se pudo registrar la entrada.', error: true }); } finally { setLoading(false); } }}>Registrar entrada</Button>
                  <div className="member-attendance-feedback" role={feedback.error ? 'alert' : 'status'} aria-label="Resultado de asistencia">{feedback.message}</div>
                </div>
              )}
              {onUpdateMember && (
                <Button variant="secondary" onClick={handleOpenEdit}>
                  Editar datos
                </Button>
              )}
              {onRefresh && <Button variant="secondary" onClick={onRefresh}>Actualizar</Button>}
            </div>
          }
        />
      </div>
    </div>
    {isEditing && (
      <Panel>
        <h3>Editar datos del socio</h3>
        <form onSubmit={handleSaveEdit} className="flow">
          <Field
            id="edit-full-name"
            label="Nombre completo"
            required
            value={editFullName}
            onChange={e => setEditFullName(e.target.value)}
            disabled={savingEdit}
          />
          <Field
            id="edit-phone"
            label="Teléfono"
            required
            value={editPhone}
            onChange={e => setEditPhone(e.target.value)}
            disabled={savingEdit}
          />
          <Field
            id="edit-email"
            label="Correo electrónico (opcional)"
            type="email"
            value={editEmail}
            onChange={e => setEditEmail(e.target.value)}
            disabled={savingEdit}
          />
          {editError && <p role="alert" className="text-danger">{editError}</p>}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <Button type="submit" disabled={savingEdit || !editFullName.trim() || !editPhone.trim()}>
              {savingEdit ? 'Guardando…' : 'Guardar cambios'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsEditing(false);
                setEditError('');
              }}
              disabled={savingEdit}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </Panel>
    )}
    <div className="member-tabs-container">
      <div className="member-tabs-nav" role="tablist" aria-label="Secciones del socio">
        <button type="button" role="tab" id="member-tab-counter" aria-selected={activeTab === 'counter'} aria-controls="member-tabpanel-counter" className={`member-tab-btn ${activeTab === 'counter' ? 'is-active' : ''}`} onClick={() => setActiveTab('counter')}>Mostrador</button>
        <button type="button" role="tab" id="member-tab-record" aria-selected={activeTab === 'record'} aria-controls="member-tabpanel-record" className={`member-tab-btn ${activeTab === 'record' ? 'is-active' : ''}`} onClick={() => setActiveTab('record')}>Expediente</button>
      </div>
    </div>
    {activeTab === 'counter' ? (
      <div id="member-tabpanel-counter" role="tabpanel" aria-labelledby="member-tab-counter">
        <MemberCounterView
          member={member}
          now={reload.server_time}
          visits={visits}
          gloves={[]}
          gloveRentals={[]}
          lockers={[]}
          lockerRentals={[]}
          payments={[]}
          supplementSales={[]}
          sales={[]}
          role={isAdmin ? 'OWNER' : role}
          reloadState={reload}
          onSwitchToRecord={() => setActiveTab('record')}
          liveNotesList={isAdmin ? liveNotesList : undefined}
          onAddLiveNote={isAdmin ? onAddLiveNote : undefined}
          noteSubmitting={noteSubmitting}
          noteError={noteError}
        />
      </div>
    ) : (
      <div id="member-tabpanel-record" role="tabpanel" aria-labelledby="member-tab-record">
        <MemberDetailSections
          member={member}
          now={reload.server_time}
          visits={visits}
          gloves={[]}
          gloveRentals={[]}
          lockers={[]}
          lockerRentals={[]}
          payments={[]}
          supplementSales={[]}
          sales={[]}
          role={isAdmin ? 'OWNER' : role}
          reloadState={reload}
          liveNotes={notes}
          liveNotesList={isAdmin ? liveNotesList : undefined}
          onAddLiveNote={isAdmin ? onAddLiveNote : undefined}
          noteSubmitting={noteSubmitting}
          noteError={noteError}
          liveApi
        />
      </div>
    )}
    <div className="flow member-detail-back-flow"><Link to={rolePath(role, 'members')} className="member-back-link">Volver a socios</Link></div>
  </>;
}

function DemoMemberDetail({ role }: { role: Role }) {
  const { memberId } = useParams();
  const { state, resetVersion } = useDemo();
  const [activeTab, setActiveTab] = useState<'counter' | 'record'>('counter');
  const [reloadState, setReloadState] = useState<MemberReloadResponse | null>(null);

  useEffect(() => {
    let isCancelled = false;
    const token = resolveOperationalToken();

    if (!token || !memberId) {
      setReloadState(null);
      return;
    }

    getMemberReload(memberId, token)
      .then(data => {
        if (!isCancelled) {
          setReloadState(data);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setReloadState(null);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [memberId]);

  const member = state.members.find(item => item.id === memberId);
  if (!member) {
    return (
      <Panel>
        <EmptyState title="Socio no disponible">
          No se encontró el perfil solicitado.{' '}
          <Link to={rolePath(role, 'members')}>Volver a socios</Link>
        </EmptyState>
      </Panel>
    );
  }

  const payments = state.payments.filter(payment => payment.memberId === member.id);
  const statusInfo = getMemberStatusInfo(member, state.demoClock);

  return (
    <>
      <div className="member-hero-banner">
        <div className="member-hero-avatar-wrap">
          <div className="member-hero-avatar" aria-hidden="true">
            {getMemberInitials(member.name)}
          </div>
        </div>
        <div className="member-hero-details">
          <PageHeader
            eyebrow="Socio"
            title={member.name}
            description={member.phone || 'Teléfono no capturado'}
            action={
              <div className="member-hero-actions">
                <Badge tone={statusInfo.tone}>{statusInfo.badgeLabel}</Badge>
                <MemberAttendance key={`${member.id}-${resetVersion}`} memberId={member.id} />
              </div>
            }
          />
        </div>
      </div>

      <div className="member-tabs-container">
        <div className="member-tabs-nav" role="tablist" aria-label="Secciones del socio">
          <button
            type="button"
            role="tab"
            id="member-tab-counter"
            aria-selected={activeTab === 'counter'}
            aria-controls="member-tabpanel-counter"
            className={`member-tab-btn ${activeTab === 'counter' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('counter')}
          >
            Mostrador
          </button>
          <button
            type="button"
            role="tab"
            id="member-tab-record"
            aria-selected={activeTab === 'record'}
            aria-controls="member-tabpanel-record"
            className={`member-tab-btn ${activeTab === 'record' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('record')}
          >
            Expediente
          </button>
        </div>
      </div>

      {activeTab === 'counter' ? (
        <div id="member-tabpanel-counter" role="tabpanel" aria-labelledby="member-tab-counter">
          <MemberCounterView
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
            reloadState={reloadState ?? undefined}
            onSwitchToRecord={() => setActiveTab('record')}
          />
        </div>
      ) : (
        <div id="member-tabpanel-record" role="tabpanel" aria-labelledby="member-tab-record">
          <MemberDetailSections
            reloadState={reloadState ?? undefined}
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
        </div>
      )}

      <div className="flow member-detail-back-flow">
        <Link to={rolePath(role, 'members')} className="member-back-link">
          Volver a socios
        </Link>
      </div>
    </>
  );
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
