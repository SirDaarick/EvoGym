import { StrictMode, useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminAuthClient } from '../../api/adminAuthApi';
import { AdminSessionProvider, useAdminSession } from './AdminSessionProvider';

const expiry = new Date(Date.now() + 15 * 60_000).toISOString();
function session(token = 'access-one', status = 201) { return new Response(JSON.stringify({ access_token: token, token_type: 'bearer', expires_at: expiry }), { status }); }

function Consumer() {
  const auth = useAdminSession();
  useEffect(() => { window.testAuthActions = { signIn: auth.signIn, logout: auth.logout, request: auth.request }; }, [auth.signIn, auth.logout, auth.request]);
  return <output data-testid="auth-state" data-expires={auth.expiresAt ?? ''}>{auth.status}{auth.approval ? `:${auth.approval.approvalId}` : ''}{auth.error ? `:${auth.error.message}` : ''}</output>;
}

declare global { interface Window { testAuthActions?: { signIn: (identifier: string, password: string) => Promise<void>; logout: () => Promise<void>; request: (path: string, init?: RequestInit) => Promise<Response> } } }

afterEach(() => { delete window.testAuthActions; vi.useRealTimers(); vi.restoreAllMocks(); });

describe('AdminSessionProvider', () => {
  it('restores from the HttpOnly cookie once under StrictMode and exposes only backend session state', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(session('access-one', 200));
    const client = new AdminAuthClient({ apiOrigin: 'https://gym.example', fetchImpl });
    render(<StrictMode><AdminSessionProvider client={client}><Consumer /></AdminSessionProvider></StrictMode>);
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://gym.example/api/v1/auth/refresh', expect.objectContaining({ credentials: 'include', body: JSON.stringify({ category: 'computer' }) }));
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it('keeps login pending until approval and prevents a late login response from undoing logout', async () => {
    let finishLogin!: (response: Response) => void;
    const waitForLogin = new Promise<Response>(resolve => { finishLogin = resolve; });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 401 })).mockImplementationOnce(() => waitForLogin).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new AdminAuthClient({ apiOrigin: 'https://gym.example', fetchImpl });
    render(<AdminSessionProvider client={client}><Consumer /></AdminSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('unauthenticated'));

    let signIn!: Promise<void>;
    await act(async () => { signIn = window.testAuthActions!.signIn('admin', 'secret'); await Promise.resolve(); window.testAuthActions!.logout(); });
    finishLogin(session('late-token'));
    await act(async () => { await signIn; });
    expect(screen.getByTestId('auth-state')).toHaveTextContent('unauthenticated');
    expect(client.getAccessToken()).toBeNull();
  });

  it('represents a real approval-required login as pendingapproval, not authenticated', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'approval_required', approval_id: 'f06d8d1a-a651-4a3e-8c0e-800b79384145', poll_token: 'p'.repeat(43) }), { status: 202 }));
    const client = new AdminAuthClient({ apiOrigin: 'https://gym.example', fetchImpl });
    render(<AdminSessionProvider client={client}><Consumer /></AdminSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('unauthenticated'));
    await act(async () => { await window.testAuthActions!.signIn('admin', 'secret'); });
    expect(screen.getByTestId('auth-state')).toHaveTextContent('pendingapproval:f06d8d1a-a651-4a3e-8c0e-800b79384145');
    expect(client.getAccessToken()).toBeNull();
  });

  it('renews before server expiry and clears the session when renewal is rejected', async () => {
    vi.useFakeTimers({ now: new Date() });
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-one', token_type: 'bearer', expires_at: expiresAt }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    const client = new AdminAuthClient({ apiOrigin: 'https://gym.example', fetchImpl });
    render(<AdminSessionProvider client={client}><Consumer /></AdminSessionProvider>);
    await act(async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); });
    expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated');
    expect(client.getAccessToken()).toBe('access-one');

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('auth-state')).toHaveTextContent('unauthenticated');
    expect(client.getAccessToken()).toBeNull();
  });

  it('clears a restore that finishes after the provider unmounts', async () => {
    let finishRestore!: (response: Response) => void;
    const waitForRestore = new Promise<Response>(resolve => { finishRestore = resolve; });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(() => waitForRestore);
    const client = new AdminAuthClient({ apiOrigin: 'https://gym.example', fetchImpl });
    const view = render(<AdminSessionProvider client={client}><Consumer /></AdminSessionProvider>);
    await act(async () => { await Promise.resolve(); });
    view.unmount();
    finishRestore(new Response(JSON.stringify({ access_token: 'late-token', token_type: 'bearer', expires_at: expiry }), { status: 200 }));
    await act(async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); });
    expect(client.getAccessToken()).toBeNull();
  });

  it('moves out of authenticated state when a safe request cannot refresh its expired session', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session('restored-token', 200))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    const client = new AdminAuthClient({ apiOrigin: 'https://gym.example', fetchImpl });
    render(<AdminSessionProvider client={client}><Consumer /></AdminSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated'));

    await act(async () => { await expect(window.testAuthActions!.request('/api/v1/admin/overview')).rejects.toMatchObject({ kind: 'reauthentication-required' }); });
    expect(screen.getByTestId('auth-state')).toHaveTextContent('unauthenticated');
    expect(screen.getByTestId('auth-state')).toHaveAttribute('data-expires', '');
    expect(client.getAccessToken()).toBeNull();
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/auth/refresh'))).toHaveLength(2);
  });

  it('does not let an old request failure clear a newer login', async () => {
    let finishWrite!: (response: Response) => void;
    const pendingWrite = new Promise<Response>(resolve => { finishWrite = resolve; });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session('old-token', 200))
      .mockReturnValueOnce(pendingWrite)
      .mockResolvedValueOnce(session('new-token'));
    const client = new AdminAuthClient({ apiOrigin: 'https://gym.example', fetchImpl });
    render(<AdminSessionProvider client={client}><Consumer /></AdminSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated'));

    let oldRequest!: Promise<Response>;
    await act(async () => { oldRequest = window.testAuthActions!.request('/api/v1/admin/change', { method: 'POST', body: '{}' }); await Promise.resolve(); });
    await act(async () => { await window.testAuthActions!.signIn('admin', 'new-secret'); });
    expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated');
    expect(client.getAccessToken()).toBe('new-token');

    finishWrite(new Response('', { status: 401 }));
    await act(async () => { await expect(oldRequest).rejects.toMatchObject({ kind: 'reauthentication-required' }); });
    expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated');
    expect(client.getAccessToken()).toBe('new-token');
  });
});

  it('surfaces a failed durable logout and never claims unauthenticated success', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session('access-one', 200))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'private server text' }), { status: 503 }));
    const client = new AdminAuthClient({ apiOrigin: 'https://gym.example', fetchImpl });
    render(<AdminSessionProvider client={client}><Consumer /></AdminSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated'));

    await act(async () => { await expect(window.testAuthActions!.logout()).rejects.toMatchObject({ status: 503 }); });
    expect(screen.getByTestId('auth-state')).toHaveTextContent('error');
    expect(screen.getByTestId('auth-state')).toHaveTextContent('server could not complete');
    expect(client.getAccessToken()).toBeNull();
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/auth/logout'))).toHaveLength(1);
  });

  it('rejects a failed logout even when a newer sign-in supersedes its UI generation', async () => {
    let finishLogout!: (response: Response) => void;
    const pendingLogout = new Promise<Response>(resolve => { finishLogout = resolve; });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session('old-token', 200))
      .mockReturnValueOnce(pendingLogout)
      .mockResolvedValueOnce(session('new-token'));
    const client = new AdminAuthClient({ apiOrigin: 'https://gym.example', fetchImpl });
    render(<AdminSessionProvider client={client}><Consumer /></AdminSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated'));

    let logout!: Promise<void>;
    await act(async () => { logout = window.testAuthActions!.logout(); await Promise.resolve(); });
    await waitFor(() => expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith('/api/v1/auth/logout'))).toBe(true));
    const logoutOutcome = logout.then(() => ({ fulfilled: true as const }), error => ({ fulfilled: false as const, error }));
    let signIn!: Promise<void>;
    await act(async () => { signIn = window.testAuthActions!.signIn('admin', 'new-secret'); await Promise.resolve(); });

    finishLogout(new Response(JSON.stringify({ detail: 'private server text' }), { status: 503 }));
    await act(async () => { await signIn; });
    const outcome = await logoutOutcome;

    expect(outcome.fulfilled).toBe(false);
    if (!outcome.fulfilled) expect(outcome.error).toMatchObject({ status: 503 });
    expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated');
    expect(client.getAccessToken()).toBe('new-token');
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/auth/logout'))).toHaveLength(1);
  });
