import { describe, expect, it, vi } from 'vitest';
import { listReceptionProfiles, phoneLogin, receptionLogin } from './employeeAuthApi';

const branchId = '123e4567-e89b-42d3-a456-426614174000';
const profile = { id: branchId, full_name: 'Taylor Staff', position: 'Reception' };
const body = { access_token: 'a'.repeat(43), token_type: 'bearer', expires_at: '2026-10-23T12:00:00Z' };

describe('employee auth API', () => {
  it('creates server-assigned phone purpose without accepting a purpose hint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 201 }));
    await phoneLogin({ loginIdentifier: 'employee@example.test', pin: '246810', branchId }, { apiOrigin: 'https://api.example.test', fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.test/api/v1/auth/staff/sessions');
    expect(JSON.parse(init.body)).toEqual({ login_identifier: 'employee@example.test', pin: '246810', branch_id: branchId });
    expect(init.credentials).toBe('omit');
  });

  it('uses only the distinct station authorization scheme and fetches minimal profiles', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ profiles: [profile] }), { status: 200 }));
    await expect(listReceptionProfiles('s'.repeat(43), { apiOrigin: 'https://api.example.test', fetchImpl })).resolves.toEqual([profile]);
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ Authorization: `ReceptionStation ${'s'.repeat(43)}` });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.test/api/v1/auth/reception/profiles');
  });

  it('sends the selected profile and PIN but never puts the station secret in the body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 201 }));
    const session = await receptionLogin({ stationCredential: 's'.repeat(43), profile, pin: '246810' },
      { apiOrigin: 'https://api.example.test', fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ profile_id: profile.id, pin: '246810' });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`ReceptionStation ${'s'.repeat(43)}`);
    expect(session).toMatchObject({ purpose: 'reception', profile });
  });
});
