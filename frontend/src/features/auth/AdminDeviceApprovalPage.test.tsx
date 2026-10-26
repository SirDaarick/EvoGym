import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminAuthClient } from '../../api/adminAuthApi';
import { AdminDeviceApprovalPage } from './AdminDeviceApprovalPage';

function client(approveDevice: ReturnType<typeof vi.fn>) {
  return { approveDevice } as unknown as AdminAuthClient;
}

describe('AdminDeviceApprovalPage', () => {
  it('does not approve automatically and strips the secret from visible/storage surfaces', () => {
    const token = 'a'.repeat(43);
    const approveDevice = vi.fn();
    render(<AdminDeviceApprovalPage token={token} client={client(approveDevice)} />);
    expect(screen.getByRole('button', { name: 'Approve this device' })).toBeInTheDocument();
    expect(approveDevice).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent(token);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('submits only after explicit approval, suppresses duplicate clicks, and never signs in here', async () => {
    let finish!: () => void;
    const approveDevice = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<AdminDeviceApprovalPage token={'b'.repeat(43)} client={client(approveDevice)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve this device' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approving…' }));
    expect(approveDevice).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByRole('status')).toHaveTextContent('Return to the original browser');
    expect(document.body).not.toHaveTextContent('signed in');
  });

  it('ignores a completion that arrives after unmount', async () => {
    let finish!: () => void;
    const approveDevice = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = render(<AdminDeviceApprovalPage token={'c'.repeat(43)} client={client(approveDevice)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve this device' }));
    view.unmount();
    finish();
    await waitFor(() => expect(approveDevice).toHaveBeenCalledTimes(1));
  });
});
