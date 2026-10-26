import { useMemo, useState } from 'react';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import type { AttendanceVisit, GloveItem, GloveRentalRecord, LockerItem, LockerRentalRecord, MembershipPayment, Member, PaymentMethod, Role, Sale, SupplementSale } from '../../domain/models';
import type { MemberReloadResponse } from '../../api/memberReadsApi';
import { formatMoney } from '../../demo/adapter';
import { addMemberNote, membershipHistory, membershipRenewalStreak } from '../../demo/memberNotes';
import { getMemberHabits } from '../../demo/memberAnalyticsSelector';
import { useDemo } from '../../demo/DemoProvider';
import { getSelectedStaff } from '../staff/staffStore';
import { openAttendance } from '../../demo/attendanceOperations';
import { getMemberStatusInfo, rentalStatus } from './memberDetailUtils';
import { Badge, Button, EmptyState, Panel, TableRegion } from '../../shared/ui';
import { AttendanceCalendar } from '../attendance/AttendanceCalendar';
import './MemberDetail.css';

type Purchase = { id: string; date: string; product: string; amount: number; method: PaymentMethod; status: string };
type MembershipRow = { id: string; planName: string; date: string; current: boolean; period?: boolean };

function ReadOnlyMemberNotes({ note }: { note: string | null }) {
  return <Panel><div className="member-notes-header"><div className="member-notes-title-wrap"><h2>Nota</h2></div></div>{note?.trim() ? <p className="member-note-body">{note}</p> : <EmptyState title="Sin notas registradas">Todavía no hay notas para este socio.</EmptyState>}</Panel>;
}

function MemberNotes({ member, now }: { member: Member; now: string }) {
  const { state, update } = useDemo();
  const selectedStaff = getSelectedStaff();
  const activeStaff = selectedStaff || { id: 'recep-1', name: 'Valeria M.' };
  const [noteBody, setNoteBody] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const notes = (state.memberNotes ?? []).filter(note => note.memberId === member.id);

  return (
    <Panel>
      <div className="member-notes-header">
        <div className="member-notes-title-wrap">
          <h2>Nota</h2>
          <span className="member-notes-counter" aria-label={`${notes.length} notas`}>
            {notes.length}
          </span>
        </div>
        <Button variant="secondary" className="member-notes-toggle-btn" onClick={() => setIsAddingNote(prev => !prev)}>
          {isAddingNote ? 'Cancelar' : '+ Agregar nota'}
        </Button>
      </div>
      {isAddingNote && (
        <form className="member-note-form" onSubmit={event => {
          event.preventDefault();
          if (!noteBody.trim()) return;
          const note = { memberId: member.id, body: noteBody.trim(), authorId: activeStaff.id, authorName: activeStaff.name, createdAt: now };
          update(current => ({ ...current, memberNotes: addMemberNote(current.memberNotes ?? [], note) }));
          setNoteBody('');
          setIsAddingNote(false);
        }}>
          <div className="member-note-author-info">
            Registrando como: <strong>{activeStaff.name}</strong>
          </div>
          <textarea id="member-note" aria-label="Nueva nota" value={noteBody} onChange={event => setNoteBody(event.target.value)} maxLength={1000} placeholder="Escribe la nota para el socio..." />
          <p className="muted">Las notas se guardan solo en el estado en memoria.</p>
          <div className="flow">
            <Button type="submit" disabled={!noteBody.trim()}>Guardar nota</Button>
            <Button type="button" variant="secondary" onClick={() => { setNoteBody(''); setIsAddingNote(false); }}>Cancelar</Button>
          </div>
        </form>
      )}
      {notes.length ? (
        <div className="member-notes-list">
          {notes.map(note => (
            <article key={note.id} className="member-note-card">
              <div className="member-note-header">
                <div className="member-note-author">
                  <span className="member-note-author-avatar" aria-hidden="true">
                    {note.authorName.slice(0, 2).toUpperCase()}
                  </span>
                  <strong>{note.id === 'sample-note-demo-001' ? `${note.authorName}` : note.authorName}</strong>
                </div>
                <time dateTime={note.createdAt}>
                  {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(note.createdAt))}
                </time>
              </div>
              <p className="member-note-body">{note.body}</p>
            </article>
          ))}
        </div>
      ) : <EmptyState title="Sin notas registradas">Todavía no hay notas para este socio.</EmptyState>}
    </Panel>
  );
}

