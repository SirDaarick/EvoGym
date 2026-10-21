import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOperationalToken, getReceptionConfig, getReceptionMember, readOperationalToken, searchReceptionMembers, signInReception } from './receptionApi';

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
});
