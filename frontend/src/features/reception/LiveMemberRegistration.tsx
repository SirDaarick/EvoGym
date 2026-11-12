import { useRef, useState, type FormEvent } from 'react';
import { createMember, createMemberNumber, findMembersByPhone, type CreatedMember, type CreateMemberRequest } from '../../api/membershipCheckoutApi';
import { LiveMembershipCheckout } from './LiveMembershipCheckout';

export function LiveMemberRegistration({ onFindLater, onUnresolvedChange, onSelectMember }: { onFindLater: (memberNumber: string) => void; onUnresolvedChange: (unresolved: boolean) => void; onSelectMember?: (member: CreatedMember) => void }) {
  const [fullName, setFullName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [member, setMember] = useState<CreatedMember | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [intent, setIntent] = useState<CreateMemberRequest | null>(null);
  const [numberConflict, setNumberConflict] = useState(false);
  const [phoneConflict, setPhoneConflict] = useState(false);
  const [matches, setMatches] = useState<CreatedMember[]>([]);
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
      setNumberConflict(false);
      onUnresolvedChange(false);
      setCheckoutOpen(true);
    } catch (reason) {
      if (reason instanceof Error && 'code' in reason && reason.code === 'member_phone_exists') {
        setIntent(null);
        setNumberConflict(false);
        setPhoneConflict(true);
        onUnresolvedChange(false);
        setError('Ya existe un socio con este teléfono. Búscalo para continuar con su ficha en lugar de registrarlo de nuevo.');
      } else if (reason instanceof Error && 'kind' in reason && reason.kind === 'conflict') {
        setIntent(null);
        setNumberConflict(true);
        onUnresolvedChange(false);
        setError('El número generado ya está asociado a otro socio. Podés generar otro número y reintentar con los mismos datos.');
      } else if (reason instanceof Error && 'kind' in reason && reason.kind === 'network') {
        setIntent(request);
        setNumberConflict(false);
        onUnresolvedChange(true);
        setError('No se pudo confirmar el registro. El socio quizá ya fue creado; conservamos los mismos datos y número. Reintentá para reconciliar sin generar otro número.');
      } else {
        setIntent(null);
        setNumberConflict(false);
        onUnresolvedChange(false);
        setError(reason instanceof Error ? reason.message : 'No se pudo registrar el socio.');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current || !fullName.trim() || !phone.trim()) return;
    const request: CreateMemberRequest = {
      member_number: createMemberNumber(),
      full_name: fullName.trim(),
      ...(preferredName.trim() ? { preferred_name: preferredName.trim() } : {}),
      phone: phone.trim(),
      ...(email.trim() ? { email: email.trim() } : {}),
    };
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const found = await findMembersByPhone(request.phone);
      if (found.length) {
        setMatches(found);
        setIntent(request);
      } else {
        submittingRef.current = false;
        setIntent(request);
        await register(request);
      }
    } catch {
      setError('No se pudo verificar el teléfono. Intenta nuevamente.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function retryWithNewNumber() {
    const request: CreateMemberRequest = {
      member_number: createMemberNumber(),
      full_name: fullName.trim(),
      ...(preferredName.trim() ? { preferred_name: preferredName.trim() } : {}),
      phone: phone.trim(),
      ...(email.trim() ? { email: email.trim() } : {}),
    };
    setNumberConflict(false);
    setIntent(request);
    void register(request);
  }

  function changePhone(value: string) {
    setPhone(value);
    setPhoneConflict(false);
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
      <label htmlFor="live-registration-preferred-name">¿Cómo le gusta que le digan? (opcional)</label>
      <input id="live-registration-preferred-name" maxLength={160} value={preferredName} onChange={event => setPreferredName(event.target.value)} disabled={Boolean(intent) || submitting} />
      <label htmlFor="live-registration-phone">Teléfono</label>
      <input id="live-registration-phone" required value={phone} onChange={event => changePhone(event.target.value)} disabled={Boolean(intent) || submitting} />
      <label htmlFor="live-registration-email">Correo electrónico (opcional)</label>
      <input id="live-registration-email" type="email" value={email} onChange={event => setEmail(event.target.value)} disabled={Boolean(intent) || submitting} />
      {error && <p role="alert">{error}</p>}
      {phoneConflict && <button type="button" onClick={() => onFindLater(phone.trim())}>Buscar socio con este teléfono</button>}
      {matches.length > 0 && <section aria-label="Socios con este teléfono">
        <p>Este teléfono ya está registrado. Selecciona un socio o registra otra persona.</p>
        {matches.map(match => <button key={match.id} type="button" onClick={() => onSelectMember ? onSelectMember(match) : onFindLater(match.member_number)}><span>{match.full_name}</span> · {match.member_number}</button>)}
        <button type="button" onClick={() => { setMatches([]); if (intent) void register(intent); }}>Registrar otra persona</button>
        <button type="button" onClick={() => { setMatches([]); setIntent(null); }}>Cancelar</button>
      </section>}
      {intent && matches.length === 0
        ? <button type="button" onClick={() => void register(intent)} disabled={submitting}>Reintentar registro seguro</button>
        : matches.length > 0 ? null : numberConflict
          ? <button type="button" onClick={retryWithNewNumber} disabled={submitting}>Generar otro número y reintentar</button>
          : <button type="submit" disabled={!fullName.trim() || !phone.trim() || submitting}>{submitting ? 'Registrando…' : 'Registrar socio'}</button>}
    </form>}
  </section>;
}
