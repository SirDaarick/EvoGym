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
  const { state } = useDemo();
  const member = state.members.find(item => item.id === memberId);
  if (!member) return <Panel><EmptyState title="Socio no disponible">El registro no existe o la demo fue restablecida. <Link to={rolePath(role, 'members')}>Volver a socios</Link></EmptyState></Panel>;
  const payments = state.payments.filter(payment => payment.memberId === member.id);
  const status = memberStatus(member);
  return <><PageHeader eyebrow="SOCIO · DETALLE" title={member.name} description={`${member.id} · ${member.phone || 'Teléfono no capturado'}`} action={<Link className="button button-primary" to={rolePath(role, `members/${member.id}/payment`)}>Registrar pago de membresía</Link>} />
    <div className="bento-grid"><Panel><h2>Membresía y fechas</h2><Badge tone={status.status === 'inactive' || status.provisional ? 'warning' : 'neutral'}>{status.label}</Badge>
      {member.demoScenario && <Notice>Escenario de demostración: {status.label}. No autoriza acceso real; las fechas de ejemplo no siguen el reloj actual.</Notice>}
      {status.status === 'inactive' && <Notice tone="warning">Renovar antes de registrar una nueva entrada. Sin prórroga en esta demo.</Notice>}
      {status.provisional && <Notice tone="warning">Q-01 provisional: permitir entrada el día de vencimiento. Falta confirmarlo con la dueña.</Notice>}
      {member.membership ? <><p>{member.membership.planName}</p><p>{member.membership.startsOn} a {member.membership.endsOn}</p><Badge>Fechas ilustrativas de demostración</Badge></> : <p>Sin fechas de membresía registradas.</p>}
      <Notice>Un pago completo es requisito para acceso. Las fechas efectivas, renovación mensual y excepciones siguen por definir; esta demo no autoriza acceso.</Notice></Panel>
      <Panel><h2>Saldo a favor</h2><p className="text-3xl font-bold">{formatMoney(member.creditMinor)} MXN</p><p className="muted">Crédito separado del pago; no es deuda ni método. Aplicación, recarga y devolución no disponibles.</p></Panel>
      <Panel className="span-full"><h2>Historial del socio</h2>{payments.length ? <TableRegion label="Pagos del socio"><table><caption>Operaciones locales de demostración</caption><thead><tr><th scope="col">Plan / referencia</th><th scope="col">Total MXN</th><th scope="col">Método</th><th scope="col">Resultado</th></tr></thead><tbody>{payments.map(payment => <tr key={payment.id}><td>{payment.planName}<p className="muted">{payment.id}</p></td><td>{formatMoney(payment.amountMinor)}</td><td>{paymentMethods[payment.method]}</td><td><Badge tone={payment.status === 'paid' ? 'success' : 'warning'}>{payment.status === 'paid' ? 'Pagado · fechas por definir' : 'Transferencia pendiente'}</Badge></td></tr>)}</tbody></table></TableRegion> : <EmptyState title="Sin pagos registrados">Las fechas de muestra no son un historial de cobros.</EmptyState>}</Panel></div><OwnerQuestions ids={['Q-01', 'Q-04', 'Q-05']} /><NotebookNotice /><div className="flow"><Link to={rolePath(role, 'members')}>Volver a socios</Link></div></>;
}
