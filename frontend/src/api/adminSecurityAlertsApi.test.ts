import { describe, expect, it, vi } from 'vitest';
import { acknowledgeAdminSecurityAlert, listAdminSecurityAlerts } from './adminSecurityAlertsApi';

const alertId = '96f8a8ad-e0b1-4898-a8c9-0b07d46b2390';
const alert = { id: alertId, staff_id: 'a5a353a5-fde3-4692-a831-81e11e58d000',
  login_identifier: 'employee@example.invalid', occurred_at: '2026-10-24T00:00:00Z', locked_until: '2026-10-24T00:05:00Z' };

describe('Admin security alert client', () => {
  it('requests a bounded pending page and validates its minimal DTO', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ alerts: [alert], next_cursor: null }), { status: 200 }));
    await expect(listAdminSecurityAlerts(request)).resolves.toEqual({ alerts: [alert], next_cursor: null });
    expect(request).toHaveBeenCalledWith('/api/v1/admin/security-alerts?limit=50', undefined);
  });

  it('acknowledges one validated event without replay and reports safe status errors', async () => {
    const request = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
    await expect(acknowledgeAdminSecurityAlert(request, alertId)).rejects.toMatchObject({ status: 403 });
    expect(request).toHaveBeenCalledTimes(1);
    await expect(acknowledgeAdminSecurityAlert(request, 'not-an-id')).rejects.toThrow('Lockout alerts could not be loaded');
  });
});
