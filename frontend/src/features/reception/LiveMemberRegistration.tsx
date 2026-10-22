import { useRef, useState, type FormEvent } from 'react';
import { createMember, createMemberNumber, type CreatedMember, type CreateMemberRequest } from '../../api/membershipCheckoutApi';
import { LiveMembershipCheckout } from './LiveMembershipCheckout';

export function LiveMemberRegistration({ onFindLater, onUnresolvedChange }: { onFindLater: (memberNumber: string) => void; onUnresolvedChange: (unresolved: boolean) => void }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [member, setMember] = useState<CreatedMember | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [intent, setIntent] = useState<CreateMemberRequest | null>(null);
  const submittingRef = useRef(false);

  async function register(request: CreateMemberRequest) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const created = await createMember(request);
      setMember(created);
      setIntent(null);
      onUnresolvedChange(false);
      setCheckoutOpen(true);
    } catch (reason) {
      if (reason instanceof Error && 'kind' in reason && reason.kind === 'network') {
        setIntent(request);
        onUnresolvedChange(true);
        setError('No se pudo confirmar el registro. El socio quizá ya fue creado; conservamos los mismos datos y número. Reintentá para reconciliar sin generar otro número.');
      } else {
        setIntent(null);
        onUnresolvedChange(false);
        setError(reason instanceof Error ? reason.message : 'No se pudo registrar el socio.');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current || !fullName.trim() || !phone.trim()) return;
    const request: CreateMemberRequest = {
      member_number: createMemberNumber(),
      full_name: fullName.trim(),
      phone: phone.trim(),
      ...(email.trim() ? { email: email.trim() } : {}),
    };
    setIntent(request);
    void register(request);
  }

  return <section aria-labelledby="live-registration-title" style={{ marginTop: '1.5rem', borderTop: '1px solid #cbd5e1', paddingTop: '1rem' }}>
    <h2 id="live-registration-title">Registrar socio nuevo</h2>
    {member ? <>
      <p role="status">Socio registrado: {member.member_number}. El perfil ya está registrado y no se revierte si la venta no se completa.</p>
      <p>Identificador backend: {member.id}</p>
      {!checkoutOpen && <button type="button" onClick={() => setCheckoutOpen(true)}>Continuar a venta de membresía</button>}
      <button type="button" onClick={() => onFindLater(member.member_number)}>Buscar socio para continuar después</button>
      {checkoutOpen && <LiveMembershipCheckout member={{ id: member.id, name: member.full_name }} onClose={() => setCheckoutOpen(false)} />}
    </> : <form onSubmit={submit}>
      <label htmlFor="live-registration-name">Nombre completo</label>
      <input id="live-registration-name" required value={fullName} onChange={event => setFullName(event.target.value)} disabled={Boolean(intent) || submitting} />
      <label htmlFor="live-registration-phone">Teléfono</label>
      <input id="live-registration-phone" required value={phone} onChange={event => setPhone(event.target.value)} disabled={Boolean(intent) || submitting} />
      <label htmlFor="live-registration-email">Correo electrónico (opcional)</label>
      <input id="live-registration-email" type="email" value={email} onChange={event => setEmail(event.target.value)} disabled={Boolean(intent) || submitting} />
      {error && <p role="alert">{error}</p>}
      {intent
        ? <button type="button" onClick={() => void register(intent)} disabled={submitting}>Reintentar registro seguro</button>
        : <button type="submit" disabled={!fullName.trim() || !phone.trim() || submitting}>{submitting ? 'Registrando…' : 'Registrar socio'}</button>}
    </form>}
  </section>;
}
