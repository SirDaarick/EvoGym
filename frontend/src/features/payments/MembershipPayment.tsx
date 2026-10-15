import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { PaymentMethod, Role } from '../../domain/models';
import { rolePath } from '../../app/navigation';
import { formatMoney } from '../../demo/adapter';
import { useDemo } from '../../demo/DemoProvider';
import { collectMembership, type PaymentResult } from '../../demo/operations';
import { useActivePlans } from '../../demo/plans';
import { Button, EmptyState, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';
import { NotebookNotice, paymentMethods } from '../members/Members';

export function MembershipPayment({ role }: { role: Role }) {
  const { memberId } = useParams();
  const { state, transact } = useDemo();
  const activePlans = useActivePlans();
  const member = state.members.find(item => item.id === memberId);
  const [planId, setPlanId] = useState('gym-month');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const locked = useRef(false);
  const [requestId] = useState(() => `payment-${crypto.randomUUID()}`);
  const activeMembershipPlans = activePlans.filter(item => item.kind === 'membership');
  const plan = activePlans.find(item => item.id === planId) ?? activeMembershipPlans[0] ?? activePlans[0];
  if (!member) return <Panel><EmptyState title="Socio no disponible">No se puede registrar el pago. <Link to={rolePath(role, 'members')}>Volver a socios</Link></EmptyState></Panel>;

  function confirm() {
    if (locked.current) return;
    locked.current = true;
    setProcessing(true);
    try {
      const outcome = transact(current => collectMembership(current, { id: requestId, memberId: member!.id, planId, method }));
      setResult(outcome);
      if (outcome.status === 'error') locked.current = false;
    } catch {
      setResult({ status: 'error', message: 'Resultado desconocido. Revisa el historial antes de repetir el pago.' });
      // A thrown outcome may have applied; keep this attempt locked rather than imply a safe retry.
    } finally { setProcessing(false); }
  }

  if (result && result.status !== 'error') return <><PageHeader eyebrow="RESULTADO" title={result.status === 'paid' ? 'Pago completo registrado' : 'Transferencia sin confirmar'} description={`${member.name} · ${result.payment.planName}`} />
    <Panel><div role="status" aria-label="Resultado del pago"><Notice tone={result.status === 'paid' ? 'success' : 'warning'}>{result.status === 'paid' ? 'Operación registrada localmente. No activa acceso; las fechas efectivas siguen sin definir.' : 'Registro pendiente, no cobrado. No activa una membresía ni concede acceso; la confirmación de transferencias no está implementada.'}</Notice></div>
      <p className="mt-4">Total: {formatMoney(result.payment.amountMinor)} MXN · {paymentMethods[result.payment.method]}</p><p className="muted">Referencia local: {result.payment.id}</p>
      <Link className="button button-secondary" to={rolePath(role, `members/${member.id}`)}>Ver socio</Link></Panel><NotebookNotice /></>;

  return <><PageHeader eyebrow="MEMBRESÍA · COBRO" title={reviewing ? 'Revisar pago de membresía' : 'Registrar pago de membresía'} description={`Socio: ${member.name}. No se procesa dinero real.`} />
    <div className="bento-grid"><Panel>{reviewing ? <><h2>Antes de confirmar</h2><dl className="grid gap-3"><div><dt>Socio</dt><dd className="font-bold">{member.name}</dd></div><div><dt>Plan y aplicación</dt><dd>{plan?.name ?? 'Plan'} · {plan?.applicability ?? ''}</dd></div><div><dt>Periodo efectivo</dt><dd>Fechas sin definir; no hay activación automática.</dd></div><div><dt>Método</dt><dd>{paymentMethods[method]}</dd></div><div><dt>Total completo MXN</dt><dd className="text-3xl font-bold">{formatMoney(plan?.amountMinor ?? 0)}</dd></div><div><dt>Crédito aplicado</dt><dd>{formatMoney(0)} MXN · saldo a favor sin cambios</dd></div></dl>
        <div className="flow"><Button disabled={processing || locked.current} onClick={confirm}>{processing ? 'Registrando…' : method === 'transfer' ? 'Registrar transferencia pendiente' : 'Registrar pago'}</Button><Button variant="secondary" disabled={processing || locked.current} onClick={() => { setReviewing(false); setResult(null); }}>Volver a captura</Button></div></> : <form onSubmit={event => { event.preventDefault(); setReviewing(true); }}>
        <h2>Selecciona el cobro completo</h2><div className="field"><label htmlFor="payment-plan">Plan</label><select id="payment-plan" value={plan?.id ?? planId} onChange={event => setPlanId(event.target.value)}>{activeMembershipPlans.map(item => <option key={item.id} value={item.id} disabled={Boolean(item.restriction)}>{item.name} · {formatMoney(item.amountMinor)}{item.restriction ? ' · elegibilidad pendiente' : ''}</option>)}</select></div>
        <p className="muted">{plan?.applicability}</p><div className="field"><label htmlFor="payment-method">Método</label><select id="payment-method" value={method} onChange={event => setMethod(event.target.value as PaymentMethod)}><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="transfer">Transferencia sin confirmar</option></select></div>
        <p>Total completo: <strong>{formatMoney(plan?.amountMinor ?? 0)} MXN</strong></p><Button type="submit">Revisar pago</Button></form>}
      {result?.status === 'error' && <div role="alert"><Notice tone="error">{result.message}</Notice></div>}</Panel>
      <Panel><h2>Condiciones que no cambian</h2><p>Saldo a favor: {formatMoney(member.creditMinor)} MXN. No se aplica ni descuenta.</p><Notice tone="warning">Pago completo antes de acceso. No se calcula vencimiento ni un periodo de 30 días. Las fechas mensuales y casos especiales requieren una política acordada.</Notice><Notice>Gracia, uso/devolución de crédito, cancelación y autorización de excepciones no disponibles.</Notice>{method === 'transfer' && <Notice tone="warning">Una transferencia pendiente no es un pago confirmado. No se solicita ni valida comprobante.</Notice>}</Panel></div>
    {!reviewing && <Panel className="mt-6"><h2>Tarifas con elegibilidad pendiente</h2><TableRegion label="Tarifas restringidas"><table><caption>No seleccionables hasta validar la política correspondiente</caption><thead><tr><th scope="col">Tarifa</th><th scope="col">Precio MXN</th><th scope="col">Aplicación y límite</th></tr></thead><tbody>{activePlans.filter(item => item.restriction).map(item => <tr key={item.id}><td>{item.name}</td><td>{formatMoney(item.amountMinor)}</td><td>{item.applicability} {item.restriction}</td></tr>)}</tbody></table></TableRegion></Panel>}
    <NotebookNotice /><div className="flow"><Link to={rolePath(role, `members/${member.id}`)}>Volver al socio</Link></div></>;
}