function RentalCard({ title, code, expiresAt, now, assigned }: { title: string; code?: string; expiresAt?: string | null; now: string; assigned: boolean | null }) {
  const status = assigned === null ? 'unavailable' : assigned ? (title === 'Guantes' ? 'active' : rentalStatus(expiresAt, now)) : 'none';
  const labels = { unavailable: 'No disponible', none: 'Sin asignación', active: 'Renta activa', overdue: 'Vencida · días 1–14', 'eviction-status': 'Estado de desalojo · más de 14 días vencida' };
  return (
    <div className={`member-rental member-rental-${status}`}>
      <div className="member-rental-header">
        <div className="member-rental-icon-bubble" aria-hidden="true">
          {title === 'Guantes' ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h8a4 4 0 0 1 4 4v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V7a4 4 0 0 1 2-3.46" />
              <path d="M18 9h1a3 3 0 0 1 3 3v1a3 3 0 0 1-3 3h-1" />
              <path d="M6 17v4h8v-4" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <circle cx="12" cy="10" r="2" />
              <line x1="12" y1="12" x2="12" y2="15" />
            </svg>
          )}
        </div>
        <div className="member-rental-title-group">
          <h3>{title}</h3>
          <Badge tone={status === 'active' ? 'success' : status === 'overdue' ? 'warning' : status === 'eviction-status' ? 'error' : 'neutral'}>
            {labels[status]}
          </Badge>
        </div>
      </div>
      <div className="member-rental-body">
        <p className="member-rental-code-text">{assigned === null ? 'No disponible en esta integración' : code ? `Identificador ${code}` : 'Sin identificador asignado'}</p>
        {title === 'Casillero' && (
          <p className="member-rental-expiry-text">
            Vencimiento: {assigned === null ? 'No disponible en esta integración' : expiresAt ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' }).format(new Date(expiresAt)) : 'No registrado'}
          </p>
        )}
        {status === 'eviction-status' && (
          <p className="member-rental-eviction-text">Superó 14 días desde el vencimiento registrado; no confirma que el desalojo se haya ejecutado.</p>
        )}
      </div>
    </div>
  );
}

