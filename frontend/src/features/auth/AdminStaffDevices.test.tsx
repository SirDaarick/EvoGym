import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminStaffDevices } from './AdminStaffDevices';

const staffId = '123e4567-e89b-42d3-a456-426614174000';
const deviceId = '123e4567-e89b-42d3-a456-426614174001';
const otherStaffId = '123e4567-e89b-42d3-a456-426614174002';

function response(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe('AdminStaffDevices', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows only the selected employee devices and a one-time code in memory', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response(200, { devices: [
        { id: deviceId, staff_id: staffId, staff_login: 'worker@example.test', device_name: 'Current phone',
          paired_at: '2026-10-24T00:00:00Z', last_seen_at: '2026-10-24T00:00:00Z', revoked: false, revoked_at: null },
        { id: otherStaffId, staff_id: otherStaffId, staff_login: 'other@example.test', device_name: 'Other phone',
          paired_at: '2026-10-24T00:00:00Z', last_seen_at: '2026-10-24T00:00:00Z', revoked: false, revoked_at: null },
      ] }))
      .mockResolvedValueOnce(response(200, { id: otherStaffId, pairing_code: '012345', expires_at: '2026-10-24T00:15:00Z' }));
    render(<AdminStaffDevices staffId={staffId} staffLogin="worker@example.test" request={request} />);
    expect(await screen.findByRole('listitem')).toHaveTextContent('Current phone');
    expect(screen.queryByText('Other phone')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Issue replacement pairing code' }));
    expect(await screen.findByText('012345')).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss pairing code' }));
    await waitFor(() => expect(screen.queryByText('012345')).not.toBeInTheDocument());
  });

  it('confirms lost-phone revocation and never retries an uncertain POST', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response(200, { devices: [
        { id: deviceId, staff_id: staffId, staff_login: 'worker@example.test', device_name: 'Current phone',
          paired_at: '2026-10-24T00:00:00Z', last_seen_at: '2026-10-24T00:00:00Z', revoked: false, revoked_at: null },
      ] }))
      .mockRejectedValueOnce(new Error('connection lost'));
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    render(<AdminStaffDevices staffId={staffId} staffLogin="worker@example.test" request={request} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke lost phone' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('phone sessions'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh the device list before trying again.');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
