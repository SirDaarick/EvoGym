import { describe, expect, it, vi } from 'vitest';
import { getAdminProfileChoices, getPairedProfileChoices, pairWithCode, enterEmployeeProfile, changeProfileInitialPin, logoutProfileAccess, logoutEmployeeProfileSession } from './profileAccessApi';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const row = { id: uuid, kind: 'employee', display_name: 'Ana Perez', is_owner: false, can_manage_employees: false,
  branch_profiles: [{ profile_id: uuid, branch_id: uuid, branch_name: 'Centro' }] };
const unlinkedRow = { id: uuid, kind: 'unlinked', source: 'roster_profile', profile_id: uuid,
  display_name: 'Pending Employee', is_owner: false, can_manage_employees: false,
  branch_profiles: [{ profile_id: uuid, branch_id: uuid, branch_name: 'Centro' }] };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('profile access API', () => {
  it('pairs with only a code and keeps the proof in an HttpOnly cookie', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { status: 'paired' }));
    await pairWithCode('123456', { apiOrigin: 'https://api.example.test', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.test/api/v1/auth/profile-access/pair', expect.objectContaining({
      method: 'POST', credentials: 'include', cache: 'no-store', body: JSON.stringify({ pairing_code: '123456' }),
    }));
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).not.toMatch(/access_token|credential/i);
  });

  it('loads identities using server scopes for Admin and paired employee', async () => {
    const request = vi.fn().mockResolvedValue(json(200, { identities: [row], current_identity_id: uuid }));
    await expect(getAdminProfileChoices(request)).resolves.toMatchObject({ identities: [{ id: uuid }], currentIdentityId: uuid });
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { identities: [row] }));
    await expect(getPairedProfileChoices({ apiOrigin: 'https://api.example.test', fetchImpl })).resolves.toMatchObject([{ id: uuid }]);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/auth/profile-access/context'), expect.objectContaining({ credentials: 'include' }));
  });

  it('accepts an explicitly roster-sourced unlinked choice and rejects ambiguous projections', async () => {
    const request = vi.fn().mockResolvedValue(json(200, { identities: [unlinkedRow], current_identity_id: uuid }));
    await expect(getAdminProfileChoices(request)).resolves.toMatchObject({
      identities: [{ kind: 'unlinked', source: 'roster_profile', id: uuid, profile_id: uuid }],
    });
    const malformed = vi.fn().mockResolvedValue(json(200, { identities: [{ ...unlinkedRow, source: 'staff_user' }], current_identity_id: uuid }));
    await expect(getAdminProfileChoices(malformed)).rejects.toThrow();
    const paired = vi.fn().mockResolvedValue(json(200, { identities: [unlinkedRow] }));
    await expect(getPairedProfileChoices({ apiOrigin: 'https://api.example.test', fetchImpl: paired })).rejects.toThrow();
  });

  it('enters an employee with a branch and six-digit PIN, and durably clears the paired cookie on exit', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(201, { access_token: 'x'.repeat(43), token_type: 'bearer', expires_at: '2026-10-24T12:00:00Z',
        identity: { id: uuid, kind: 'employee' }, profile: { id: uuid, branch_id: uuid }, purpose: 'reception' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await enterEmployeeProfile({ identityId: uuid, profileId: uuid, branchId: uuid, pin: '123456', adminRequest: undefined }, { apiOrigin: 'https://api.example.test', fetchImpl });
    await logoutProfileAccess({ apiOrigin: 'https://api.example.test', fetchImpl });
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', credentials: 'include', body: JSON.stringify({ profile_id: uuid, branch_id: uuid, pin: '123456' }) });
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', credentials: 'include', body: '{}' });
  });

  it('accepts only a matching setup-required result without any session payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(201, { status: 'setup_required', identity: { id: uuid }, profile: { id: uuid, branch_id: uuid } }));
    await expect(enterEmployeeProfile({ identityId: uuid, profileId: uuid, branchId: uuid, pin: '123456' },
      { apiOrigin: 'https://api.example.test', fetchImpl })).resolves.toEqual({ kind: 'setup_required', identityId: uuid, profileId: uuid, branchId: uuid });
    const mixed = vi.fn().mockResolvedValue(json(201, { status: 'setup_required', identity: { id: uuid }, profile: { id: uuid, branch_id: uuid }, access_token: 's'.repeat(43) }));
    await expect(enterEmployeeProfile({ identityId: uuid, profileId: uuid, branchId: uuid, pin: '123456' },
      { apiOrigin: 'https://api.example.test', fetchImpl: mixed })).rejects.toThrow();
    const mismatched = vi.fn().mockResolvedValue(json(201, { status: 'setup_required', identity: { id: uuid }, profile: { id: uuid, branch_id: '223e4567-e89b-42d3-a456-426614174000' } }));
    await expect(enterEmployeeProfile({ identityId: uuid, profileId: uuid, branchId: uuid, pin: '123456' },
      { apiOrigin: 'https://api.example.test', fetchImpl: mismatched })).rejects.toThrow();
  });

  it('changes a temporary PIN only through the selected profile and branch context', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await changeProfileInitialPin({ identityId: uuid, profileId: uuid, branchId: uuid, pin: '123456', newPin: '654321' },
      { apiOrigin: 'https://api.example.test', fetchImpl });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/profile-access/first-pin-change');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({ profile_id: uuid, branch_id: uuid, current_pin: '123456', new_pin: '654321' });
  });

  it('revokes only the bearer employee operating session without sending or clearing the paired cookie', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await logoutEmployeeProfileSession('s'.repeat(43), { apiOrigin: 'https://api.example.test', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.test/api/v1/auth/profile-access/sessions/logout', expect.objectContaining({
      method: 'POST', cache: 'no-store', headers: expect.objectContaining({ Authorization: `Bearer ${'s'.repeat(43)}` }), body: '{}',
    }));
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty('credentials');
  });

  it('requires an exact no-redirect 204 acknowledgement for employee-session revocation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not a revocation acknowledgement', { status: 200 }));
    await expect(logoutEmployeeProfileSession('s'.repeat(43), { apiOrigin: 'https://api.example.test', fetchImpl })).rejects.toThrow();
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });

  it('requires exact 204 acknowledgement when unlinking the paired device', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await expect(logoutProfileAccess({ apiOrigin: 'https://api.example.test', fetchImpl })).rejects.toThrow();
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', credentials: 'include', redirect: 'error' });
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(logoutProfileAccess({ apiOrigin: 'https://api.example.test', fetchImpl })).resolves.toBeUndefined();
  });
});
