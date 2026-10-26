import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuthClient, AdminAuthHttpError, AdminAuthReauthenticationRequired } from './adminAuthApi';

const origin = 'https://gym.example';
const expiry = new Date(Date.now() + 15 * 60_000).toISOString();
const session = (token = 'access-one', expiresAt = expiry, status = 201) => new Response(JSON.stringify({ access_token: token, token_type: 'bearer', expires_at: expiresAt }), { status });
const reply = (token = 'access-two', expiresAt = expiry) => new Response(JSON.stringify({ access_token: token, token_type: 'bearer', expires_at: expiresAt }), { status: 200 });

function client(fetchImpl: typeof fetch) {
  return new AdminAuthClient({ apiOrigin: origin, fetchImpl });
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('AdminAuthClient', () => {
  it('keeps 202 login approval pending and accepts only the backend session response', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'approval_required', approval_id: 'f06d8d1a-a651-4a3e-8c0e-800b79384145', poll_token: 'p'.repeat(43) }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(session('access-one', expiry, 200));
    const api = client(fetchImpl);

    const pending = await api.login('admin@example.test', 'password', 'computer');
    expect(pending).toMatchObject({ kind: 'pending', approvalId: 'f06d8d1a-a651-4a3e-8c0e-800b79384145' });
    if (pending.kind !== 'pending') throw new Error('Expected approval to be pending.');
    expect(api.getAccessToken()).toBeNull();
    expect(await api.pollApproval(pending.approvalId, pending.pollToken)).toEqual({ kind: 'pending' });
    expect(api.getAccessToken()).toBeNull();
    expect(await api.pollApproval(pending.approvalId, pending.pollToken)).toMatchObject({ kind: 'authenticated', accessToken: 'access-one', expiresAt: new Date(expiry).getTime() });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `${origin}/api/v1/auth/sessions`,
      `${origin}/api/v1/auth/devices/approval/${pending.approvalId}/poll`,
      `${origin}/api/v1/auth/devices/approval/${pending.approvalId}/poll`,
    ]);
    expect(fetchImpl.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true);
    expect(fetchImpl.mock.calls[0][1]?.body).toBe(JSON.stringify({ login_identifier: 'admin@example.test', password: 'password', category: 'computer' }));
  });

  it('single-flights refresh, credentials requests, retries old-token safe reads once, and never replays writes', async () => {
    let release!: (response: Response) => void;
    const delayedRefresh = new Promise<Response>(resolve => { release = resolve; });
    let staleReads = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/sessions')) return Promise.resolve(session());
      if (url.endsWith('/api/v1/auth/refresh')) return delayedRefresh;
      if (url.endsWith('/admin/change')) return Promise.resolve(new Response('', { status: 401 }));
      const authorization = new Headers(init?.headers).get('Authorization');
      if (authorization === 'Bearer access-one' && staleReads++ < 2) return Promise.resolve(new Response('', { status: 401 }));
      return Promise.resolve(new Response('ok', { status: 200 }));
    });
    const api = client(fetchImpl);
    await api.login('admin', 'secret', 'phone');

    const safeRead = api.fetchAuthenticated('/api/v1/admin/overview');
    const staleRead = api.fetchAuthenticated('/api/v1/admin/overview');
    await vi.waitFor(() => expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/admin/overview'))).toHaveLength(2));
    release(reply());
    expect((await safeRead).status).toBe(200);
    expect((await staleRead).status).toBe(200);
    expect(fetchImpl.mock.calls.filter(([url]) => url === `${origin}/api/v1/auth/refresh`)).toHaveLength(1);

    const body = JSON.stringify({ amount: 100 });
    await expect(api.fetchAuthenticated('/api/v1/admin/change', { method: 'POST', body, headers: { 'Idempotency-Key': 'stable-key' } })).rejects.toBeInstanceOf(AdminAuthReauthenticationRequired);
    const last = fetchImpl.mock.calls.at(-1)?.[1];
    expect(last?.body).toBe(body);
    expect(new Headers(last?.headers).get('Idempotency-Key')).toBe('stable-key');
    expect(new Headers(last?.headers).get('Authorization')).toBe('Bearer access-two');
  });

  it('surfaces safe metadata without server text and distinguishes 401 from 403', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-one', token_type: 'bearer', expires_at: expiry }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'private traceback' }), { status: 403, headers: { 'X-Request-ID': 'req-safe' } }));
    const api = client(fetchImpl);
    await api.login('admin', 'secret', 'computer');
    await expect(api.fetchAuthenticated('/api/v1/admin/overview')).rejects.toMatchObject({ status: 403, requestId: 'req-safe', message: expect.not.stringContaining('private traceback') });
    expect(api.getAccessToken()).toBe('access-one');
    expect(fetchImpl.mock.calls.filter(([url]) => url === `${origin}/api/v1/auth/refresh`)).toHaveLength(0);
  });

  it('rejects malformed contract values and does not access browser storage', async () => {
    const storageMethods = ['getItem', 'setItem', 'removeItem'] as const;
    const storageSpies = storageMethods.map(method => vi.spyOn(Storage.prototype, method));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ access_token: 'secret', token_type: 'bearer', expires_at: 'tomorrow' }), { status: 201 }));
    const api = client(fetchImpl);
    await expect(api.login('admin', 'secret', 'computer')).rejects.toMatchObject({ kind: 'contract' });
    expect(api.getAccessToken()).toBeNull();
    expect(storageSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
  });

  it('does not blindly retry a refresh after the network leaves rotation outcome unknown', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session())
      .mockRejectedValueOnce(new TypeError('socket diagnostics'))
      .mockResolvedValueOnce(session('access-after-reauth'));
    const api = client(fetchImpl);
    await api.login('admin', 'secret', 'computer');
    await expect(api.refresh()).rejects.toMatchObject({ kind: 'network' });
    await expect(api.refresh()).rejects.toBeInstanceOf(AdminAuthReauthenticationRequired);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/auth/refresh'))).toHaveLength(1);
    await expect(api.login('admin', 'secret', 'computer')).resolves.toMatchObject({ accessToken: 'access-after-reauth' });
  });

  it('uses only the existing Admin session list and revocation routes', async () => {
    const sessionId = 'f06d8d1a-a651-4a3e-8c0e-800b79384145';
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [{ id: sessionId, staff_id: 'admin-id', scope_kind: 'organization', auth_method: 'admin_password', issued_at: expiry, expires_at: expiry, revoked: false }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revoked: true }), { status: 200 }));
    const api = client(fetchImpl);
    await api.login('admin', 'secret', 'computer');
    expect(await api.listSessions()).toMatchObject([{ id: sessionId, staffId: 'admin-id', revoked: false }]);
    await api.revokeSession(sessionId);
    expect(fetchImpl.mock.calls.slice(1).map(([url, init]) => [url, init?.method])).toEqual([
      [`${origin}/api/v1/admin/sessions`, 'GET'],
      [`${origin}/api/v1/admin/sessions/${sessionId}/revoke`, 'POST'],
    ]);
  });
});

  it('sends durable logout to the selected category and accepts an empty 204 response', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = client(fetchImpl);
    await api.login('admin', 'secret', 'phone');
    await api.logout();
    expect(fetchImpl.mock.calls.at(-1)).toEqual([
      `${origin}/api/v1/auth/logout`,
      expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify({ category: 'phone' }) }),
    ]);
    expect(api.getAccessToken()).toBeNull();
  });

  it('serializes logout after an in-flight refresh so the final cookie clear wins', async () => {
    let finishRefresh!: (response: Response) => void;
    const delayedRefresh = new Promise<Response>(resolve => { finishRefresh = resolve; });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session())
      .mockReturnValueOnce(delayedRefresh)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = client(fetchImpl);
    await api.login('admin', 'secret', 'computer');

    const refresh = api.refresh();
    await vi.waitFor(() => expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith('/api/v1/auth/refresh'))).toBe(true));
    const logout = api.logout();
    expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith('/api/v1/auth/logout'))).toBe(false);

    finishRefresh(reply('rotated-token'));
    await expect(refresh).rejects.toMatchObject({ kind: 'reauthentication-required' });
    await expect(logout).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls.slice(-2).map(([url]) => String(url).split('/').at(-1))).toEqual(['refresh', 'logout']);
    expect(api.getAccessToken()).toBeNull();
  });

