import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import {
  issueInitialPin,
  issueReceptionStation,
  listReceptionStations,
  linkAdminStaffAccount,
  listAdminBranches,
  listAdminRosterProfiles,
  listAdminStaffAccounts,
  revokeReceptionStation,
  deactivateStaffAccount,
  type AdminBranchChoice,
  type AdminRosterProfileChoice,
  type AdminStaffAccountChoice,
  type ReceptionStationChoice,
} from '../../api/staffCredentialsApi';
import { AdminStaffDevices } from './AdminStaffDevices';
import {
  AdminAuthClient,
  AdminAuthContractError,
  AdminAuthHttpError,
  AdminAuthNetworkError,
  AdminAuthReauthenticationRequired,
  type AdminSessionCategory,
} from '../../api/adminAuthApi';
import { AdminSessionProvider, useAdminSession } from './AdminSessionProvider';
import { getOwnerStatus, type OwnerStatus } from '../../api/adminRoleManagementApi';
import { OwnerManagementPage } from './OwnerManagementPage';
import { AdminSecurityAlerts } from './AdminSecurityAlerts';
import { AdminDeviceApprovalPage } from './AdminDeviceApprovalPage';
import { AdminRecoveryPage } from './AdminRecoveryPage';

interface AdminAccessAppProps {
  client?: AdminAuthClient;
  apiOrigin?: string;
}

function parseSessionCategory(value: string | null): AdminSessionCategory {
  return value === 'phone' ? 'phone' : 'computer';
}

type AdminEmailAction = { kind: 'none' } | { kind: 'invalid' } | { kind: 'approve' | 'recover'; token: string };

function parseEmailAction(search: string): AdminEmailAction {
  const params = new URLSearchParams(search);
  const approvalToken = params.getAll('approval_token');
  const recoveryToken = params.getAll('token');
  const hasApproval = params.has('approval_token');
  const hasRecovery = params.has('token');
  if (!hasApproval && !hasRecovery) return { kind: 'none' };
  if ((hasApproval && hasRecovery) || approvalToken.length !== (hasApproval ? 1 : 0) ||
      recoveryToken.length !== (hasRecovery ? 1 : 0)) return { kind: 'invalid' };
  const token = hasApproval ? approvalToken[0] : recoveryToken[0];
  if (!/^[A-Za-z0-9_-]{43}$/.test(token ?? '')) return { kind: 'invalid' };
  return { kind: hasApproval ? 'approve' : 'recover', token };
}

function safeErrorMessage(error: Error): string {
  if (error instanceof AdminAuthHttpError || error instanceof AdminAuthNetworkError ||
      error instanceof AdminAuthContractError || error instanceof AdminAuthReauthenticationRequired) return error.message;
  return 'Authentication could not be completed. Please try again.';
}

