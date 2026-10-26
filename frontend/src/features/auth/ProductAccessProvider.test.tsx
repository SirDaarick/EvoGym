import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AdminAuthClient } from '../../api/adminAuthApi';
import type { ProfileIdentityChoice } from '../../api/profileAccessApi';
import { ProductAccessProvider, useProductAccess } from './ProductAccessProvider';
import { useAdminSession } from './AdminSessionProvider';
import { StaffProfileSelection } from '../staff/StaffProfileSelection';

const adminId = '123e4567-e89b-42d3-a456-426614174000';
const employeeId = '223e4567-e89b-42d3-a456-426614174000';
const profileId = '323e4567-e89b-42d3-a456-426614174000';
const branchId = '423e4567-e89b-42d3-a456-426614174000';
const response = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' } });
const identities = [{ id: employeeId, kind: 'employee', display_name: 'Ana Perez', is_owner: false, can_manage_employees: false,
  branch_profiles: [{ profile_id: profileId, branch_id: branchId, branch_name: 'Centro' }, { profile_id: profileId.replace('3', '5'), branch_id: branchId.replace('4', '6'), branch_name: 'Norte' }] }];
const adminIdentity: ProfileIdentityChoice = { id: adminId, kind: 'admin', display_name: 'Admin Evo', is_owner: true, can_manage_employees: true, branch_profiles: [] };
const unlinkedIdentity: ProfileIdentityChoice = { id: profileId, kind: 'unlinked', source: 'roster_profile', profile_id: profileId,
  display_name: 'Pending Employee', is_owner: false, can_manage_employees: false,
  branch_profiles: [{ profile_id: profileId, branch_id: branchId, branch_name: 'Centro' }] };

function ExitProbe() {
  const access = useProductAccess();
  const admin = useAdminSession();
  return <>
    {access.error && <p role="alert">{access.error}</p>}
    <output aria-label="Available identities">{access.identities.map(identity => identity.id).join(',')}</output>
    <output aria-label="Admin session status">{admin.status}</output>
    <button type="button" onClick={() => { void admin.signIn('admin@example.test', 'synthetic-only', 'computer'); }}>Sign in Admin</button>
    <button type="button" onClick={() => access.enterAdmin(adminIdentity)}>Enter Admin</button>
    <button type="button" onClick={() => { void access.reload(); }}>Reload choices</button>
    <button type="button" onClick={() => { void access.exit().catch(() => undefined); }}>Exit one</button>
    <button type="button" onClick={() => { void access.exit().catch(() => undefined); }}>Exit two</button>
  </>;
}