describe('AdminAuthClient public email actions', () => {
  it('approves with the configured origin, validates the token, and omits credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const api = client(fetchImpl);
    await api.approveDevice('a'.repeat(43));
    expect(fetchImpl).toHaveBeenCalledWith(`${origin}/api/v1/auth/devices/approve`, expect.objectContaining({
      method: 'POST', credentials: 'omit', body: JSON.stringify({ token: 'a'.repeat(43) }),
    }));
  });

  it('uses the existing recovery endpoints and only accepts expected statuses', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = client(fetchImpl);
    await api.startRecovery('admin@example.test');
    await api.completeRecovery('b'.repeat(43), 'synthetic-new-password');
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init?.credentials, init?.method, init?.body])).toEqual([
      [`${origin}/api/v1/auth/recovery/start`, 'omit', 'POST', JSON.stringify({ login_identifier: 'admin@example.test' })],
      [`${origin}/api/v1/auth/recovery/complete`, 'omit', 'POST', JSON.stringify({ token: 'b'.repeat(43), new_password: 'synthetic-new-password' })],
    ]);
    expect(fetchImpl.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
  });

  it('rejects malformed tokens without sending requests and does not attach credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const api = client(fetchImpl);
    await expect(api.approveDevice('short')).rejects.toMatchObject({ kind: 'contract' });
    await expect(api.completeRecovery('bad', 'synthetic-new-password')).rejects.toMatchObject({ kind: 'contract' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([400, 429])('keeps public-action HTTP failures generic for status %s', async status => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ detail: 'private token diagnostic' }), { status }));
    const api = client(fetchImpl);
    await expect(api.approveDevice('e'.repeat(43))).rejects.toMatchObject({
      status, message: expect.not.stringContaining('private token diagnostic'),
    });
  });

  it('maps public-action network failures to a generic network error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('private network diagnostic'));
    const api = client(fetchImpl);
    await expect(api.startRecovery('admin')).rejects.toMatchObject({
      kind: 'network', message: expect.not.stringContaining('private network diagnostic'),
    });
  });
});
