import { useEffect, useRef, useState } from 'react';
import { AdminAuthClient, AdminAuthHttpError } from '../../api/adminAuthApi';

export function AdminDeviceApprovalPage({ token, client }: { token: string; client: AdminAuthClient }) {
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

  async function approve() {
    if (inFlight.current || message) return;
    inFlight.current = true;
    setSubmitting(true);
    setError('');
    const submittedToken = token;
    try {
      await client.approveDevice(submittedToken);
      if (active.current && tokenRef.current === submittedToken) {
        setMessage('Device approved. Return to the original browser and check approval status; this page will not sign you in.');
      }
    } catch (reason) {
      if (active.current && tokenRef.current === submittedToken) {
        setError(reason instanceof AdminAuthHttpError && reason.status === 429
          ? 'Too many attempts. Try again later.'
          : 'This approval link is invalid, expired, or could not be processed. Return to the original browser and check approval status.');
      }
    } finally {
      inFlight.current = false;
      if (active.current && tokenRef.current === submittedToken) setSubmitting(false);
    }
  }

  return <main aria-labelledby="device-approval-title" style={{ maxWidth: 480, margin: '3rem auto', padding: '1.5rem' }}>
    <h1 id="device-approval-title">Approve Admin device</h1>
    <p>Approve the sign-in request for this device. If you did not request it, do not approve.</p>
    {error && <p role="alert">{error}</p>}
    {message ? <p role="status">{message}</p> : <button type="button" onClick={() => void approve()} disabled={submitting}>
      {submitting ? 'Approving…' : 'Approve this device'}
    </button>}
  </main>;
}
