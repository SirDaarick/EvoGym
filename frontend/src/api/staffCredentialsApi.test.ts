import { describe, expect, it, vi } from 'vitest';
import {
  StaffCredentialsApiError,
  StaffCredentialsConfigurationError,
  issueInitialPin,
  issueReceptionStation,
  listReceptionStations,
  revokeReceptionStation,
  listAdminBranches,
  listAdminRosterProfiles,
  submitFirstPinChange,
} from './staffCredentialsApi';

const branchId = '123e4567-e89b-42d3-a456-426614174000';
const staffId = '123e4567-e89b-42d3-a456-426614174001';

function response(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' } });
}

describe('staff credentials API', () => {
  it('validates the minimal admin choice contract and branch IDs', async () => {
    const request = vi.fn().mockResolvedValue(response(200, { branches: [{ id: branchId, code: 'north', name: 'North' }] }));
    await expect(listAdminBranches(request)).resolves.toEqual([{ id: branchId, code: 'north', name: 'North' }]);
    await expect(listAdminRosterProfiles(request, 'not-a-uuid')).rejects.toBeInstanceOf(StaffCredentialsApiError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('issues a six-digit PIN through the authenticated request without replaying the POST', async () => {
    const request = vi.fn().mockResolvedValue(response(200, { initial_pin: '004207' }));
    await expect(issueInitialPin(request, staffId)).resolves.toBe('004207');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', cache: 'no-store' });
  });

  it('keeps station secrets out of listing responses and scopes provisioning/revocation by branch', async () => {
    const secret = 's'.repeat(43);
    const request = vi.fn()
      .mockResolvedValueOnce(response(200, { stations: [{ id: staffId, branch_id: branchId,
        created_at: '2026-10-23T00:00:00Z', expires_at: '2027-01-21T00:00:00Z', revoked_at: null }] }))
      .mockResolvedValueOnce(response(201, { id: staffId, branch_id: branchId,
        created_at: '2026-10-23T00:00:00Z', expires_at: '2027-01-21T00:00:00Z', revoked_at: null,
        station_credential: secret }))
      .mockResolvedValueOnce(response(204));
    await expect(listReceptionStations(request, branchId)).resolves.toHaveLength(1);
    const issued = await issueReceptionStation(request, branchId);
    expect(issued.station_credential).toBe(secret);
    expect(request.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', cache: 'no-store' });
    expect(request.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ branch_id: branchId }));
    await expect(revokeReceptionStation(request, branchId, staffId)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('requires a configured origin and sends the public change without credentials or bearer headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(204));
    await expect(submitFirstPinChange({ loginIdentifier: 'employee', branchId, currentPin: '123456', newPin: '654321' },
      { fetchImpl })).rejects.toBeInstanceOf(StaffCredentialsConfigurationError);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(submitFirstPinChange({ loginIdentifier: 'employee', branchId, currentPin: '123456', newPin: '654321' },
      { apiOrigin: 'https://api.example.test', fetchImpl })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.example.test/api/v1/staff/credentials/first-change');
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store' });
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
  });

  it('maps public throttling and rejects unsafe origins', async () => {
    const throttled = vi.fn().mockResolvedValue(response(429, { detail: 'sensitive internal text' }));
    await expect(submitFirstPinChange({ loginIdentifier: 'employee', branchId, currentPin: '123456', newPin: '654321' },
      { apiOrigin: 'https://api.example.test', fetchImpl: throttled })).rejects.toMatchObject({
        status: 429, message: 'Too many attempts. Wait a few minutes before trying again.',
      });
    const fetchImpl = vi.fn();
    await expect(submitFirstPinChange({ loginIdentifier: 'employee', branchId, currentPin: '123456', newPin: '654321' },
      { apiOrigin: 'https://user:secret@api.example.test/path', fetchImpl })).rejects.toBeInstanceOf(StaffCredentialsConfigurationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