describe('live product profile access', () => {
  it('does not expose unlink when pairing succeeds but paired context is unauthorized', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path.endsWith('/profile-access/context')) return response(401);
      if (path.endsWith('/profile-access/pair')) return response(200, { status: 'paired' });
      throw new Error(`Unexpected request: ${path}`);
    });
    function PairProbe() {
      const access = useProductAccess();
      const admin = useAdminSession();
      return <>
        <output aria-label="Unlink capability">{String(access.canUnlinkPairedDevice)}</output>
        <output aria-label="Available identities">{access.identities.map(identity => identity.id).join(',')}</output>
        <output aria-label="Pairing loading">{access.loading ? 'loading' : 'idle'}</output>
        <output aria-label="Admin session status">{admin.status}</output>
        <button type="button" onClick={() => { void access.pair('123456'); }}>Pair device</button>
      </>;
    }
    const client = new AdminAuthClient({ apiOrigin: 'https://api.example.test', fetchImpl });
    render(<MemoryRouter><ProductAccessProvider client={client} apiOrigin="https://api.example.test" fetchImpl={fetchImpl as typeof fetch}><PairProbe /></ProductAccessProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Unlink capability')).toHaveTextContent('false'));
    await waitFor(() => expect(screen.getByLabelText('Admin session status')).toHaveTextContent('unauthenticated'));
    await waitFor(() => expect(screen.getByLabelText('Pairing loading')).toHaveTextContent('idle'));
    fireEvent.click(screen.getByRole('button', { name: 'Pair device' }));
    await waitFor(() => expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/profile-access/pair'))).toBe(true));
    await waitFor(() => expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/profile-access/context'))).toHaveLength(2));
    await waitFor(() => expect(screen.getByLabelText('Pairing loading')).toHaveTextContent('idle'));
    expect(screen.getByLabelText('Unlink capability')).toHaveTextContent('false');
    expect(screen.getByLabelText('Available identities')).toBeEmptyDOMElement();
  });

  it('retains the employee session on an unconfirmed unlink and clears it after 204', async () => {
    let unlinkCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/auth/refresh') return response(401);
      if (url.pathname.endsWith('/profile-access/context')) return response(200, { identities });
      if (url.pathname.endsWith('/profile-access/sessions')) return response(201, {
        access_token: 's'.repeat(43), token_type: 'bearer', expires_at: new Date(Date.now() + 3600000).toISOString(),
        purpose: 'phone', identity: { id: employeeId }, profile: { id: profileId, branch_id: branchId },
      });
      if (url.pathname.endsWith('/profile-access/logout')) return response(++unlinkCalls === 1 ? 503 : 204);
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    let enter!: ReturnType<typeof useProductAccess>['enter'];
    let unlink!: ReturnType<typeof useProductAccess>['unlinkPairedDevice'];
    function UnlinkProbe() {
      const access = useProductAccess();
      const admin = useAdminSession();
      enter = access.enter;
      unlink = access.unlinkPairedDevice;
      return <>
        {access.error && <p role="alert">{access.error}</p>}
        <output aria-label="Current principal">{access.principal?.kind ?? 'none'}</output>
        <output aria-label="Session purpose">{access.principal?.kind === 'employee' ? access.principal.session.purpose : ''}</output>
        <output aria-label="Available identities">{access.identities.map(identity => identity.id).join(',')}</output>
        <output aria-label="Admin status">{admin.status}</output>
        <output aria-label="Access loading">{access.loading ? 'loading' : 'idle'}</output>
      </>;
    }
    const client = new AdminAuthClient({ apiOrigin: 'https://api.example.test', fetchImpl });
    render(<MemoryRouter><ProductAccessProvider client={client} apiOrigin="https://api.example.test" fetchImpl={fetchImpl as typeof fetch}><UnlinkProbe /></ProductAccessProvider></MemoryRouter>);
    await screen.findByLabelText('Available identities');
    await waitFor(() => expect(screen.getByLabelText('Admin status').textContent).toBe('unauthenticated'));
    await waitFor(() => expect(screen.getByLabelText('Access loading').textContent).toBe('idle'));
    let entered!: Awaited<ReturnType<typeof enter>>;
    await act(async () => { entered = await enter(identities[0]! as ProfileIdentityChoice, identities[0]!.branch_profiles[0]!, '123456'); });
    expect(entered).toMatchObject({ purpose: 'phone' });
    await waitFor(() => expect(screen.getByLabelText('Current principal').textContent).toBe('employee'));
    expect(screen.getByLabelText('Session purpose').textContent).toBe('phone');
    await act(async () => { await unlink().catch(() => undefined); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/server did not confirm revocation/i);
    expect(screen.getByLabelText('Current principal').textContent).toBe('employee');
    await act(async () => { await unlink(); });
    await waitFor(() => expect(screen.getByLabelText('Current principal').textContent).toBe('none'));
    expect(screen.getByLabelText('Available identities').textContent).toBe('');
    expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/profile-access/logout'))).toHaveLength(2);
  });

  it('does not issue an employee session for an unlinked roster profile', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path.endsWith('/profile-access/context')) return response(200, { identities });
      throw new Error(`Unexpected request: ${path}`);
    });
    let enter!: ReturnType<typeof useProductAccess>['enter'];
    function Probe() { enter = useProductAccess().enter; return null; }
    const client = new AdminAuthClient({ apiOrigin: 'https://api.example.test', fetchImpl });
    render(<MemoryRouter><ProductAccessProvider client={client} apiOrigin="https://api.example.test" fetchImpl={fetchImpl as typeof fetch}><Probe /></ProductAccessProvider></MemoryRouter>);
    await waitFor(() => expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/profile-access/context'))).toBe(true));
    await expect(enter(unlinkedIdentity, unlinkedIdentity.branch_profiles[0], '123456')).rejects.toThrow();
    expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/profile-access/sessions'))).toBe(false);
  });

  it('renders server-provided identities only and asks for a branch before PIN when needed', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/auth/refresh') return response(401);
      if (url.pathname === '/api/v1/auth/profile-access/context') return response(200, { identities });
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    const client = new AdminAuthClient({ apiOrigin: 'https://api.example.test', fetchImpl });
    render(<MemoryRouter><ProductAccessProvider client={client} apiOrigin="https://api.example.test" fetchImpl={fetchImpl as typeof fetch}><StaffProfileSelection /></ProductAccessProvider></MemoryRouter>);
    expect(await screen.findByRole('button', { name: /Ana Perez/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mikel/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Admin ·/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ana Perez/ }));
    expect(await screen.findByLabelText('Sucursal')).toBeInTheDocument();
    expect(screen.queryByLabelText(/PIN de seis dígitos/)).not.toBeInTheDocument();
  });

  it('revokes a PIN-entry response that arrives after profile exit invalidates the request', async () => {
    let resolveEntry!: (result: Response) => void;
    const entryResult = new Promise<Response>(resolve => { resolveEntry = resolve; });
    let cleanupCount = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path === '/api/v1/auth/profile-access/context') return response(200, { identities });
      if (path === '/api/v1/auth/profile-access/sessions') return entryResult;
      if (path === '/api/v1/auth/profile-access/sessions/logout') return response(++cleanupCount === 1 ? 503 : 204);
      throw new Error(`Unexpected request: ${path}`);
    });
    function RaceProbe() {
      const access = useProductAccess();
      return <>
        {access.error && <p role="alert">{access.error}</p>}
        <button type="button" onClick={() => { void access.enter(identities[0]! as ProfileIdentityChoice, identities[0]!.branch_profiles[0]!, '123456'); }}>Begin PIN entry</button>
        <button type="button" onClick={() => { void access.leaveProfile(); }}>Leave profile</button>
        <button type="button" onClick={() => { void access.leaveProfile(); }}>Retry cleanup</button>
        <output aria-label="Current principal">{access.principal?.identity.id ?? 'none'}</output>
      </>;
    }
    const client = new AdminAuthClient({ apiOrigin: 'https://api.example.test', fetchImpl });
    render(<MemoryRouter><ProductAccessProvider client={client} apiOrigin="https://api.example.test" fetchImpl={fetchImpl as typeof fetch}><RaceProbe /></ProductAccessProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Begin PIN entry' }));
    await waitFor(() => expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/profile-access/sessions'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Leave profile' }));
    await waitFor(() => expect(screen.getByLabelText('Current principal')).toHaveTextContent('none'));
    resolveEntry(response(201, { access_token: 's'.repeat(43), token_type: 'bearer', expires_at: new Date(Date.now() + 1800000).toISOString(),
      identity: { id: employeeId, kind: 'employee' }, profile: { id: profileId, branch_id: branchId }, purpose: 'phone' }));
    await waitFor(() => expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/profile-access/sessions/logout'))).toBe(true));
    const cleanup = fetchImpl.mock.calls.find(call => String(call[0]).endsWith('/profile-access/sessions/logout'));
    expect(cleanup?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${'s'.repeat(43)}` });
    expect(await screen.findByRole('alert')).toHaveTextContent(/late employee session could not be revoked/i);
    fireEvent.click(screen.getByRole('button', { name: 'Retry cleanup' }));
    await waitFor(() => expect(cleanupCount).toBe(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Retry cleanup' }));
    await waitFor(() => expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/profile-access/sessions/logout'))).toHaveLength(2));
    expect(screen.getByLabelText('Current principal')).toHaveTextContent('none');
  });

  it('keeps pairing proof out of JSON and performs no employee entry until a PIN is submitted', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/auth/refresh') return response(401);
      if (url.pathname.endsWith('/profile-access/context')) return response(200, { identities });
      if (url.pathname.endsWith('/profile-access/pair')) return response(200, { status: 'paired' });
      throw new Error(`Unexpected request: ${url.pathname} ${init?.method ?? 'GET'}`);
    });
    const client = new AdminAuthClient({ apiOrigin: 'https://api.example.test', fetchImpl });
    render(<MemoryRouter><ProductAccessProvider client={client} apiOrigin="https://api.example.test" fetchImpl={fetchImpl as typeof fetch}><StaffProfileSelection /></ProductAccessProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular dispositivo con código' }));
    const code = screen.getByLabelText('Código de vinculación de seis dígitos');
    fireEvent.change(code, { target: { value: '123456' } });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/profile-access/pair'), expect.objectContaining({ body: JSON.stringify({ pairing_code: '123456' }) })));
    expect(JSON.stringify(fetchImpl.mock.calls.map(call => call[1]?.body))).not.toMatch(/credential|access_token/i);
    expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/profile-access/sessions'))).toBe(false);
  });

  it('logs out the Admin base session without revoking the paired phone proof', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path === '/api/v1/auth/sessions') return response(201, { access_token: 'x'.repeat(43), token_type: 'bearer', expires_at: new Date(Date.now() + 3600000).toISOString() });
      if (path === '/api/v1/admin/profile-access/choices') return response(200, { current_identity_id: adminId, identities: [adminIdentity] });
      if (path === '/api/v1/auth/profile-access/context') return response(200, { identities: [] });
      if (path === '/api/v1/auth/profile-access/logout') return response(503);
      if (path === '/api/v1/auth/logout') return response(204);
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = new AdminAuthClient({ apiOrigin: 'https://api.example.test', fetchImpl });
    render(<MemoryRouter><ProductAccessProvider client={client} apiOrigin="https://api.example.test" fetchImpl={fetchImpl as typeof fetch}><ExitProbe /></ProductAccessProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in Admin' }));
    await waitFor(() => expect(screen.getByLabelText('Available identities')).toHaveTextContent(adminId));
    fireEvent.click(screen.getByRole('button', { name: 'Enter Admin' }));
    await waitFor(() => expect(screen.getByLabelText('Admin session status')).toHaveTextContent('authenticated'));
    fireEvent.click(screen.getByRole('button', { name: 'Exit one' }));
    await waitFor(() => expect(screen.getByLabelText('Admin session status')).toHaveTextContent('unauthenticated'));
    expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/auth/profile-access/logout'))).toBe(false);
    expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/auth/logout'))).toBe(true);
    expect(screen.getByLabelText('Available identities')).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/admin/profile-access/choices'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in Admin' }));
    await waitFor(() => expect(screen.getByLabelText('Admin session status')).toHaveTextContent('authenticated'));
    await waitFor(() => expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/admin/profile-access/choices'))).toHaveLength(2));
    expect(screen.getByLabelText('Available identities')).toHaveTextContent(adminId);
  });

  it('reports Admin logout failure without invoking paired-device unlink', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path === '/api/v1/auth/sessions') return response(201, { access_token: 'x'.repeat(43), token_type: 'bearer', expires_at: new Date(Date.now() + 3600000).toISOString() });
      if (path === '/api/v1/admin/profile-access/choices') return response(200, { current_identity_id: adminId, identities: [adminIdentity] });
      if (path === '/api/v1/auth/logout') return response(503);
      if (path === '/api/v1/auth/profile-access/context') return response(200, { identities: [] });
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = new AdminAuthClient({ apiOrigin: 'https://api.example.test', fetchImpl });
    render(<MemoryRouter><ProductAccessProvider client={client} apiOrigin="https://api.example.test" fetchImpl={fetchImpl as typeof fetch}><ExitProbe /></ProductAccessProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in Admin' }));
    await waitFor(() => expect(screen.getByLabelText('Available identities')).toHaveTextContent(adminId));
    fireEvent.click(screen.getByRole('button', { name: 'Enter Admin' }));
    await waitFor(() => expect(screen.getByLabelText('Admin session status')).toHaveTextContent('authenticated'));
    fireEvent.click(screen.getByRole('button', { name: 'Exit one' }));
    await waitFor(() => expect(screen.getByLabelText('Admin session status')).toHaveTextContent('error'));
    expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/auth/profile-access/logout'))).toBe(false);
    expect(screen.getByLabelText('Available identities')).toBeEmptyDOMElement();
    expect(screen.getByRole('alert')).toHaveTextContent(/revocation.*confirmed/i);
    expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/admin/profile-access/choices'))).toHaveLength(1);
  });

  it('deduplicates concurrent exit actions while invalidating pending discovery responses', async () => {
    let resolveLogout!: (result: Response) => void;
    const logoutResult = new Promise<Response>(resolve => { resolveLogout = resolve; });
    let resolveChoices!: (result: Response) => void;
    const staleChoices = new Promise<Response>(resolve => { resolveChoices = resolve; });
    let choicesRequestCount = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/refresh') return response(401);
      if (path === '/api/v1/auth/sessions') return response(201, { access_token: 'x'.repeat(43), token_type: 'bearer', expires_at: new Date(Date.now() + 3600000).toISOString() });
      if (path === '/api/v1/admin/profile-access/choices') {
        choicesRequestCount += 1;
        return choicesRequestCount === 2 ? staleChoices : response(200, { current_identity_id: adminId, identities: [adminIdentity] });
      }
      if (path === '/api/v1/auth/profile-access/context') return response(200, { identities: [] });
      if (path === '/api/v1/auth/logout') return logoutResult;
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = new AdminAuthClient({ apiOrigin: 'https://api.example.test', fetchImpl });
    render(<MemoryRouter><ProductAccessProvider client={client} apiOrigin="https://api.example.test" fetchImpl={fetchImpl as typeof fetch}><ExitProbe /></ProductAccessProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in Admin' }));
    await waitFor(() => expect(screen.getByLabelText('Available identities')).toHaveTextContent(adminId));
    fireEvent.click(screen.getByRole('button', { name: 'Enter Admin' }));
    await waitFor(() => expect(screen.getByLabelText('Admin session status')).toHaveTextContent('authenticated'));
    fireEvent.click(screen.getByRole('button', { name: 'Reload choices' }));
    await waitFor(() => expect(choicesRequestCount).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Exit one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exit two' }));
    await waitFor(() => expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/auth/logout'))).toHaveLength(1));
    resolveLogout(response(204));
    await waitFor(() => expect(screen.getByLabelText('Available identities')).toBeEmptyDOMElement());
    resolveChoices(response(200, { current_identity_id: adminId, identities: [adminIdentity] }));
    await waitFor(() => expect(screen.getByLabelText('Available identities')).toBeEmptyDOMElement());
    expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/auth/logout'))).toHaveLength(1);
    expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith('/profile-access/context'))).toHaveLength(1);
  });
});
