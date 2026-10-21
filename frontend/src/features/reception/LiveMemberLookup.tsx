import { useEffect, useRef, useState } from 'react';
import { clearOperationalToken, getReceptionMember, getReceptionConfig, readOperationalToken, searchReceptionMembers, type OperationalMember, type OperationalMemberDetail } from '../../api/receptionApi';
import { OperationalLogin } from '../auth/OperationalLogin';
import { LiveMembershipCheckout } from './LiveMembershipCheckout';

function money(minor: number) { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(minor / 100); }

export function LiveMemberLookup() {
  const [token, setToken] = useState<string | null>(() => readOperationalToken());
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<OperationalMember[]>([]);
  const [selected, setSelected] = useState<OperationalMemberDetail | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const searchGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const previousToken = useRef(token);
  let configError = '';
  try { getReceptionConfig(); } catch (reason) { configError = reason instanceof Error ? reason.message : 'Configuración operativa inválida.'; }

  useEffect(() => {
    if (previousToken.current === token) return;
    previousToken.current = token;
    searchGeneration.current += 1;
    detailGeneration.current += 1;
    setMembers([]); setSelected(null); setCheckoutOpen(false); setError(''); setLoading(false);
  }, [token]);

  useEffect(() => {
    const generation = ++searchGeneration.current;
    if (!token || !query.trim() || configError) { setMembers([]); return; }
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      void searchReceptionMembers(query, token).then(rows => {
        if (generation === searchGeneration.current) setMembers(rows);
      }).catch(reason => {
        if (generation === searchGeneration.current) setError(reason instanceof Error ? reason.message : 'No se pudo buscar.');
      }).finally(() => {
        if (generation === searchGeneration.current) setLoading(false);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      if (generation === searchGeneration.current) searchGeneration.current += 1;
    };
  }, [query, token, configError]);

  async function selectMember(member: OperationalMember) {
    if (!token) return;
    searchGeneration.current += 1;
    const generation = ++detailGeneration.current;
    setSelected(null); setError(''); setLoading(true);
    try {
      const result = await getReceptionMember(member.id, token);
      if (generation === detailGeneration.current) setSelected(result);
    } catch (reason) {
      if (generation === detailGeneration.current) setError(reason instanceof Error ? reason.message : 'No se pudo consultar el saldo.');
    } finally {
      if (generation === detailGeneration.current) setLoading(false);
    }
  }
  async function refresh() { if (selected) await selectMember(selected); }
  function changeQuery(value: string) {
    searchGeneration.current += 1;
    detailGeneration.current += 1;
    setQuery(value); setSelected(null); setCheckoutOpen(false); setMembers([]); setError(''); setLoading(false);
  }
  function logout() {
    searchGeneration.current += 1;
    detailGeneration.current += 1;
    clearOperationalToken(); setToken(null); setSelected(null); setCheckoutOpen(false); setMembers([]); setQuery(''); setError(''); setLoading(false);
  }

  if (configError) return <main className="panel" role="alert" style={{ margin: '2rem', padding: '2rem' }}><h1>Recepción operativa no disponible</h1><p>{configError}</p><p>El modo de demostración sigue separado en su acceso habitual.</p></main>;
  if (!token) return <OperationalLogin onAuthenticated={() => setToken(readOperationalToken())} />;
  return <main className="panel" style={{ maxWidth: 760, margin: '2rem auto', padding: '2rem' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}><div><h1>Recepción operativa</h1><p>Socios y saldos actuales del backend.</p></div><button type="button" onClick={logout} disabled={checkoutOpen}>Cerrar sesión</button></header>
    <label htmlFor="live-member-search">Buscar por número, nombre o teléfono</label>
    <input id="live-member-search" value={query} onChange={event => changeQuery(event.target.value)} disabled={checkoutOpen} />
    {loading && <p role="status">Consultando backend…</p>}
    {error && <p role="alert">{error}</p>}
    <ul aria-label="Resultados de socios">
      {members.map(member => <li key={member.id}><button type="button" onClick={() => void selectMember(member)}>{member.member_number} · {member.preferred_name || member.full_name} · {member.phone}</button></li>)}
    </ul>
    {selected && <section aria-live="polite"><h2>{selected.preferred_name || selected.full_name}</h2><p>Número {selected.member_number} · {selected.phone}</p>
      {selected.has_pending_balance && selected.pending_balance_minor > 0
        ? <div role="alert" style={{ border: '2px solid #b45309', padding: '1rem', fontWeight: 700 }}>Saldo pendiente de pago parcial: {money(selected.pending_balance_minor)}. Aviso informativo; no bloquea el acceso.</div>
        : <p>Sin saldo pendiente de pagos parciales.</p>}
      <button type="button" onClick={() => void refresh()}>Actualizar saldo</button>
      <button type="button" onClick={() => setCheckoutOpen(true)}>Vender o renovar membresía</button>
    </section>}
    {selected && checkoutOpen && <LiveMembershipCheckout
      member={{ id: selected.id, name: selected.preferred_name || selected.full_name }}
      onClose={() => setCheckoutOpen(false)}
      onCompleted={() => void refresh()}
    />}
  </main>;
}
