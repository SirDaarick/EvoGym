import { describe, expect, it, vi } from 'vitest';
import { getRoleManagementChoices, RoleManagementApiError, saveRoleBundle, setReceptionRole } from './adminRoleManagementApi';

const response = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('admin role management API', () => {
  it('loads typed owner choices using the authenticated request without local token storage', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/staff')) return response(200, { staff: [] });
      if (path.endsWith('/branches')) return response(200, { branches: [] });
      if (path.endsWith('/bundles')) return response(200, { bundles: [], permissions: ['members:read'] });
      return response(200, { assignments: [] });
    });
    const choices = await getRoleManagementChoices(request);
    expect(choices.permissions).toEqual(['members:read']);
    expect(request).toHaveBeenCalledTimes(4);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('sends one bundle mutation and never retries or replays an authorization failure', async () => {
    const request = vi.fn(async () => response(403));
    await expect(saveRoleBundle(request, { name: 'Reception', permissions: ['members:read'] }))
      .rejects.toBeInstanceOf(RoleManagementApiError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('uses the server contract for branch-scoped Reception grants', async () => {
    const request = vi.fn(async () => response(201, { granted: true }));
    await setReceptionRole(request, 'staff-id', 'branch-id', true);
    expect(request).toHaveBeenCalledWith('/api/v1/admin/role-management/staff/staff-id/reception', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch_id: 'branch-id' }),
    });
  });
});
