import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminAuthClient } from '../../api/adminAuthApi';
import { AdminRecoveryPage } from './AdminRecoveryPage';

function client(startRecovery: ReturnType<typeof vi.fn>, completeRecovery: ReturnType<typeof vi.fn>) {
  return { startRecovery, completeRecovery } as unknown as AdminAuthClient;
}

describe('AdminRecoveryPage', () => {
  it('uses an enumeration-safe start response and sends only an explicit request', async () => {
    const startRecovery = vi.fn().mockResolvedValue(undefined);
    render(<AdminRecoveryPage client={client(startRecovery, vi.fn())} />);
    expect(startRecovery).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Admin email or username'), { target: { value: 'admin@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery instructions' }));
    expect(await screen.findByRole('status')).toHaveTextContent('If the account is eligible');
    expect(startRecovery).toHaveBeenCalledWith('admin@example.test');
  });

  it('requires matching new password confirmation and clears secrets after success', async () => {
    const token = 'd'.repeat(43);
    const completeRecovery = vi.fn().mockResolvedValue(undefined);
    render(<AdminRecoveryPage token={token} client={client(vi.fn(), completeRecovery)} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new synthetic password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match');
    expect(completeRecovery).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new synthetic password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('All Admin sessions have been revoked');
    expect(completeRecovery).toHaveBeenCalledWith(token, 'new synthetic password');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
    expect(document.body).not.toHaveTextContent(token);
  });

  it('does not send arbitrary server details to the page', async () => {
    const startRecovery = vi.fn().mockRejectedValue(new Error('private diagnostics'));
    render(<AdminRecoveryPage client={client(startRecovery, vi.fn())} />);
    fireEvent.change(screen.getByLabelText('Admin email or username'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery instructions' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be completed');
    expect(document.body).not.toHaveTextContent('private diagnostics');
  });
});
