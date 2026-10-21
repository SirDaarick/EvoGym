import { useState, type FormEvent } from 'react';
import { signInReception } from '../../api/receptionApi';

export function OperationalLogin({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [login, setLogin] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try { await signInReception(login, pin); onAuthenticated(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo iniciar sesión.'); }
    finally { setBusy(false); }
  }
  return <main className="panel" style={{ maxWidth: 520, margin: '3rem auto', padding: '2rem' }}>
    <h1>Recepción operativa</h1>
    <p>Acceso al backend en vivo. Esta pantalla no utiliza datos de demostración.</p>
    <form onSubmit={submit}>
      <label htmlFor="operational-login">Usuario</label>
      <input id="operational-login" autoComplete="username" value={login} onChange={event => setLogin(event.target.value)} required />
      <label htmlFor="operational-pin">PIN</label>
      <input id="operational-pin" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={event => setPin(event.target.value)} required />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
    </form>
  </main>;
}