function AdminAccessContent({ category, onCategoryChange, client }: {
  category: AdminSessionCategory;
  onCategoryChange: (category: AdminSessionCategory) => void;
  client: AdminAuthClient;
}) {
  const { status, approval, expiresAt, error, signIn, pollApproval, logout, request } = useAdminSession();
  const [showRecovery, setShowRecovery] = useState(false);
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [ownerStatus, setOwnerStatus] = useState<OwnerStatus | null>(null);

  useEffect(() => {
    let active = true;
    setOwnerStatus(null);
    if (status === 'authenticated') {
      void getOwnerStatus(request).then(value => { if (active) setOwnerStatus(value); }).catch(() => {
        if (active) setOwnerStatus({ staff_id: '', is_owner: false, can_manage_employees: false });
      });
    }
    return () => { active = false; };
  }, [status, request]);

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !loginIdentifier.trim() || !password) return;
    setSubmitting(true);
    try {
      await signIn(loginIdentifier, password, category);
    } finally {
      setPassword('');
      setSubmitting(false);
    }
  }

  async function checkApproval() {
    if (submitting) return;
    setSubmitting(true);
    try { await pollApproval(); }
    finally { setSubmitting(false); }
  }

  async function signOut() {
    if (submitting) return;
    setSubmitting(true);
    setLogoutFailed(false);
    try { await logout(); }
    catch { setLogoutFailed(true); }
    finally { setSubmitting(false); }
  }

  return <main aria-labelledby="admin-access-title" style={{ maxWidth: 480, margin: '3rem auto', padding: '1.5rem' }}>
    <h1 id="admin-access-title">Admin access</h1>
    {status === 'restoring' && <p role="status">Checking your Admin session…</p>}

    {status === 'authenticated' && <section aria-label="Authenticated Admin session">
      <p role="status">You are signed in to Admin.</p>
      {expiresAt !== null && <p>Session expires: <time dateTime={new Date(expiresAt).toISOString()}>{new Date(expiresAt).toLocaleString()}</time></p>}
      {ownerStatus?.can_manage_employees && <AdminEmployeePinManager status={status} request={request} computerSession={category === 'computer'} />}
      {ownerStatus?.can_manage_employees && <AdminSecurityAlerts status={status} request={request} />}
      {ownerStatus?.is_owner && <OwnerManagementPage request={request} />}
      <button type="button" onClick={() => void signOut()} disabled={submitting}>
        {submitting ? 'Signing out…' : 'Sign out'}
      </button>
    </section>}

    {approval && (status === 'pendingapproval' || status === 'error') && <section aria-label="Device approval">
      <p role="status">Check the email registered to your account for an approval link, then return to this browser and check approval status.</p>
      {status === 'error' && error && <p role="alert">{safeErrorMessage(error)}</p>}
      <button type="button" onClick={() => void checkApproval()} disabled={submitting}>
        {submitting ? 'Checking approval…' : 'Check approval status'}
      </button>
    </section>}

    {logoutFailed && <section aria-label="Logout not confirmed">
      <p role="alert">The server did not confirm sign-out. Local access was cleared, but logout is not confirmed.</p>
      <button type="button" onClick={() => void signOut()} disabled={submitting}>Retry sign out</button>
    </section>}

    {(status === 'unauthenticated' || (status === 'error' && !approval && !logoutFailed)) && (showRecovery
      ? <AdminRecoveryPage client={client} embedded onCancel={() => setShowRecovery(false)} /> : <>
      {error && <p role="alert">{safeErrorMessage(error)}</p>}
      <form onSubmit={event => void submitCredentials(event)}>
        <div>
          <label htmlFor="admin-login-identifier">Username</label>
          <input id="admin-login-identifier" name="username" autoComplete="username" required
            value={loginIdentifier} onChange={event => setLoginIdentifier(event.target.value)} disabled={submitting} />
        </div>
        <div>
          <label htmlFor="admin-login-password">Password</label>
          <input id="admin-login-password" name="password" type="password" autoComplete="current-password" required
            value={password} onChange={event => setPassword(event.target.value)} disabled={submitting} />
        </div>
        <div>
          <label htmlFor="admin-session-category">This device</label>
          <select id="admin-session-category" name="category" value={category}
            onChange={event => onCategoryChange(event.target.value === 'phone' ? 'phone' : 'computer')} disabled={submitting}>
            <option value="computer">Computer</option>
            <option value="phone">Phone</option>
          </select>
        </div>
        <button type="submit" disabled={submitting || !loginIdentifier.trim() || !password}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <button type="button" onClick={() => setShowRecovery(true)}>Forgot password?</button>
    </>)}
  </main>;
}

