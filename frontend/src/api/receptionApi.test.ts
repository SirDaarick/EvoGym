import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOperationalToken, getReceptionConfig, getReceptionMember, readOperationalToken, searchReceptionMembers, signInReception, OperationalApiHttpError, OperationalApiNetworkError } from './receptionApi';

const branchId = '00000000-0000-4000-8000-000000000001';
beforeEach(() => { sessionStorage.clear(); vi.unstubAllEnvs(); vi.stubEnv('VITE_API_BASE_URL', 'https://gym.example'); vi.stubEnv('VITE_BRANCH_ID', branchId); vi.restoreAllMocks(); });

describe('reception API', () => {
  it('fails closed for missing or invalid branch configuration', () => {
    expect(() => getReceptionConfig({ VITE_API_BASE_URL: 'https://gym.example', VITE_BRANCH_ID: '' })).toThrow();
    expect(() => getReceptionConfig({ VITE_API_BASE_URL: 'file:///tmp', VITE_BRANCH_ID: branchId })).toThrow();
    expect(() => getReceptionConfig({ VITE_API_BASE_URL: 'https://gym.example/api', VITE_BRANCH_ID: branchId })).toThrow();
  });

  it('authenticates staff against configured branch and stores only bearer token in session storage', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ access_token: 'opaque-secret', token_type: 'bearer' }), { status: 201 }));
    await signInReception(' desk ', '1234');
    expect(fetchMock).toHaveBeenCalledWith('https://gym.example/api/v1/auth/staff/sessions', expect.objectContaining({ method: 'POST', body: JSON.stringify({ login_identifier: 'desk', pin: '1234', branch_id: branchId }) }));
    expect(readOperationalToken()).toBe('opaque-secret');
    expect(localStorage.getItem('evogym:operational-session')).toBeNull();
    clearOperationalToken();
    expect(readOperationalToken()).toBeNull();
  });

  it('uses real member IDs and bearer authentication for search and fresh detail balance', async () => {
    const uuid = 'dcfa4c8c-40dd-41a6-830e-9d89a1e4a350';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: uuid, member_number: 'M-1' }] }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ id: uuid, pending_balance_minor: 4500, has_pending_balance: true }), { status: 200 }));
    const rows = await searchReceptionMembers('M-1', 'opaque');
    const member = await getReceptionMember(rows[0].id, 'opaque');
    expect(member.pending_balance_minor).toBe(4500);
    expect(member.has_pending_balance).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('search=M-1');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer opaque' });
    expect(fetchMock.mock.calls[1][0]).toBe(`https://gym.example/api/v1/members/${uuid}`);
  });

  it('does not persist a token when the server rejects authentication', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    await expect(signInReception('desk', 'wrong')).rejects.toThrow(/Credenciales inválidas/);
    expect(readOperationalToken()).toBeNull();
  });

  it('exposes safe typed HTTP metadata and request IDs for reception failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'SESSION_REVOKED', message: 'secret backend traceback', request_id: 'req-body' } }), { status: 401, headers: { 'X-Request-ID': 'req-header' } }));
    await expect(searchReceptionMembers('A', 'opaque')).rejects.toMatchObject({
      kind: 'http', status: 401, code: 'SESSION_REVOKED', requestId: 'req-header',
      message: expect.not.stringContaining('secret backend traceback'),
    });
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('socket details'));
    await expect(searchReceptionMembers('A', 'opaque')).rejects.toBeInstanceOf(OperationalApiNetworkError);
  });

  it('maps authority, retry, server, and validation failures without leaking response details', async () => {
    for (const status of [403, 429, 500, 422]) {
      const issues = Array.from({ length: 21 }, (_, index) => ({ location: ['body', 'password-field'], type: index === 0 ? 'string_type' : 'unknown-internal-type', input: 'secret value', message: 'private detail' }));
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'internal database secret', issues, request_id: `req-${status}` } }), { status }));
      const error = await searchReceptionMembers('A', 'opaque').catch((reason: unknown) => reason);
      expect(error).toMatchObject({
        status, requestId: `req-${status}`, message: expect.not.stringContaining('internal database secret'),
      });
      if (status === 422) {
        expect(error).toMatchObject({ issues: Array.from({ length: 20 }, (_, index) => ({ location: ['body'], type: index === 0 ? 'string_type' : 'invalid' })) });
        expect(JSON.stringify(error)).not.toContain('secret value');
        expect(JSON.stringify(error)).not.toContain('private detail');
      }
    }
  });
});