export function MemberDetailSections({
  member,
  now,
  visits = [],
  gloves,
  gloveRentals,
  lockers,
  lockerRentals,
  payments,
  supplementSales,
  sales = [],
  role = 'RECEPTION',
  reloadState,
  liveNotes,
  liveApi = false,
}: {
  member: Member;
  now: string;
  visits?: AttendanceVisit[];
  gloves: GloveItem[];
  gloveRentals: GloveRentalRecord[];
  lockers: LockerItem[];
  lockerRentals: LockerRentalRecord[];
  payments: MembershipPayment[];
  supplementSales: SupplementSale[];
  sales?: Sale[];
  role?: Role | 'ADMIN';
  reloadState?: MemberReloadResponse;
  liveNotes?: string | null;
  liveApi?: boolean;
}) {
  const memberPayments = useMemo(() => membershipHistory(payments, member.id), [payments, member.id]);
  const streak = liveApi ? null : membershipRenewalStreak(payments, member.id);
  const today = now.slice(0, 10);
  const membershipIsCurrent = Boolean(member.membership && member.membership.startsOn <= today && member.membership.endsOn >= today);
  const glove = gloves.find(item => item.assignedMemberId === member.id);
  const locker = lockers.find(item => item.assignedMemberId === member.id);
  const purchases = useMemo<Purchase[]>(() => [
    ...payments.map(p => ({ id: p.id, date: p.recordedAt, product: `Membresía · ${p.planName}`, amount: p.amountMinor, method: p.method, status: p.status === 'paid' ? 'Pagado' : 'Pendiente' })),
    ...gloveRentals.filter(r => r.memberId === member.id).map(r => ({ id: r.id, date: r.rentedAt, product: `Renta de guantes · ${gloves.find(g => g.id === r.gloveId)?.code ?? r.gloveId}`, amount: r.priceMinor, method: r.method, status: r.status === 'paid' ? 'Pagado' : 'Pendiente' })),
    ...lockerRentals.filter(r => r.memberId === member.id).map(r => ({ id: r.id, date: r.rentedAt, product: `Renta de casillero · ${lockers.find(l => l.id === r.lockerId)?.code ?? r.lockerId}`, amount: r.priceMinor, method: r.method, status: r.status === 'paid' ? 'Pagado' : 'Pendiente' })),
    ...supplementSales.filter(s => s.memberId === member.id).map(s => ({ id: s.id, date: s.recordedAt, product: s.name, amount: s.amountMinor, method: s.method, status: s.status === 'confirmed' ? 'Pagado' : 'Pendiente' })),
  ].sort((a, b) => b.date.localeCompare(a.date)), [payments, gloveRentals, lockerRentals, supplementSales, gloves, lockers, member.id]);
  const columns = useMemo<ColumnDef<Purchase>[]>(() => [
    {
      accessorKey: 'date',
      header: 'Fecha',
      cell: info => (
        <span className="member-purchase-date">
          {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' }).format(new Date(String(info.getValue())))}
        </span>
      ),
    },
    {
      accessorKey: 'product',
      header: 'Producto',
      cell: info => <span className="member-purchase-product">{String(info.getValue())}</span>,
    },
    {
      accessorKey: 'amount',
      header: 'Importe',
      cell: info => (
        <span className="member-purchase-amount">
          {formatMoney(Number(info.getValue()))} MXN
        </span>
      ),
    },
    {
      accessorKey: 'method',
      header: 'Método',
      cell: info => {
        const method = info.getValue() as PaymentMethod;
        const labels: Record<PaymentMethod, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };
        return (
          <span className={`member-method-badge method-${method}`}>
            {labels[method] ?? method}
          </span>
        );
      },
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      cell: info => <Badge tone={info.getValue() === 'Pagado' ? 'success' : 'warning'}>{String(info.getValue())}</Badge>,
    },
  ], []);
  const table = useReactTable({ data: purchases, columns, getCoreRowModel: getCoreRowModel() });
  const membershipRows = useMemo<MembershipRow[]>(() => [
    ...(liveApi ? (reloadState?.active_periods.map(period => ({ id: period.id, planName: period.plan_name, date: `${period.starts_on} – ${period.ends_on}`, current: period.is_current, period: true })) ?? []) : []),
    ...(membershipIsCurrent && member.membership && !reloadState?.active_periods.length ? [{ id: `current-${member.id}`, planName: member.membership.planName, date: `${member.membership.startsOn} – ${member.membership.endsOn}`, current: true }] : []),
    ...memberPayments.map(payment => ({ id: payment.id, planName: payment.planName, date: payment.recordedAt, current: false })),
  ], [membershipIsCurrent, member.id, member.membership, memberPayments, reloadState?.active_periods]);
  const membershipColumns = useMemo<ColumnDef<MembershipRow>[]>(() => [
    { accessorKey: 'planName', header: 'Membresía' },
    { accessorKey: 'date', header: 'Vigencia / fecha de pago', cell: info => info.row.original.current || info.row.original.period ? String(info.getValue()) : new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' }).format(new Date(String(info.getValue()))) },
  ], []);
  const membershipTable = useReactTable({ data: membershipRows, columns: membershipColumns, getCoreRowModel: getCoreRowModel() });

  const habits = useMemo(
    () => getMemberHabits(member.id, visits, supplementSales, sales, now.slice(0, 10)),
    [member.id, visits, supplementSales, sales, now]
  );
  const totalPaidMinor = useMemo(
    () => purchases.filter(p => p.status === 'Pagado').reduce((sum, p) => sum + p.amount, 0),
    [purchases]
  );
  const activePeriod = reloadState?.active_periods?.[0];
  const hasActivePeriod = Boolean(activePeriod);

  return <section className="member-detail-sections">
        <div className="member-detail-columns">
      <div className="member-detail-left-column">
        <div className="member-detail-membership">
          <Panel>
            <div className="member-membership-heading">
              <h2>Membresía</h2>
              {streak !== null && <><h3 className="sr-only">Racha</h3><Badge tone="warning">🔥 {streak} meses</Badge><span className="sr-only">Racha de renovaciones consecutivas: {streak} meses</span></>}
            </div>

            <div className={`member-current-plan-hero ${hasActivePeriod || membershipIsCurrent ? 'is-active' : 'is-inactive'}`}>
              <div className="member-plan-hero-top">
                <div className="member-plan-hero-icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="20" height="14" x="2" y="5" rx="2" />
                    <line x1="2" x2="22" y1="10" y2="10" />
                  </svg>
                </div>
                <div className="member-plan-hero-info">
                  <span className="member-plan-hero-subtitle">Membresía actual</span>
                  <strong className="member-plan-hero-title">
                    {activePeriod ? activePeriod.plan_name : (membershipIsCurrent && member.membership ? member.membership.planName : (member.membership?.planName ?? 'Sin membresía activa'))}
                  </strong>
                </div>
                <Badge tone={activePeriod ? (activePeriod.access_status === 'eligible' ? 'success' : activePeriod.access_status === 'branch_restricted' ? 'warning' : 'error') : (membershipIsCurrent ? 'success' : 'neutral')}>
                  {activePeriod ? (activePeriod.access_status === 'eligible' ? 'Elegible' : activePeriod.access_status === 'branch_restricted' ? 'Restringido a otra sucursal' : activePeriod.access_status === 'restricted_unpaid' ? 'Restringido por adeudo' : activePeriod.access_status) : (membershipIsCurrent ? 'Vigente' : 'Inactiva')}
                </Badge>
              </div>
              {(activePeriod || (membershipIsCurrent && member.membership)) && (
                <div className="member-plan-hero-meta">
                  <span className="member-plan-hero-date">
                    📅 Vigencia: <strong>{activePeriod ? `${activePeriod.starts_on} al ${activePeriod.ends_on}` : `${member.membership!.startsOn} al ${member.membership!.endsOn}`}</strong>
                  </span>
                  {activePeriod ? (
                    activePeriod.branch_id === null ? (
                      <Badge tone="neutral">Multisucursal</Badge>
                    ) : (
                      <span className="muted">Sucursal específica</span>
                    )
                  ) : streak !== null ? (
                    <span className="member-plan-hero-streak">
                      🔥 Racha: <strong>{streak} {streak === 1 ? 'mes' : 'meses'}</strong>
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            <TableRegion label={liveApi ? 'Períodos de membresía' : 'Historial de membresías'}>
              <div className="member-membership-table-scroll">
                <table className="member-detail-table">
                  <caption>{liveApi ? 'Períodos activos informados por la API; no representa el historial completo de pagos.' : 'Pago de membresías atribuidas al socio; la membresía actual muestra el período vigente registrado y las demás fechas son fechas de pago.'}</caption>
                  <thead>
                    {membershipTable.getHeaderGroups().map(group => (
                      <tr key={group.id}>
                        {group.headers.map(header => (
                          <th key={header.id} scope="col">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {membershipTable.getRowModel().rows.map(row => (
                      <tr key={row.id} className={row.original.current ? 'membership-current-row' : undefined}>
                        {row.getVisibleCells().map(cell => (
                          <td key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            {cell.column.id === 'planName' && row.original.current && <span className="sr-only"> · Actual</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableRegion>
            {!membershipRows.length && (
              <EmptyState title={liveApi ? 'Historial de pagos no disponible' : 'Sin membresías registradas.'}>
                {liveApi ? 'La API informa períodos activos, no el historial completo de membresías.' : 'No hay una membresía actual ni pagos atribuidos al socio.'}
              </EmptyState>
            )}
            {reloadState?.class_samples?.length ? (
              <div className="member-class-samples" style={{ marginTop: '1rem' }}>
                <h3 className="sr-only">Clases muestra</h3>
                <ul className="clean-list flow-gap-sm">
                  {reloadState.class_samples.map(sample => (
                    <li key={sample.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>{sample.plan_name}</strong>
                        <div>
                          {sample.is_consumed ? (
                            <span className="muted">Consumida</span>
                          ) : (
                            <span className="muted">Disponible para check-in</span>
                          )}
                        </div>
                      </div>
                      <Badge tone={sample.is_consumed ? 'neutral' : 'success'}>
                        {sample.is_consumed ? 'Consumida' : 'Disponible'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>
        </div>
        <div className="member-detail-rentals"><Panel><h2>{liveApi ? 'Rentas' : 'Rentas actuales'}</h2><div className="member-rental-grid">
      <RentalCard title="Guantes" code={glove?.code} now={now} assigned={liveApi ? null : Boolean(glove)} />
      <RentalCard title="Casillero" code={locker?.code} expiresAt={locker?.expiresAt} now={now} assigned={liveApi ? null : Boolean(locker)} />
      </div></Panel></div>
      </div>
      <div className="member-detail-right-column">
        <div className="member-detail-attendance">
          <Panel>
            <h2>Asistencia previa</h2>
            {liveApi ? <EmptyState title="Frecuencia histórica no disponible">La integración muestra hasta 12 visitas recientes, no el total histórico de asistencia.</EmptyState> : <AttendanceCalendar visits={visits} now={now} label="Asistencia previa" showIllustrativeDisclaimer={false} />}
            {reloadState?.recent_visits?.length ? (
              <div className="member-recent-visits" style={{ marginTop: '1rem' }}>
                <h3>{liveApi ? 'Últimas visitas (máximo 12)' : 'Visitas recientes'}</h3>
                <ul className="clean-list flow-gap-sm">
                  {reloadState.recent_visits.map(visit => (
                    <li key={visit.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>
                        <time dateTime={visit.occurred_at}>
                          {new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(visit.occurred_at))}
                        </time>
                        {' · '}{visit.access_reason}
                      </span>
                      {visit.access_warnings.map((w, i) => (
                        <Badge key={i} tone="warning">{w}</Badge>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>
        </div>
        <div className="member-detail-notes">{liveApi ? <ReadOnlyMemberNotes note={liveNotes ?? null} /> : <MemberNotes member={member} now={now} />}</div>
      </div>
    </div>
    {!liveApi && <div className="member-detail-habits">
      <Panel>
        <div className="member-habits-header">
          <div className="member-habits-title-wrap">
            <h2>Hábitos y preferencias de consumo</h2>
            <span className="muted member-habits-subtitle">
              {role === 'OWNER'
                ? 'Comportamiento de consumo, frecuencia de entrenamiento e inteligencia comercial.'
                : 'Frecuencia de visita y preferencias para atención personalizada en mostrador.'}
            </span>
          </div>
          <Badge
            tone={
              habits.engagementLevel === 'high'
                ? 'success'
                : habits.engagementLevel === 'low'
                  ? 'warning'
                  : 'neutral'
            }
          >
            {habits.engagementLabel}
          </Badge>
        </div>

        <div className="member-habits-grid">
          <div className="member-habit-block">
            <span className="member-habit-label">Frecuencia de asistencia</span>
            <span className="member-habit-value">
              {habits.weeklyVisits} <small>días / sem</small>
            </span>
            <span className="member-habit-desc">
              Promedio de {habits.monthlyVisits} visitas registradas en el mes.
            </span>
          </div>

          <div className="member-habit-block">
            <span className="member-habit-label">Productos y suplementos favoritos</span>
            {habits.favoriteProducts.length > 0 ? (
              <div className="member-favorite-products-list">
                {habits.favoriteProducts.map((prod, idx) => (
                  <span key={prod.name} className="member-fav-chip">
                    <span className="member-fav-rank">{idx + 1}°</span>
                    <strong>{prod.name}</strong>
                    <span className="muted">({prod.units} {prod.units === 1 ? 'ud' : 'uds'})</span>
                  </span>
                ))}
              </div>
            ) : (
              <span className="muted member-habit-empty">Sin compras registradas en mostrador.</span>
            )}
            <span className="member-habit-desc">
              Basado en el historial de consumos y ventas de suplementos.
            </span>
          </div>

          {role === 'OWNER' ? (
            <>
              <div className="member-habit-block">
                <span className="member-habit-label">Ticket promedio mostrador</span>
                <span className="member-habit-value">
                  {formatMoney(habits.averageTicketMinor)} <small>MXN</small>
                </span>
                <span className="member-habit-desc">
                  Gasto promedio por compra de producto o suplemento.
                </span>
              </div>
              <div className="member-habit-block">
                <span className="member-habit-label">Gasto total en mostrador</span>
                <span className="member-habit-value">
                  {formatMoney(habits.totalRetailSpendMinor)} <small>MXN</small>
                </span>
                <span className="member-habit-desc">
                  Ventas de cafetería y suplementación (LTV total: {formatMoney(totalPaidMinor)} MXN).
                </span>
              </div>
            </>
          ) : (
            <div className="member-habit-block member-habit-action">
              <span className="member-habit-label">Sugerencia de mostrador</span>
              <p className="member-habit-suggestion-text">{habits.serviceRecommendation}</p>
              {habits.favoriteProducts[0] && (
                <div className="member-habit-tip-hint">
                  💡 Ofrecer habitual: <strong>{habits.favoriteProducts[0].name}</strong> al registrar entrada o salida.
                </div>
              )}
            </div>
          )}
        </div>

        {role === 'OWNER' && (
          <div className="member-habits-recommendation" role="note" aria-label="Estrategia de retención">
            <strong>Recomendación comercial: </strong>
            {habits.serviceRecommendation}
          </div>
        )}
      </Panel>
    </div>}
    {role === 'OWNER' && reloadState?.financial.debts.length ? <Panel><h2>Adeudos pendientes</h2><TableRegion label="Adeudos pendientes"><table className="member-detail-table"><thead><tr><th scope="col">Pedido</th><th scope="col">Fecha</th><th scope="col">Adeudo</th><th scope="col">Saldo restante</th></tr></thead><tbody>{reloadState.financial.debts.map(debt => <tr key={debt.debt_id}><td>{debt.order_id}</td><td>{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' }).format(new Date(debt.created_at))}</td><td>{formatMoney(debt.initial_outstanding_minor)} MXN</td><td>{formatMoney(debt.remaining_balance_minor)} MXN</td></tr>)}</tbody></table></TableRegion></Panel> : null}
    <div className="member-detail-purchases">
      <Panel>
        <div className="member-purchases-header">
          <h2>Historial de compras</h2>
          {purchases.length > 0 && (
            <span className="member-purchases-count-pill" aria-label={`${purchases.length} operaciones`}>
              {purchases.length} {purchases.length === 1 ? 'operación' : 'operaciones'}
            </span>
          )}
        </div>
        {purchases.length ? (
          <TableRegion label="Historial de compras">
            <div className="member-purchase-table-scroll">
              <table className="member-detail-table">
                <caption>Operaciones atribuidas al socio</caption>
                <thead>
                  {table.getHeaderGroups().map(group => (
                    <tr key={group.id}>
                      {group.headers.map(header => (
                        <th key={header.id} scope="col">
                          {flexRender(header.column.columnDef.header, header.getContext())}
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
                </tbody>
              </table>
            </div>
          </TableRegion>
        ) : liveApi ? (
          <EmptyState title="Historial de compras no disponible">No hay un historial de compras incluido en esta integración.</EmptyState>
        ) : (
          <EmptyState title="Sin compras registradas">No hay operaciones atribuibles a este socio.</EmptyState>
        )}
      </Panel>
    </div>
  </section>;
}

export function MemberCounterView({
  member,
  now,
  visits = [],
  gloves = [],
  gloveRentals = [],
  lockers = [],
  lockerRentals = [],
  payments = [],
  supplementSales = [],
  sales = [],
  role = 'RECEPTION',
  reloadState,
  onSwitchToRecord,
}: {
  member: Member;
  now: string;
  visits?: AttendanceVisit[];
  gloves?: GloveItem[];
  gloveRentals?: GloveRentalRecord[];
  lockers?: LockerItem[];
  lockerRentals?: LockerRentalRecord[];
  payments?: MembershipPayment[];
  supplementSales?: SupplementSale[];
  sales?: Sale[];
  role?: Role | 'ADMIN';
  reloadState?: MemberReloadResponse;
  onSwitchToRecord?: () => void;
}) {
  const { state, update } = useDemo();
  const selectedStaff = getSelectedStaff();
  const activeStaff = selectedStaff || { id: 'recep-1', name: 'Valeria M.' };
  const [noteBody, setNoteBody] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);

  const allNotes = (state.memberNotes ?? []).filter(note => note.memberId === member.id);
  const latestNote = allNotes[0] ?? null;

  const statusInfo = getMemberStatusInfo(member, now);
  const streak = useMemo(() => membershipRenewalStreak(payments, member.id), [payments, member.id]);
  const today = now.slice(0, 10);
  const membershipIsCurrent = Boolean(
    member.membership &&
    member.membership.startsOn <= today &&
    member.membership.endsOn >= today
  );

  const pendingPayments = payments.filter(p => p.status === 'pending');
  const pendingRentals = [...gloveRentals, ...lockerRentals].filter(
    r => r.memberId === member.id && r.status === 'pending'
  );
  const hasPendingBalance = pendingPayments.length > 0 || pendingRentals.length > 0;
  const isExpired = statusInfo.status === 'expired' || statusInfo.status === 'inactive';
  const isExpiryToday = statusInfo.provisional || member.demoScenario === 'expiry-today';

  const activePeriod = reloadState?.active_periods?.[0];
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const effectiveHasPendingBalance = reloadState ? reloadState.financial.has_pending_balance : hasPendingBalance;

  const reloadLastVisit = reloadState?.recent_visits?.[0];

  const latestPayment = useMemo(() => {
    if (!payments.length) return null;
    return [...payments].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  }, [payments]);

  const openVisit = visits.find(openAttendance);
  const sortedVisits = useMemo(
    () => [...visits].sort((a, b) => b.observedCheckIn.localeCompare(a.observedCheckIn)),
    [visits]
  );
  const lastVisit = sortedVisits[0];
  const lastVisitDate = lastVisit?.observedCheckIn.slice(0, 10);
  const isToday = lastVisitDate === today;

  const habits = useMemo(
    () => getMemberHabits(member.id, visits, supplementSales, sales, today),
    [member.id, visits, supplementSales, sales, today]
  );

  const greetingInsight = useMemo(() => {
    if (visits.length === 0) {
      return 'Nuevo socio: Dar bienvenida cálida, explicar vestidores, casilleros e hidratación.';
    }
    if (isToday && !openVisit) {
      return 'Segunda visita de la jornada: Saludar cordialmente y confirmar hidratación.';
    }
    if (lastVisit) {
      const daysSinceLast = Math.round((Date.parse(today) - Date.parse(lastVisitDate)) / 86400000);
      if (daysSinceLast >= 7) {
        return 'Reincorporación: Preguntar cómo ha estado tras varios días sin entrenar.';
      }
    }
    if (habits.weeklyVisits >= 3) {
      return 'Socio habitual: Saludo ágil y desear excelente entrenamiento del día.';
    }
    return 'Saludo cordial: Recibir por su nombre y desear excelente entrenamiento.';
  }, [visits.length, isToday, openVisit, lastVisit, lastVisitDate, today, habits.weeklyVisits]);

  const glove = gloves.find(item => item.assignedMemberId === member.id);
  const locker = lockers.find(item => item.assignedMemberId === member.id);
  const lockerState = locker ? rentalStatus(locker.expiresAt, now) : 'none';
  const hasRentalWarning = lockerState === 'overdue' || lockerState === 'eviction-status';

  const handleSaveNote = (event: React.FormEvent) => {
    event.preventDefault();
    if (!noteBody.trim()) return;
    const newNote = {
      memberId: member.id,
      body: noteBody.trim(),
      authorId: activeStaff.id,
      authorName: activeStaff.name,
      createdAt: now,
    };
    update(current => ({
      ...current,
      memberNotes: addMemberNote(current.memberNotes ?? [], newNote),
    }));
    setNoteBody('');
    setIsAddingNote(false);
  };

  return (
    <section className="member-counter-view" aria-label="Vista operativa de mostrador">
            <div className="member-counter-grid">
        {/* Card 1: Membresía & Cobranza */}
        <div className="counter-card counter-card-membership">
          <div className="counter-card-header">
            <div className="counter-card-title-group">
              <span className="counter-card-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="14" x="2" y="5" rx="2" />
                  <line x1="2" x2="22" y1="10" y2="10" />
                </svg>
              </span>
              <h2>Membresía</h2>
            </div>
            <Badge tone={activePeriod ? (activePeriod.access_status === 'eligible' ? 'success' : activePeriod.access_status === 'branch_restricted' ? 'warning' : 'error') : statusInfo.tone}>
              {activePeriod ? (activePeriod.access_status === 'eligible' ? 'Elegible' : activePeriod.access_status === 'branch_restricted' ? 'Restringido a otra sucursal' : activePeriod.access_status === 'restricted_unpaid' ? 'Restringido por adeudo' : activePeriod.access_status) : statusInfo.badgeLabel}
            </Badge>
          </div>

          <div className="counter-card-content">
            <div className="counter-plan-display">
              <strong className="counter-plan-title">
                {activePeriod ? activePeriod.plan_name : (membershipIsCurrent && member.membership ? member.membership.planName : (member.membership?.planName ?? 'Sin membresía activa'))}
              </strong>
              {(activePeriod || member.membership) && (
                <span className="counter-plan-dates muted">
                  📅 Vigencia: {activePeriod ? `${activePeriod.starts_on} al ${activePeriod.ends_on}` : `${member.membership!.startsOn} al ${member.membership!.endsOn}`}
                </span>
              )}
            </div>

            <div className="counter-streak-badge">
              <span>🔥 Racha: <strong>{streak} {streak === 1 ? 'mes' : 'meses'}</strong></span>
            </div>

            {latestPayment && (
              <div className="counter-last-payment-row">
                <span className="counter-last-payment-label muted">Último cobro:</span>
                <Badge tone={latestPayment.status === 'paid' ? 'success' : 'warning'}>
                  {latestPayment.status === 'paid' ? 'Pagado' : 'Pendiente'}
                </Badge>
              </div>
            )}

            <div className="counter-billing-section">
              {isExpired && !activePeriod ? (
                <div className="counter-billing-alert is-overdue" role="alert">
                  ⚠️ Membresía vencida — Requiere renovación
                </div>
              ) : isExpiryToday && !activePeriod ? (
                <div className="counter-billing-alert is-warning" role="alert">
                  ⏳ Vence hoy — Ofrecer renovación
                </div>
              ) : effectiveHasPendingBalance ? (
                <div className="counter-billing-alert is-warning" role="alert" data-testid="balance-warning-alert">
                  ⚠️ Saldo pendiente registrado
                  {isAdmin && reloadState?.financial.total_pending_balance_minor !== null && reloadState?.financial.total_pending_balance_minor !== undefined ? (
                    <span className="counter-debt-amount" data-testid="admin-debt-amount">
                      {' · '}Adeudo: {formatMoney(reloadState.financial.total_pending_balance_minor)} MXN
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="counter-billing-status is-settled">
                  <span className="counter-settled-dot" aria-hidden="true">✓</span>
                  <span>Al corriente en pagos</span>
                </div>
              )}
            </div>
          </div>

          {onSwitchToRecord && (
            <div className="counter-card-footer">
              <button type="button" className="counter-card-link-btn" onClick={onSwitchToRecord}>
                Ver historial de membresías ›
              </button>
            </div>
          )}
        </div>

        {/* Card 2: Asistencia & Pauta Humana */}
        <div className="counter-card counter-card-attendance">
          <div className="counter-card-header">
            <div className="counter-card-title-group">
              <span className="counter-card-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              <div>
                <h2>Asistencia previa</h2>
                <span className="counter-card-subtitle">Pauta de recepción</span>
              </div>
            </div>
            <Badge tone={openVisit ? 'success' : 'neutral'}>
              {openVisit ? 'En el club' : 'Fuera del club'}
            </Badge>
          </div>

          <div className="counter-card-content">
            <div className="counter-human-callout">
              <span className="counter-human-callout-icon" aria-hidden="true">💬</span>
              <p className="counter-human-text">{greetingInsight}</p>
            </div>

            <div className="counter-attendance-metrics">
              <div className="counter-metric-row">
                <span className="counter-metric-label muted">Última visita:</span>
                <span className="counter-metric-val">
                  {reloadLastVisit
                    ? (reloadLastVisit.occurred_at.slice(0, 10) === today
                        ? `Hoy, ${new Intl.DateTimeFormat('es-MX', { timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(reloadLastVisit.occurred_at))}`
                        : new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(reloadLastVisit.occurred_at)))
                    : lastVisit
                    ? (lastVisit.observedCheckIn.slice(0, 10) === today
                        ? `Hoy, ${new Intl.DateTimeFormat('es-MX', { timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(lastVisit.observedCheckIn))}`
                        : new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(lastVisit.observedCheckIn)))
                    : 'Sin visitas registradas'}
                </span>
              </div>
              <div className="counter-metric-row">
                <span className="counter-metric-label muted">Frecuencia mensual:</span>
                <span className="counter-metric-val">
                  <strong>{habits.monthlyVisits}</strong> {habits.monthlyVisits === 1 ? 'visita' : 'visitas'} este mes
                  <span className="muted"> ({habits.weeklyVisits} días / sem)</span>
                </span>
              </div>
            </div>
          </div>

          {onSwitchToRecord && (
            <div className="counter-card-footer">
              <button type="button" className="counter-card-link-btn" onClick={onSwitchToRecord}>
                Ver mapa de asistencia ›
              </button>
            </div>
          )}
        </div>

        {/* Card 3: Rentas Activas */}
        <div className="counter-card counter-card-rentals">
          <div className="counter-card-header">
            <div className="counter-card-title-group">
              <span className="counter-card-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <circle cx="12" cy="10" r="2" />
                  <line x1="12" y1="12" x2="12" y2="15" />
                </svg>
              </span>
              <h2>Rentas actuales</h2>
            </div>
            {hasRentalWarning && <Badge tone="error">Atención</Badge>}
          </div>

          <div className="counter-card-content">
            <div className="counter-rental-items">
              <div className="counter-rental-row">
                <div className="counter-rental-item-info">
                  <span className="counter-rental-icon-mini" aria-hidden="true">🔐</span>
                  <div>
                    <strong>Casillero</strong>
                    <span className="counter-rental-meta muted">
                      {locker ? `Identificador ${locker.code}` : 'Sin asignar'}
                      {locker?.expiresAt && ` · Vence ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' }).format(new Date(locker.expiresAt))}`}
                    </span>
                  </div>
                </div>
                <Badge
                  tone={
                    lockerState === 'active'
                      ? 'success'
                      : lockerState === 'overdue'
                        ? 'warning'
                        : lockerState === 'eviction-status'
                          ? 'error'
                          : 'neutral'
                  }
                >
                  {lockerState === 'active'
                    ? 'Activo'
                    : lockerState === 'overdue'
                      ? 'Vencido'
                      : lockerState === 'eviction-status'
                        ? 'Desalojo'
                        : 'Sin renta'}
                </Badge>
              </div>

              <div className="counter-rental-row">
                <div className="counter-rental-item-info">
                  <span className="counter-rental-icon-mini" aria-hidden="true">🥊</span>
                  <div>
                    <strong>Guantes</strong>
                    <span className="counter-rental-meta muted">
                      {glove ? `Identificador ${glove.code}` : 'Sin asignar'}
                    </span>
                  </div>
                </div>
                <Badge tone={glove ? 'success' : 'neutral'}>
                  {glove ? 'Activo' : 'Sin renta'}
                </Badge>
              </div>
            </div>

            {lockerState === 'overdue' && (
              <div className="counter-rental-alert is-warning" role="alert">
                ⚠️ <strong>Casillero vencido:</strong> Gestión de renovación en curso.
              </div>
            )}
            {lockerState === 'eviction-status' && (
              <div className="counter-rental-alert is-danger" role="alert">
                🚨 <strong>Estado de desalojo:</strong> Casillero superó 14 días vencido.
              </div>
            )}
          </div>

          {onSwitchToRecord && (
            <div className="counter-card-footer">
              <button type="button" className="counter-card-link-btn" onClick={onSwitchToRecord}>
                Ver rentas en expediente ›
              </button>
            </div>
          )}
        </div>

        {/* Card 4: Atención al Socio */}
        <div className="counter-card counter-card-service">
          <div className="counter-card-header">
            <div className="counter-card-title-group">
              <span className="counter-card-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              <h2>Atención al socio</h2>
            </div>
            <Button
              variant="secondary"
              className="member-notes-toggle-btn"
              onClick={() => setIsAddingNote(prev => !prev)}
            >
              {isAddingNote ? 'Cancelar' : '+ Agregar nota'}
            </Button>
          </div>

          <div className="counter-card-content">
            {isAddingNote ? (
              <form className="member-note-form" onSubmit={handleSaveNote}>
                <div className="member-note-author-info">
                  Registrando como: <strong>{activeStaff.name}</strong>
                </div>
                <textarea
                  id="counter-member-note"
                  aria-label="Nueva nota"
                  value={noteBody}
                  onChange={event => setNoteBody(event.target.value)}
                  maxLength={1000}
                  placeholder="Escribe la nota para el socio..."
                />
                <p className="muted">Las notas se guardan solo en el estado en memoria.</p>
                <div className="flow">
                  <Button type="submit" disabled={!noteBody.trim()}>
                    Guardar nota
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setNoteBody('');
                      setIsAddingNote(false);
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            ) : latestNote ? (
              <article className="counter-latest-note">
                <div className="member-note-header">
                  <div className="member-note-author">
                    <span className="member-note-author-avatar" aria-hidden="true">
                      {latestNote.authorName.slice(0, 2).toUpperCase()}
                    </span>
                    <strong>{latestNote.authorName}</strong>
                  </div>
                  <time dateTime={latestNote.createdAt}>
                    {new Intl.DateTimeFormat('es-MX', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'America/Mexico_City',
                    }).format(new Date(latestNote.createdAt))}
                  </time>
                </div>
                <p className="member-note-body">{latestNote.body}</p>
              </article>
            ) : (
              <p className="counter-empty-note muted">Sin notas registradas.</p>
            )}

            {habits.favoriteProducts.length > 0 && !isAddingNote && (
              <div className="counter-upsell-box">
                <span className="counter-upsell-icon" aria-hidden="true">🥤</span>
                <div className="counter-upsell-content">
                  <span className="counter-upsell-title">Sugerencia de mostrador:</span>
                  <p className="counter-upsell-text">
                    Ofrecer su habitual: <strong>{habits.favoriteProducts[0].name}</strong>
                  </p>
                </div>
              </div>
            )}
          </div>

          {onSwitchToRecord && !isAddingNote && (
            <div className="counter-card-footer">
              <button type="button" className="counter-card-link-btn" onClick={onSwitchToRecord}>
                Ver todas las notas ({allNotes.length}) ›
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}


