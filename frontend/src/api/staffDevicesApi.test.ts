import { describe, expect, it, vi } from 'vitest';
import {
  issueAdminDevicePairingCode,
  listAdminPairedDevices,
  revokeAdminPairedDevice,
  submitEmployeeDevicePairing,
} from './staffDevicesApi';

const staffId = '123e4567-e89b-42d3-a456-426614174000';
const deviceId = '123e4567-e89b-42d3-a456-426614174001';
const pairingCodeId = '123e4567-e89b-42d3-a456-426614174002';
const deviceIdentifier = '123e4567-e89b-42d3-a456-426614174003';

function response(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe('staff devices API', () => {
  it('lists safe device metadata and issues a one-time pairing code without retrying writes', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response(200, { devices: [{ id: deviceId, staff_id: staffId,
        staff_login: 'worker@example.test', device_name: 'Work phone', paired_at: '2026-10-24T00:00:00Z',
        last_seen_at: '2026-10-24T00:00:00Z', revoked: false, revoked_at: null }] }))
      .mockResolvedValueOnce(response(200, { id: pairingCodeId, pairing_code: '012345',
        expires_at: '2026-10-24T00:15:00Z' }));
    await expect(listAdminPairedDevices(request)).resolves.toHaveLength(1);
    await expect(issueAdminDevicePairingCode(request, staffId)).resolves.toEqual({
      id: pairingCodeId, pairing_code: '012345', expires_at: '2026-10-24T00:15:00Z',
    });
    expect(request.mock.calls[1]?.[0]).toBe(`/api/v1/admin/staff/${staffId}/device-pairing`);
    expect(request.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', cache: 'no-store' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('revokes a selected phone once and submits public pairing without credentials or persisted identifiers', async () => {
    const request = vi.fn().mockResolvedValue(response(200, { revoked: true }));
    await revokeAdminPairedDevice(request, deviceId);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe(`/api/v1/admin/devices/${deviceId}/revoke`);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', cache: 'no-store' });

    const fetchImpl = vi.fn().mockResolvedValue(response(200, { device_id: deviceId, status: 'paired' }));
    await expect(submitEmployeeDevicePairing({ loginIdentifier: 'worker@example.test', pairingCode: '012345',
      deviceIdentifier, deviceName: 'My phone' }, { apiOrigin: 'https://api.example.test', fetchImpl })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.example.test/api/v1/auth/devices/pair');
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store' });
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ login_identifier: 'worker@example.test',
      pairing_code: '012345', device_identifier: deviceIdentifier, device_name: 'My phone' }));
  });
});
