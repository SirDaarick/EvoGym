import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminSecurityAlerts } from './AdminSecurityAlerts';

const alert = { id: '96f8a8ad-e0b1-4898-a8c9-0b07d46b2390', staff_id: 'a5a353a5-fde3-4692-a831-81e11e58d000',
  login_identifier: 'employee@example.invalid', occurred_at: '2026-10-24T00:00:00Z', locked_until: '2026-10-24T00:05:00Z' };

afterEach(cleanup);

describe('AdminSecurityAlerts', () => {
  it('loads pending alerts and refreshes globally after an explicit acknowledgement', async () => {
    let acknowledged = false;
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        acknowledged = true;
        return new Response(JSON.stringify({ id: alert.id, acknowledged_at: '2026-10-24T00:10:00Z', acknowledged_by: alert.staff_id }), { status: 200 });
      }
      return new Response(JSON.stringify({ alerts: acknowledged ? [] : [alert], next_cursor: null }), { status: 200 });
    });
    render(<AdminSecurityAlerts status="authenticated" request={request} />);
    expect((await screen.findByRole('listitem')).textContent).toContain('employee@example.invalid');
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge lockout for employee@example.invalid' }));
    await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull());
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(screen.getByText('No pending lockout alerts.')).toBeTruthy();
  });

  it('clears prior results on permission denial and does not expose raw server errors', async () => {
    let denied = false;
    const request = vi.fn(async () => denied
      ? new Response(JSON.stringify({ detail: 'secret server detail' }), { status: 403 })
      : new Response(JSON.stringify({ alerts: [alert], next_cursor: null }), { status: 200 }));
    const view = render(<AdminSecurityAlerts status="authenticated" request={request} />);
    expect((await screen.findByRole('listitem')).textContent).toContain('employee@example.invalid');
    denied = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lockout alerts' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull());
    expect(screen.queryByText('secret server detail')).toBeNull();
    view.unmount();
  });
});
