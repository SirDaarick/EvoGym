import { useEffect, useRef, useState } from 'react';
import {
  acknowledgeAdminSecurityAlert,
  AdminSecurityAlertsApiError,
  listAdminSecurityAlerts,
  type AdminSecurityAlert,
} from '../../api/adminSecurityAlertsApi';

type Request = (path: string, init?: RequestInit) => Promise<Response>;

export function AdminSecurityAlerts({ status, request }: { status: string; request: Request }) {
  const [alerts, setAlerts] = useState<AdminSecurityAlert[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [previous, setPrevious] = useState<Array<string | undefined>>([]);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef(0);

  async function refresh(nextCursorArg: string | undefined = cursor) {
    const current = ++operation.current;
    setLoading(true);
    setError('');
    try {
      const page = await listAdminSecurityAlerts(request, { cursor: nextCursorArg });
      if (operation.current !== current) return;
      setAlerts(page.alerts);
      setNextCursor(page.next_cursor);
      setCursor(nextCursorArg);
    } catch (reason) {
      if (operation.current !== current) return;
      setAlerts([]);
      setNextCursor(null);
      setError(reason instanceof AdminSecurityAlertsApiError && reason.status === 403
        ? 'Lockout alerts are unavailable because your current Admin session does not have employee-management permission.'
        : 'Lockout alerts could not be loaded. Check your Admin session and try again.');
    } finally {
      if (operation.current === current) setLoading(false);
    }
  }

  useEffect(() => {
    operation.current += 1;
    setAlerts([]); setNextCursor(null); setCursor(undefined); setPrevious([]); setError('');
    if (status !== 'authenticated') {
      setLoading(false); setMutating(false);
      return;
    }
    void refresh(undefined);
    return () => { operation.current += 1; };
  }, [status, request]);

  async function acknowledge(alertId: string) {
    if (mutating) return;
    const current = ++operation.current;
    setMutating(true); setError('');
    try {
      await acknowledgeAdminSecurityAlert(request, alertId);
      if (operation.current !== current) return;
      const page = await listAdminSecurityAlerts(request, { cursor });
      if (operation.current !== current) return;
      setAlerts(page.alerts); setNextCursor(page.next_cursor);
    } catch {
      if (operation.current !== current) return;
      setError('The lockout alert was not confirmed as acknowledged. Refresh the current alert state before trying again.');
    } finally {
      if (operation.current === current) setMutating(false);
    }
  }

  function goNext() {
    if (!nextCursor || loading || mutating) return;
    setPrevious(items => [...items, cursor]);
    void refresh(nextCursor);
  }

  function goPrevious() {
    if (!previous.length || loading || mutating) return;
    const next = previous[previous.length - 1];
    setPrevious(items => items.slice(0, -1));
    void refresh(next);
  }

  if (status !== 'authenticated') return null;

  return <section aria-label="Employee lockout alerts">
    <h2>Employee lockout alerts</h2>
    <p>Pending alerts are shared across Admins. Acknowledging one removes it from everyone’s pending list.</p>
    <button type="button" onClick={() => void refresh(undefined)} disabled={loading || mutating}>
      {loading ? 'Refreshing lockout alerts…' : 'Refresh lockout alerts'}
    </button>
    {loading && <p role="status">Loading lockout alerts…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && alerts.length === 0 && <p>No pending lockout alerts.</p>}
    {alerts.length > 0 && <ul>
      {alerts.map(alert => <li key={alert.id}>
        <span>{alert.login_identifier} — locked until <time dateTime={alert.locked_until}>{new Date(alert.locked_until).toLocaleString()}</time></span>
        <button type="button" onClick={() => void acknowledge(alert.id)} disabled={mutating}
          aria-label={`Acknowledge lockout for ${alert.login_identifier}`}>
          {mutating ? 'Acknowledging…' : 'Acknowledge'}
        </button>
      </li>)}
    </ul>}
    <nav aria-label="Lockout alert pages">
      <button type="button" onClick={goPrevious} disabled={!previous.length || loading || mutating}>Previous alerts</button>
      <button type="button" onClick={goNext} disabled={!nextCursor || loading || mutating}>Next alerts</button>
    </nav>
  </section>;
}