export function AdminEmployeePinManager({ status, request, computerSession }: {
  status: string;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  computerSession: boolean;
}) {
  const [branches, setBranches] = useState<AdminBranchChoice[]>([]);
  const [profiles, setProfiles] = useState<AdminRosterProfileChoice[]>([]);
  const [accounts, setAccounts] = useState<AdminStaffAccountChoice[]>([]);
  const [stations, setStations] = useState<ReceptionStationChoice[]>([]);
  const [stationSecret, setStationSecret] = useState<string | null>(null);
  const [branchId, setBranchId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [pin, setPin] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef(0);
  const pinRef = useRef<string | null>(null);

  const clearPin = () => { pinRef.current = null; setPin(null); };
  const clearContext = () => {
    operation.current += 1;
    clearPin();
    setBranchId(''); setProfileId(''); setAccountId('');
    setProfiles([]); setAccounts([]); setError(''); setLoading(false); setMutating(false);
    setStations([]); setStationSecret(null);
  };

  useEffect(() => {
    let active = true;
    const current = ++operation.current;
    clearPin();
    if (status !== 'authenticated') {
      setBranches([]); clearContext();
      return () => { active = false; };
    }
    setLoading(true);
    setError('');
    void listAdminBranches(request).then(rows => {
      if (active && operation.current === current) setBranches(rows);
    }).catch(() => {
      if (active && operation.current === current) setError('Branches could not be loaded. Check your Admin session and try again.');
    }).finally(() => {
      if (active && operation.current === current) setLoading(false);
    });
    return () => { active = false; };
  }, [status, request]);

  useEffect(() => () => { operation.current += 1; clearPin(); }, []);

  useEffect(() => {
    if (!computerSession) {
      operation.current += 1;
      clearPin();
      setStations([]); setStationSecret(null);
    }
  }, [computerSession]);

  const selectedProfile = profiles.find(profile => profile.id === profileId) ?? null;
  const selectedAccount = selectedProfile?.staff_user_id
    ? accounts.find(account => account.id === selectedProfile.staff_user_id) ?? null
    : accounts.find(account => account.id === accountId) ?? null;
  const eligibleAccounts = accounts.filter(account => account.is_active &&
    (account.linked_profile_id === null || account.linked_profile_id === profileId));

  async function chooseBranch(nextId: string) {
    operation.current += 1;
    const current = operation.current;
    clearPin(); setBranchId(nextId); setProfileId(''); setAccountId(''); setProfiles([]); setAccounts([]); setError(''); setMutating(false);
    setStations([]); setStationSecret(null);
    if (!nextId) return;
    setLoading(true);
    try {
      const [nextProfiles, nextAccounts, nextStations] = await Promise.all([
        listAdminRosterProfiles(request, nextId), listAdminStaffAccounts(request, nextId),
        computerSession ? listReceptionStations(request, nextId) : Promise.resolve([]),
      ]);
      if (operation.current !== current) return;
      setProfiles(nextProfiles); setAccounts(nextAccounts); setStations(nextStations);
    } catch {
      if (operation.current === current) setError('Employee choices could not be loaded. Check your Admin session and try again.');
    } finally {
      if (operation.current === current) setLoading(false);
    }
  }

  function chooseProfile(nextId: string) {
    operation.current += 1;
    clearPin(); setProfileId(nextId); setAccountId(''); setError(''); setMutating(false);
  }

  async function linkSelectedAccount() {
    if (!selectedProfile || selectedProfile.staff_user_id || !accountId || mutating) return;
    const current = ++operation.current;
    const targetProfile = selectedProfile.id;
    const targetAccount = accountId;
    clearPin(); setError(''); setMutating(true);
    try {
      await linkAdminStaffAccount(request, targetProfile, targetAccount);
      if (operation.current !== current) return;
      const [nextProfiles, nextAccounts] = await Promise.all([
        listAdminRosterProfiles(request, branchId), listAdminStaffAccounts(request, branchId),
      ]);
      if (operation.current !== current) return;
      setProfiles(nextProfiles); setAccounts(nextAccounts);
      setAccountId('');
    } catch {
      if (operation.current === current) setError('The employee account could not be linked. Review the current selection before trying again.');
    } finally {
      if (operation.current === current) setMutating(false);
    }
  }

  async function issuePin() {
    if (!selectedProfile?.staff_user_id || !selectedAccount?.is_active || mutating) return;
    const current = ++operation.current;
    const targetProfile = selectedProfile.id;
    const targetStaff = selectedProfile.staff_user_id;
    clearPin(); setError(''); setMutating(true);
    try {
      const generated = await issueInitialPin(request, targetStaff);
      if (operation.current !== current || status !== 'authenticated' || profileId !== targetProfile ||
          selectedProfile.staff_user_id !== targetStaff) return;
      pinRef.current = generated;
      setPin(generated);
    } catch {
      if (operation.current === current) setError('The initial PIN could not be issued. Check the selected employee and Admin session.');
    } finally {
      if (operation.current === current) setMutating(false);
    }
  }

  async function createStation() {
    if (!branchId || mutating) return;
    const current = ++operation.current;
    setStationSecret(null); setError(''); setMutating(true);
    try {
      const issued = await issueReceptionStation(request, branchId);
      if (operation.current !== current || status !== 'authenticated' || branchId !== issued.branch_id) return;
      setStationSecret(issued.station_credential);
      setStations(rows => [issued, ...rows]);
    } catch {
      if (operation.current === current) setError('The Reception station could not be provisioned. Verify branch and Admin access.');
    } finally {
      if (operation.current === current) setMutating(false);
    }
  }

  async function revokeStation(stationId: string) {
    if (!branchId || mutating) return;
    const current = ++operation.current;
    setStationSecret(null); setError(''); setMutating(true);
    try {
      await revokeReceptionStation(request, branchId, stationId);
      if (operation.current !== current) return;
      setStations(rows => rows.map(row => row.id === stationId ? { ...row, revoked_at: new Date().toISOString() } : row));
    } catch {
      if (operation.current === current) setError('The Reception station could not be revoked. Refresh its status before retrying.');
    } finally {
      if (operation.current === current) setMutating(false);
    }
  }

  async function deactivateSelectedAccount() {
    if (!selectedAccount?.is_active || mutating || !window.confirm(
      'Deactivate this employee across all branches? This disables the login and revokes all their active sessions, paired devices, and pending device-pairing codes. This does not deactivate only the selected profile.'
    )) return;
    const current = ++operation.current;
    const staffId = selectedAccount.id;
    setError(''); setMutating(true); clearPin();
    try {
      await deactivateStaffAccount(request, staffId);
      const nextAccounts = await listAdminStaffAccounts(request, branchId);
      if (operation.current === current) setAccounts(nextAccounts);
    } catch {
      if (operation.current === current) setError('The employee account could not be deactivated. Refresh account state before retrying.');
    } finally {
      if (operation.current === current) setMutating(false);
    }
  }

  return <section aria-label="Employee PIN management">
    <h2>Employee PIN management</h2>
    <p>Choose an active branch and roster profile. Links are explicit; names never select an account automatically.</p>
    <div>
      <label htmlFor="pin-branch">Branch</label>
      <select id="pin-branch" value={branchId} onChange={event => void chooseBranch(event.target.value)} disabled={loading || branches.length === 0}>
        <option value="">Choose a branch</option>
        {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>)}
      </select>
    </div>
    {branchId && <div>
      <label htmlFor="pin-profile">Employee profile</label>
      <select id="pin-profile" value={profileId} onChange={event => chooseProfile(event.target.value)} disabled={loading}>
        <option value="">Choose an employee profile</option>
        {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.full_name} — {profile.position}</option>)}
      </select>
    </div>}
    {selectedProfile && !selectedProfile.staff_user_id && <div>
      <p>This profile has no linked login account. Select an existing active PIN account and explicitly link it.</p>
      <label htmlFor="pin-account">Existing employee account</label>
      <select id="pin-account" value={accountId} onChange={event => setAccountId(event.target.value)} disabled={mutating}>
        <option value="">Choose an account</option>
        {eligibleAccounts.map(account => <option key={account.id} value={account.id}>{account.login_identifier}</option>)}
      </select>
      <button type="button" onClick={() => void linkSelectedAccount()} disabled={!accountId || mutating}>
        {mutating ? 'Linking account…' : 'Link selected account'}
      </button>
    </div>}
    {selectedProfile?.staff_user_id && <div>
      <p>Linked account: {selectedAccount?.login_identifier ?? 'The linked PIN account is unavailable.'}</p>
      {!selectedAccount?.is_active && <p role="status">PIN issuance is unavailable for an inactive account.</p>}
      {selectedAccount?.is_active && <>
        <p>Issuing or resetting this PIN ends the employee’s active sessions. The temporary PIN expires after 7 days, and the employee must change it at first sign-in.</p>
        <button type="button" onClick={() => void issuePin()} disabled={mutating}>
          {mutating ? 'Issuing PIN…' : 'Issue or reset initial PIN'}
        </button>
      </>}
      {selectedAccount?.is_active && <button type="button" onClick={() => void deactivateSelectedAccount()} disabled={mutating}>
        Deactivate employee account across all branches
      </button>}
      <p><a href={`/staff/first-pin-change?branch_id=${encodeURIComponent(branchId)}`}>Employee first PIN change page</a> (branch context only; no credentials are included)</p>
      {selectedAccount && <AdminStaffDevices key={selectedAccount.id} staffId={selectedAccount.id} staffLogin={selectedAccount.login_identifier} request={request} />}
    </div>}
    {branchId && computerSession && <section aria-label="Reception station management">
      <h3>Reception stations</h3>
      <p>Each station credential is shown once. Provisioning requires a computer Admin session; browser/device details do not grant authority.</p>
      <button type="button" onClick={() => void createStation()} disabled={mutating}>Provision 90-day Reception station</button>
      {stationSecret !== null && <section aria-label="One-time Reception station credential">
        <p>Copy this secret securely now. It cannot be displayed again; revoke the station if it is lost.</p>
        <output aria-label="Reception station credential">{stationSecret}</output>
        <button type="button" onClick={() => setStationSecret(null)}>Dismiss credential</button>
      </section>}
      <ul>{stations.map(station => <li key={station.id}>
        Station {station.id}; expires {new Date(station.expires_at).toLocaleString()} — {station.revoked_at ? 'revoked' : 'active'}
        {!station.revoked_at && <button type="button" onClick={() => void revokeStation(station.id)} disabled={mutating}>Revoke station</button>}
      </li>)}</ul>
    </section>}
    {loading && <p role="status">Loading employee choices…</p>}
    {error && <p role="alert">{error}</p>}
    {pin !== null && <section aria-label="One-time PIN">
      <p>Show this temporary PIN to the employee securely. It is shown once, expires after 7 days, and must be changed at first sign-in.</p>
      <output aria-label="Temporary employee PIN">{pin}</output>
      <button type="button" onClick={clearPin}>Dismiss PIN</button>
    </section>}
  </section>;
}

