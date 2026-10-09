import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Role } from '../../domain/models';
import { rolePath } from '../../app/navigation';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney } from '../../demo/adapter';
import { addMember } from '../../demo/operations';
import { Badge, Button, EmptyState, Field, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';
import { memberStatus } from '../../demo/memberStatus';
import { OwnerQuestions } from '../demo/OwnerQuestions';
import { AttendanceCalendar } from '../attendance/AttendanceCalendar';
import { advanceAttendanceClock, attendanceClosing, attendanceDay, attendanceDuration, demoGymTimezone, enterMember, exitMember, openAttendance } from '../../demo/attendanceOperations';

export const paymentMethods = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia sin confirmar' };
export function NotebookNotice() {
  return <Notice tone="warning">Registra la operación en la libreta física obligatoria. Excel sigue siendo el maestro; la comparación es manual. La referencia demo no es un folio de la libreta ni un comprobante real.</Notice>;
}

export function Members({ role }: { role: Role }) {
  const { state } = useDemo();
  const [query, setQuery] = useState('');
  const members = state.members.filter(member => `${member.name} ${member.phone} ${member.id}`.toLocaleLowerCase('es-MX').includes(query.trim().toLocaleLowerCase('es-MX')));
  return <><PageHeader eyebrow="RECEPCIÓN · SOCIOS" title="Socios y membresías" description="Encuentra a la persona antes de registrar una operación." action={<Link className="button button-primary" to={rolePath(role, 'members/new')}>Nuevo socio</Link>} />
    <Panel><Field id="member-search" label="Buscar socio" placeholder="Nombre, teléfono o referencia demo" value={query} onChange={event => setQuery(event.target.value)} />
      {members.length ? <TableRegion label="Socios de demostración"><table><caption>{members.length} resultados de demostración</caption><thead><tr><th scope="col">Socio</th><th scope="col">Teléfono</th><th scope="col">Membresía de muestra</th></tr></thead><tbody>{members.map(member => <tr key={member.id}><td><Link to={rolePath(role, `members/${member.id}`)}>{member.name}</Link><p className="muted">{member.id}</p></td><td>{member.phone || 'No capturado'}</td><td>{member.membership ? `${member.membership.planName} · ${member.membership.endsOn}` : 'Sin fechas registradas'}</td></tr>)}</tbody></table></TableRegion> : <EmptyState title="Sin coincidencias">Prueba otro nombre o registra un socio de demostración.</EmptyState>}</Panel></>;
}

export function NewMember({ role }: { role: Role }) {
  const { transact } = useDemo();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  return <><PageHeader eyebrow="SOCIOS · ALTA DEMO" title="Nuevo socio" description="Captura solo los datos mínimos. No se crea una membresía ni se concede acceso." />
    <Panel><form noValidate onSubmit={event => {
      event.preventDefault();
      const result = transact(state => addMember(state, `demo-${crypto.randomUUID()}`, name, phone));
      if (result.error) setError(result.error);
      else navigate(rolePath(role, `members/${result.id}`));
    }}><Field id="new-name" label="Nombre" required value={name} onChange={event => setName(event.target.value)} error={error || undefined} />
      <Field id="new-phone" label="Teléfono (opcional)" type="tel" value={phone} onChange={event => setPhone(event.target.value)} />
      <div className="flow"><Button type="submit">Crear socio de demostración</Button><Link to={rolePath(role, 'members')}>Volver a socios</Link></div></form></Panel></>;
}

export function MemberDetail({ role }: { role: Role }) {
  const { memberId } = useParams();
  const { state, resetVersion } = useDemo();
  const member = state.members.find(item => item.id === memberId);
  if (!member) return <Panel><EmptyState title="Socio no disponible">El registro no existe o la demo fue restablecida. <Link to={rolePath(role, 'members')}>Volver a socios</Link></EmptyState></Panel>;
  const payments = state.payments.filter(payment => payment.memberId === member.id);
  const status = memberStatus(member);
  return <><PageHeader eyebrow="SOCIO · DETALLE" title={member.name} description={`${member.id} · ${member.phone || 'Teléfono no capturado'}`} action={<Link className="button button-primary" to={rolePath(role, `members/${member.id}/payment`)}>Registrar pago de membresía</Link>} />
    <MemberAttendance key={`${member.id}-${resetVersion}`} memberId={member.id} role={role} />
    <div className="bento-grid"><Panel><h2>Membresía y fechas</h2><Badge tone={status.status === 'inactive' || status.provisional ? 'warning' : 'neutral'}>{status.label}</Badge>
      {member.demoScenario && <Notice>Escenario de demostración: {status.label}. No autoriza acceso real; las fechas de ejemplo no siguen el reloj actual.</Notice>}
      {status.status === 'inactive' && <Notice tone="warning">Renovar antes de registrar una nueva entrada. Sin prórroga en esta demo.</Notice>}
      {status.provisional && <Notice tone="warning">Q-01 provisional: permitir entrada el día de vencimiento. Falta confirmarlo con la dueña.</Notice>}
      {member.membership ? <><p>{member.membership.planName}</p><p>{member.membership.startsOn} a {member.membership.endsOn}</p><Badge>Fechas ilustrativas de demostración</Badge></> : <p>Sin fechas de membresía registradas.</p>}
      <Notice>Un pago completo es requisito para acceso. Las fechas efectivas, renovación mensual y excepciones siguen por definir; esta demo no autoriza acceso.</Notice></Panel>
      <Panel><h2>Saldo a favor</h2><p className="text-3xl font-bold">{formatMoney(member.creditMinor)} MXN</p><p className="muted">Crédito separado del pago; no es deuda ni método. Aplicación, recarga y devolución no disponibles.</p></Panel>
      <Panel className="span-full"><h2>Historial del socio</h2>{payments.length ? <TableRegion label="Pagos del socio"><table><caption>Operaciones locales de demostración</caption><thead><tr><th scope="col">Plan / referencia</th><th scope="col">Total MXN</th><th scope="col">Método</th><th scope="col">Resultado</th></tr></thead><tbody>{payments.map(payment => <tr key={payment.id}><td>{payment.planName}<p className="muted">{payment.id}</p></td><td>{formatMoney(payment.amountMinor)}</td><td>{paymentMethods[payment.method]}</td><td><Badge tone={payment.status === 'paid' ? 'success' : 'warning'}>{payment.status === 'paid' ? 'Pagado · fechas por definir' : 'Transferencia pendiente'}</Badge></td></tr>)}</tbody></table></TableRegion> : <EmptyState title="Sin pagos registrados">Las fechas de muestra no son un historial de cobros.</EmptyState>}</Panel></div><OwnerQuestions ids={['Q-01', 'Q-04', 'Q-05']} /><NotebookNotice /><div className="flow"><Link to={rolePath(role, 'members')}>Volver a socios</Link></div></>;
}

function MemberAttendance({ memberId, role }: { memberId: string; role: Role }) {
  const { state, transact, update } = useDemo();
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const member = state.members.find(item => item.id === memberId)!;
  const status = memberStatus(member);
  const visits = state.attendance.filter(visit => visit.memberId === memberId);
  const open = visits.find(openAttendance);
  const last = visits.at(-1);
  function advance(now: string) {
    const result = transact(current => advanceAttendanceClock(current, now));
    setError(result.status === 'error');
    setMessage(result.status === 'error' ? result.message : 'Hora demo actualizada; visitas pendientes reconciliadas.');
  }
  return <Panel className="attendance-panel">
    <div className="page-header"><div><h2>Asistencia de demostración</h2><p className="muted">Solo prueba de interfaz; no autoriza acceso real.</p></div>
      <Button disabled={!open && status.status !== 'active'} onClick={() => {
        const result = transact(current => open ? exitMember(current, memberId, current.demoClock)
          : enterMember(current, { id: `attendance-${crypto.randomUUID()}`, memberId, now: current.demoClock }));
        setError(result.status === 'error');
        setMessage(result.status === 'error' ? result.message : open ? 'Salida registrada con duración medida.' : 'Entrada registrada en la demo.');
      }}>{open ? 'Registrar salida demo' : 'Registrar entrada demo'}</Button>
    </div>
    {status.status === 'unknown' && <Notice>Sin elegibilidad confirmada. Para probar asistencia, abre el <Link to={rolePath(role, 'members/demo-active')}>escenario activo de demostración</Link>.</Notice>}
    {status.status === 'inactive' && <Notice tone="warning">Membresía vencida: renovar antes de una entrada. Registrar un pago no inventa fechas efectivas.</Notice>}
    {open && <p>Visita abierta · duración pendiente hasta registrar salida.</p>}
    {last && !open && <p>{last.autoClosedAt ? 'Cierre automático · duración desconocida' : `Última visita: ${attendanceDuration(last)} min medidos`}</p>}
    <div role={error ? 'alert' : 'status'} aria-label="Resultado de asistencia">{message}</div>
    <details className="owner-questions"><summary>Probar reglas provisionales</summary>
      <p className="muted">Q-01 y Q-03 · Preferencias pendientes de confirmar con la dueña.</p>
      <label className="policy-toggle"><input type="checkbox" checked={state.attendancePolicy.allowExpiryDay} onChange={event => {
        const checked = event.target.checked; update(current => ({ ...current, revision: current.revision + 1, attendancePolicy: { ...current.attendancePolicy, allowExpiryDay: checked } }));
      }} />Permitir entrada el día de vencimiento · provisional</label>
      <label className="policy-toggle"><input type="checkbox" checked={state.attendancePolicy.allowRepeatVisits} onChange={event => {
        const checked = event.target.checked; update(current => ({ ...current, revision: current.revision + 1, attendancePolicy: { ...current.attendancePolicy, allowRepeatVisits: checked } }));
      }} />Permitir varias visitas al día · provisional</label>
      <OwnerQuestions ids={['Q-01', 'Q-03']} />
    </details>
    <details className="owner-questions"><summary>Reloj y cierre de demostración</summary>
      <p>Hora de demostración: <output aria-label="Hora de demostración">{new Intl.DateTimeFormat('es-MX', { timeZone: demoGymTimezone, dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(state.demoClock))}</output></p>
      <p className="muted">Q-02 · America/Mexico_City propuesta. Reloj controlado, no hora real.</p>
      <div className="flow"><Button variant="secondary" onClick={() => advance(new Date(Date.parse(state.demoClock) + 30 * 60000).toISOString())}>Avanzar 30 minutos</Button>
        <Button variant="secondary" onClick={() => advance(attendanceClosing(state.demoClock)!)}>Simular cierre 22:00</Button>
        <Button variant="secondary" onClick={() => advance(`${attendanceDay(new Date(Date.parse(state.demoClock) + 86400000).toISOString())}T12:00:00-06:00`)}>Siguiente día demo</Button>
      </div>
      <Notice>El cierre conserva la asistencia sin inventar salida ni duración. Solo se procesa al avanzar el reloj demo; no se ejecuta con la app apagada. Recargar/restablecer reinicia los ejemplos.</Notice>
      <OwnerQuestions ids={['Q-02', 'Q-07', 'Q-08', 'Q-09']} />
    </details>
    <AttendanceCalendar visits={visits} now={state.demoClock} />
  </Panel>;
}
