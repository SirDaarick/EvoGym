import { useEffect, useRef, useState } from 'react';
import { AdminAuthClient, AdminAuthHttpError } from '../../api/adminAuthApi';

export function AdminRecoveryPage({ client, token, onCancel, embedded = false }: {
  client: AdminAuthClient;
  token?: string;
  onCancel?: () => void;
  embedded?: boolean;
}) {
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const active = useRef(true);
  const inFlight = useRef(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function start() {
    if (inFlight.current || message) return;
    inFlight.current = true;
    setSubmitting(true);
    setError('');
    try {
      await client.startRecovery(loginIdentifier);
      if (active.current) setMessage('If the account is eligible, recovery instructions have been sent to its verified email address.');
    } catch (reason) {
      if (active.current) setError(reason instanceof AdminAuthHttpError && reason.status === 429
        ? 'Too many attempts. Try again later.'
        : 'Recovery could not be completed. Try again later.');
    } finally {
      inFlight.current = false;
      if (active.current) setSubmitting(false);
    }
  }

  async function complete() {
    if (inFlight.current || message) return;
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }
    if (!token) return;
    inFlight.current = true;
    setSubmitting(true);
    setError('');
    const submittedToken = token;
    const submittedPassword = password;
    try {
      await client.completeRecovery(submittedToken, submittedPassword);
      if (active.current && tokenRef.current === submittedToken) {
        setPassword('');
        setConfirmation('');
        setMessage('Password changed. All Admin sessions have been revoked. Sign in again.');
      }
    } catch (reason) {
      if (active.current && tokenRef.current === submittedToken) {
        setError(reason instanceof AdminAuthHttpError && reason.status === 429
          ? 'Too many attempts. Try again later.'
          : 'This recovery link is invalid, expired, or could not be processed. Request a new link if needed.');
      }
    } finally {
      inFlight.current = false;
      if (active.current && tokenRef.current === submittedToken) setSubmitting(false);
    }
  }

  const Container = embedded ? 'section' : 'main';
  return <Container aria-labelledby="admin-recovery-title" style={{ maxWidth: 480, margin: '3rem auto', padding: '1.5rem' }}>
    <h1 id="admin-recovery-title">Recover Admin access</h1>
    {message && <p role="status">{message}</p>}
    {token ? <>
      <p>Choose a new password. Completing recovery signs out all Admin sessions.</p>
      <label>New password<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={submitting} /></label>
      <label>Confirm new password<input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={submitting} /></label>
      {!message && <button type="button" onClick={() => void complete()} disabled={submitting || !password || !confirmation}>
        {submitting ? 'Changing password…' : 'Change password'}
      </button>}
    </> : <>
      <p>Enter your Admin email or username. If the account is eligible, recovery instructions will be sent to its verified email address.</p>
      <label>Admin email or username<input autoComplete="username" value={loginIdentifier} onChange={event => setLoginIdentifier(event.target.value)} disabled={submitting} /></label>
      {!message && <button type="button" onClick={() => void start()} disabled={submitting || !loginIdentifier.trim()}>
        {submitting ? 'Sending…' : 'Send recovery instructions'}
      </button>}
      {onCancel && <button type="button" onClick={onCancel}>Back to sign in</button>}
    </>}
    {error && <p role="alert">{error}</p>}
  </Container>;
}