export function AdminAccessApp({ client: injectedClient, apiOrigin }: AdminAccessAppProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [emailAction, setEmailAction] = useState<AdminEmailAction>(() => parseEmailAction(location.search));
  useLayoutEffect(() => {
    const action = parseEmailAction(location.search);
    const params = new URLSearchParams(location.search);
    setEmailAction(action);
    if (params.has('approval_token') || params.has('token')) {
      params.delete('approval_token');
      params.delete('token');
      const query = params.toString();
      window.history.replaceState(window.history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
    }
  }, [location.hash, location.pathname, location.search]);
  const category = parseSessionCategory(searchParams.get('category'));
  const [created] = useState(() => {
    if (injectedClient) return { client: null, configurationError: null };
    try { return { client: new AdminAuthClient({ apiOrigin, category }), configurationError: null }; }
    catch { return { client: null, configurationError: 'Admin sign-in is not configured. Contact your administrator.' }; }
  });
  const client = injectedClient ?? created.client;
  const updateCategory = (nextCategory: AdminSessionCategory) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.set('category', nextCategory);
      return next;
    }, { replace: true });
  };

  if (emailAction.kind === 'invalid') return <main aria-labelledby="admin-email-link-title" style={{ maxWidth: 480, margin: '3rem auto', padding: '1.5rem' }}>
    <h1 id="admin-email-link-title">Admin email link</h1>
    <p role="alert">This link is invalid. Request a new link if needed.</p>
  </main>;
  if (emailAction.kind === 'approve' && client) return <AdminDeviceApprovalPage key={emailAction.token} token={emailAction.token} client={client} />;
  if (emailAction.kind === 'recover' && client) return <AdminRecoveryPage key={emailAction.token} token={emailAction.token} client={client} />;

  if (!client) return <main aria-labelledby="admin-access-title" style={{ maxWidth: 480, margin: '3rem auto', padding: '1.5rem' }}>
    <h1 id="admin-access-title">Admin access</h1>
    <p role="alert">{created.configurationError}</p>
  </main>;

  return <AdminSessionProvider client={client}><AdminAccessContent client={client} category={category} onCategoryChange={updateCategory} /></AdminSessionProvider>;
}
