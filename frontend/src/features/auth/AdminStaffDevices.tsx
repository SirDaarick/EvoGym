import { useEffect, useRef, useState } from 'react';
import {
  issueAdminDevicePairingCode,
  listAdminPairedDevices,
  revokeAdminPairedDevice,
  type AdminDevicePairingCode,
  type AdminPairedDevice,
} from '../../api/staffDevicesApi';

type Request = (path: string, init?: RequestInit) => Promise<Response>;

export function AdminStaffDevices({ staffId, staffLogin, request }: {
  staffId: string;
  staffLogin: string;
  request: Request;
}) {
  const [devices, setDevices] = useState<AdminPairedDevice[]>([]);
  const [pairingCode, setPairingCode] = useState<AdminDevicePairingCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef(0);
  const mutatingRef = useRef(false);

  useEffect(() => {
    const current = ++operation.current;
    setPairingCode(null);
    setDevices([]);
    setError('');
    setNotice('');
    setLoading(true);
    void listAdminPairedDevices(request).then(rows => {
      if (operation.current === current) setDevices(rows.filter(row => row.staff_id === staffId));
    }).catch(() => {
      if (operation.current === current) setError('Phone devices could not be loaded. Check your Admin session and try again.');
    }).finally(() => {
      if (operation.current === current) setLoading(false);
    });
    return () => { operation.current += 1; };
  }, [request, staffId]);

  async function refreshDevices() {
    const current = ++operation.current;
    setLoading(true);
    setError('');
    try {
      const rows = await listAdminPairedDevices(request);
      if (operation.current === current) setDevices(rows.filter(row => row.staff_id === staffId));
    } catch {
      if (operation.current === current) setError('Phone devices could not be loaded. Check your Admin session and try again.');
    } finally {
      if (operation.current === current) setLoading(false);
    }
  }

  async function issueCode() {
    if (mutatingRef.current) return;
    mutatingRef.current = true;
    const current = ++operation.current;
    setPairingCode(null);
    setNotice('');
    setError('');
    setMutating(true);
    try {
      const issued = await issueAdminDevicePairingCode(request, staffId);
      if (operation.current !== current) return;
      setPairingCode(issued);
    } catch {
      if (operation.current === current) setError('The pairing code could not be issued. Verify the selected employee and Admin session.');
    } finally {
      mutatingRef.current = false;
      if (operation.current === current) setMutating(false);
    }
  }

  async function revokePhone(device: AdminPairedDevice) {
    if (mutatingRef.current || !window.confirm(
      'Revoke this lost phone? This ends the employee’s active phone sessions. Reception and Admin sessions remain active. A replacement requires a new pairing code.'
    )) return;
    mutatingRef.current = true;
    const current = ++operation.current;
    setPairingCode(null);
    setNotice('');
    setError('');
    setMutating(true);
    try {
      await revokeAdminPairedDevice(request, device.id);
      if (operation.current !== current) return;
      setDevices(rows => rows.map(row => row.id === device.id
        ? { ...row, revoked: true, revoked_at: new Date().toISOString() } : row));
      setNotice('The phone was revoked. Issue a new pairing code for a replacement.');
    } catch {
      if (operation.current === current) setError('The revocation was not confirmed. Refresh the device list before trying again.');
    } finally {
      mutatingRef.current = false;
      if (operation.current === current) setMutating(false);
    }
  }

  return <section aria-label="Employee phone management">
    <h3>Phone management</h3>
    <p>Managing the paired phone for {staffLogin}. Replacing or revoking a phone ends only phone sessions; Reception and Admin sessions are unaffected.</p>
    <button type="button" onClick={() => void issueCode()} disabled={mutating}>
      {mutating ? 'Working…' : 'Issue replacement pairing code'}
    </button>
    <button type="button" onClick={() => void refreshDevices()} disabled={loading || mutating}>Refresh device list</button>
    {pairingCode && <section aria-label="One-time phone pairing code">
      <p>Show this code to the employee once. It expires {new Date(pairingCode.expires_at).toLocaleString()} and cannot be displayed again.</p>
      <output aria-label="One-time phone pairing code">{pairingCode.pairing_code}</output>
      <button type="button" onClick={() => setPairingCode(null)}>Dismiss pairing code</button>
    </section>}
    {loading && <p role="status">Loading phone devices…</p>}
    {!loading && devices.length === 0 && <p>No paired phone is recorded for this employee.</p>}
    <ul>{devices.map(device => <li key={device.id}>
      {device.device_name} — {device.revoked ? 'revoked' : 'active'}
      {!device.revoked && <button type="button" onClick={() => void revokePhone(device)} disabled={mutating}>Revoke lost phone</button>}
    </li>)}</ul>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
