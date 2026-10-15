import { useMemo, useState } from 'react';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import type { AttendanceVisit, GloveItem, GloveRentalRecord, LockerItem, LockerRentalRecord, MembershipPayment, Member, PaymentMethod, Role, Sale, SupplementSale } from '../../domain/models';
import { formatMoney } from '../../demo/adapter';
import { addMemberNote, membershipHistory, membershipRenewalStreak } from '../../demo/memberNotes';
import { getMemberHabits } from '../../demo/memberAnalyticsSelector';
import { useDemo } from '../../demo/DemoProvider';
import { getSelectedStaff } from '../staff/staffStore';
import { rentalStatus } from './memberDetailUtils';
import { Badge, Button, EmptyState, Panel, TableRegion } from '../../shared/ui';
import { AttendanceCalendar } from '../attendance/AttendanceCalendar';
import './MemberDetail.css';

type Purchase = { id: string; date: string; product: string; amount: number; method: PaymentMethod; status: string };
type MembershipRow = { id: string; planName: string; date: string; current: boolean };

function MemberNotes({ member, now }: { member: Member; now: string }) {
  const { state, update } = useDemo();
  const selectedStaff = getSelectedStaff();
  const activeStaff = selectedStaff || { id: 'recep-1', name: 'Valeria M.' };
  const [noteBody, setNoteBody] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const notes = (state.memberNotes ?? []).filter(note => note.memberId === member.id);

  return <Panel>
    <div className="member-notes-header">
      <h2>Nota</h2>
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
              <strong>{note.id === 'sample-note-demo-001' ? `${note.authorName}` : note.authorName}</strong>
              <time dateTime={note.createdAt}>
                {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(note.createdAt))}
              </time>
            </div>
            <p className="member-note-body">{note.body}</p>
          </article>
        ))}
      </div>
    ) : <EmptyState title="Sin notas registradas">Todavía no hay notas para este socio.</EmptyState>}
  </Panel>;
}

function RentalCard({ title, code, expiresAt, now, assigned }: { title: string; code?: string; expiresAt?: string | null; now: string; assigned: boolean }) {
  const status = assigned ? (title === 'Guantes' ? 'active' : rentalStatus(expiresAt, now)) : 'none';
  const labels = { none: 'Sin asignación', active: 'Renta activa', overdue: 'Vencida · días 1–14', 'eviction-status': 'Estado de desalojo · más de 14 días vencida' };
  return <div className={`member-rental member-rental-${status}`}>
    <h3>{title}</h3><Badge tone={status === 'active' ? 'success' : status === 'overdue' ? 'warning' : status === 'eviction-status' ? 'error' : 'neutral'}>{labels[status]}</Badge>
    <p>{code ? `Identificador ${code}` : 'Sin identificador asignado'}</p>
    {title === 'Casillero' && <p>Vencimiento: {expiresAt ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' }).format(new Date(expiresAt)) : 'No registrado'}</p>}
    {status === 'eviction-status' && <p>Superó 14 días desde el vencimiento registrado; no confirma que el desalojo se haya ejecutado.</p>}
  </div>;
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
  role?: Role;
}) {
  const memberPayments = useMemo(() => membershipHistory(payments, member.id), [payments, member.id]);
  const streak = membershipRenewalStreak(payments, member.id);
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
    { accessorKey: 'date', header: 'Fecha', cell: info => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' }).format(new Date(String(info.getValue()))) },
    { accessorKey: 'product', header: 'Producto' },
    { accessorKey: 'amount', header: 'Importe', cell: info => `${formatMoney(Number(info.getValue()))} MXN` },
    { accessorKey: 'method', header: 'Método', cell: info => ({ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' }[info.getValue() as PaymentMethod]) },
    { accessorKey: 'status', header: 'Estado', cell: info => <Badge tone={info.getValue() === 'Pagado' ? 'success' : 'warning'}>{String(info.getValue())}</Badge> },
  ], []);
  const table = useReactTable({ data: purchases, columns, getCoreRowModel: getCoreRowModel() });
  const membershipRows = useMemo<MembershipRow[]>(() => [
    ...(membershipIsCurrent && member.membership ? [{ id: `current-${member.id}`, planName: member.membership.planName, date: `${member.membership.startsOn} – ${member.membership.endsOn}`, current: true }] : []),
    ...memberPayments.map(payment => ({ id: payment.id, planName: payment.planName, date: payment.recordedAt, current: false })),
  ], [membershipIsCurrent, member.id, member.membership, memberPayments]);
  const membershipColumns = useMemo<ColumnDef<MembershipRow>[]>(() => [
    { accessorKey: 'planName', header: 'Membresía' },
    { accessorKey: 'date', header: 'Vigencia / fecha de pago', cell: info => info.row.original.current ? String(info.getValue()) : new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' }).format(new Date(String(info.getValue()))) },
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

  return <section className="member-detail-sections">
    <div className="member-detail-columns">
      <div className="member-detail-left-column">
        <div className="member-detail-membership"><Panel><div className="member-membership-heading"><h2>Membresía</h2><h3 className="sr-only">Racha</h3><Badge tone="warning">🔥 {streak} meses</Badge><span className="sr-only">Racha de renovaciones consecutivas: {streak} meses</span></div><TableRegion label="Historial de membresías"><div className="member-membership-table-scroll"><table className="member-detail-table"><caption>Pago de membresías atribuidas al socio; la membresía actual muestra el período vigente registrado y las demás fechas son fechas de pago.</caption><thead>{membershipTable.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} scope="col">{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead><tbody>{membershipTable.getRowModel().rows.map(row => <tr key={row.id} className={row.original.current ? 'membership-current-row' : undefined}>{row.getVisibleCells().map(cell => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}{cell.column.id === 'planName' && row.original.current && <span className="sr-only"> · Actual</span>}</td>)}</tr>)}</tbody></table></div></TableRegion>{!membershipRows.length && <EmptyState title="Sin membresías registradas.">No hay una membresía actual ni pagos atribuidos al socio.</EmptyState>}</Panel></div>
        <div className="member-detail-rentals"><Panel><h2>Rentas actuales</h2><div className="member-rental-grid">
      <RentalCard title="Guantes" code={glove?.code} now={now} assigned={Boolean(glove)} />
      <RentalCard title="Casillero" code={locker?.code} expiresAt={locker?.expiresAt} now={now} assigned={Boolean(locker)} />
      </div></Panel></div>
      </div>
      <div className="member-detail-right-column">
        <div className="member-detail-attendance"><Panel><h2>Asistencia previa</h2><AttendanceCalendar visits={visits} now={now} label="Asistencia previa" showIllustrativeDisclaimer={false} /></Panel></div>
        <div className="member-detail-notes"><MemberNotes member={member} now={now} /></div>
      </div>
    </div>
    <div className="member-detail-habits">
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
    </div>
    <div className="member-detail-purchases"><Panel><h2>Historial de compras</h2>{purchases.length ? <TableRegion label="Historial de compras"><div className="member-purchase-table-scroll"><table className="member-detail-table"><caption>Operaciones atribuidas al socio</caption><thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} scope="col">{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map(row => <tr key={row.id}>{row.getVisibleCells().map(cell => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div></TableRegion> : <EmptyState title="Sin compras registradas">No hay operaciones atribuibles a este socio.</EmptyState>}</Panel></div>
  </section>;
}

