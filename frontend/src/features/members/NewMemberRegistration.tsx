import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { rolePath } from '../../app/navigation';
import { useDemo } from '../../demo/DemoProvider';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { registerNewMember, type RegistrationResult } from '../../demo/newMemberRegistration';
import { useActivePlans } from '../../demo/plans';
import type { PaymentMethod, Role, VisitArea } from '../../domain/models';
import { CurrentPurchaseCard } from '../reception/CurrentPurchaseCard';
import { AssignedMemberSummary } from '../reception/AssignedMemberSummary';
import AnimatedList, { type AnimatedListEntry } from '../catalog/react-bits/AnimatedList';
import { Button, Field, Notice, PageHeader, Panel } from '../../shared/ui';
import { useIsDarkMode } from '../../shared/theme';
import { MobileDetailPanel } from '../../shared/MobileDetailPanel';
import JellyRadio from '../catalog/react-bits/JellyRadio';
import { CashTenderCalculator } from '../payments/CashTenderCalculator';
import './NewMemberRegistration.css';

export function NewMemberRegistration({ role }: { role: Role }) {
  const { transact } = useDemo();
  const isDark = useIsDarkMode();
  const activePlans = useActivePlans();
  const [kind, setKind] = useState<'membership' | 'trial' | 'visit'>('membership');
  const [planId, setPlanId] = useState('gym-month');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [area, setArea] = useState<VisitArea>('GYM');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [tendered, setTendered] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const locked = useRef(false);
  const choices = activePlans.filter(plan => kind === 'visit' ? plan.kind === 'visit'
    : kind === 'trial' ? plan.id === 'trial-class' : plan.kind === 'membership' && plan.id !== 'trial-class');
  const selectedPlanId = kind === 'trial' ? 'trial-class' : planId;
  const plan = activePlans.find(item => item.id === selectedPlanId) ?? choices[0];
  const totalMinor = plan?.amountMinor ?? 0;
  const tenderedMinor = tendered ? parseMoney(tendered) : 0;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    if (method === 'cash' && (tenderedMinor === null || tenderedMinor < totalMinor)) {
      setError(tenderedMinor === null ? 'Ingresa un monto válido con hasta dos decimales.' : `El efectivo recibido debe cubrir el total de ${formatMoney(totalMinor)} MXN.`);
      return;
    }
    locked.current = true;
    const outcome = transact(state => registerNewMember(state, {
      id: `registration-${crypto.randomUUID()}`, kind: kind === 'visit' ? 'visit' : 'membership', planId: selectedPlanId,
      method, name, phone, email, ...(kind === 'visit' ? { area } : {}),
    }));
    setError(outcome.status === 'error' ? outcome.message : '');
    if (outcome.status === 'error') locked.current = false;
    setResult(outcome);
  }

  if (result && result.status !== 'error') return <>
    <PageHeader eyebrow="ALTA DE SOCIO" title={result.status === 'pending' ? 'Transferencia sin confirmar' : 'Registro guardado'} description="Registro local; no se procesa dinero real." />
    <Panel><div role="status" aria-label="Resultado del registro"><Notice tone={result.status === 'pending' ? 'warning' : 'success'}>
      {result.status === 'pending' ? 'La transferencia sigue pendiente y no se considera cobrada hasta verificar el comprobante.' : 'Confirmación local registrada. Esto no procesa un pago real ni activa acceso o membresía automáticamente.'}
    </Notice></div><p className="mt-4">Total: {formatMoney(result.amountMinor)} MXN</p>
      {result.memberId && <p>Socio: {name.trim()}</p>}
      <p className="muted">Referencia local: {result.paymentId ?? result.sale?.id}</p>
      <div className="flow"><Button onClick={() => { locked.current = false; setResult(null); setName(''); setPhone(''); setEmail(''); setTendered(''); }}>Registrar otra operación</Button><Link to={rolePath(role, 'members')}>Volver a socios</Link></div>
    </Panel></>;

  const listItems: AnimatedListEntry[] = choices.map(choice => ({ id: choice.id, title: choice.name, description: choice.kind === 'visit' ? 'Acceso por visita' : 'Plan de registro', meta: `${formatMoney(choice.amountMinor)} MXN` }));
  const selectedIndex = Math.max(0, choices.findIndex(choice => choice.id === selectedPlanId));
  return <><PageHeader eyebrow="SOCIOS · ALTA" title="Nuevo socio" description="Registra membresías, clase muestra o visitas. El registro no concede acceso automáticamente." />
      <div className="registration-checkout">
      <form className="new-registration-form" noValidate onSubmit={submit}>
        <section className="registration-main" aria-label="Detalles del registro">
          <Panel className="registration-details-card">
          <div className="registration-section">
            <span className="registration-kicker">01 · Operación</span><h2>¿Qué vas a registrar?</h2>
            <JellyRadio className="registration-type-jelly" items={[{ value: 'membership', label: 'Membresía' }, { value: 'trial', label: 'Clase muestra' }, { value: 'visit', label: 'Visita' }]}
              value={kind} onChange={value => { setKind(value as typeof kind); setPlanId(value === 'visit' ? 'visit-single' : 'gym-month'); setResult(null); }}
              ariaLabel="Tipo de operación" />
          </div>
          <div className="registration-section registration-plan-section">
            <span className="registration-kicker">02 · Selección</span><h2 id="registration-plans-label">{kind === 'visit' ? 'Tarifas de visita' : 'Planes disponibles'}</h2>
            <AnimatedList listboxId="registration-plan-list" items={listItems} selectedIndex={selectedIndex} onItemSelect={(_item, index) => setPlanId(choices[index].id)} theme={isDark ? 'dark' : 'light'} animation="slide" selectOnHover={false} maxHeight={290} className="registration-plan-list" />
            <span className="sr-only" id="registration-plan-list-label">Planes disponibles</span>
          </div>
          {kind === 'visit' ? <label className="registration-field" htmlFor="registration-area">Área<select id="registration-area" value={area} onChange={event => setArea(event.target.value as VisitArea)}>
            <option value="GYM">Gym</option><option value="BOX">Box</option>{selectedPlanId === 'visit-combo' && <option value="COMBO">Gym + Box</option>}
          </select></label> : <div className="registration-fields">
            <Field id="registration-name" label="Nombre" required value={name} onChange={event => setName(event.target.value)} error={error || undefined} />
            <Field id="registration-phone" label="Teléfono (opcional)" type="tel" value={phone} onChange={event => setPhone(event.target.value)} />
            <Field id="registration-email" label="Correo electrónico (opcional)" type="email" value={email} onChange={event => setEmail(event.target.value)} />
          </div>}
          </Panel>
        </section>
        <MobileDetailPanel title="Resumen del registro" triggerLabel="Ver resumen del registro" className="registration-current-purchase-slot">
        <CurrentPurchaseCard
          className="registration-current-purchase current-purchase-card--registration"
          totalMinor={totalMinor}
          paymentMethod={method}
          onPaymentMethodChange={setMethod}
          memberAssignment={kind !== 'visit' ? <div className="cart-member-section"><AssignedMemberSummary name={name.trim() || 'Nombre pendiente'} phone={phone.trim() || undefined} label="Asignación de borrador" /></div> : undefined}
        >
          <div className="cart-items-section registration-purchase-line">
            <ul className="cart-lines"><li className="cart-line-row">
              <div className="cart-line-details"><span>{plan?.name ?? 'Plan'}</span><span className="cart-line-unit muted">{kind === 'visit' ? 'Acceso por visita' : 'Registro de membresía'}</span></div>
              <strong>{formatMoney(totalMinor)}</strong>
            </li></ul>
          </div>
          {method === 'cash' && <CashTenderCalculator totalMinor={totalMinor} value={tendered} onChange={setTendered} inputId="registration-tendered" />}
          {error && <Notice tone="error">{error}</Notice>}
          <Notice tone="warning">Registro local únicamente: confirma la operación según la libreta y el proceso de caja. No representa un cobro real ni activa acceso.</Notice>
          <div className="registration-actions"><Button type="submit">Registrar operación</Button><Link to={rolePath(role, 'members')}>Volver a socios</Link></div>
        </CurrentPurchaseCard>
        </MobileDetailPanel>
      </form>
      </div>
    </>;
}
