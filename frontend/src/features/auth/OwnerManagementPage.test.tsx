import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OwnerManagementPage } from './OwnerManagementPage';

const staffId = '123e4567-e89b-42d3-a456-426614174002';
const bundleId = '123e4567-e89b-42d3-a456-426614174003';
const branchId = '123e4567-e89b-42d3-a456-426614174004';
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('OwnerManagementPage', () => {
  it('assigns a selected existing staff member and branch through the authenticated request', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/staff')) return response({ staff: [
        { id: staffId, login_identifier: 'employee@example.test', is_admin: true, can_be_admin: true,
          reception_branch_ids: [], is_owner: false },
      ] });
      if (path.endsWith('/branches')) return response({ branches: [{ id: branchId, code: 'north', name: 'North' }] });
      if (path.endsWith('/bundles')) return response({ bundles: [{ id: bundleId, name: 'Coach',
        permissions: ['members:read'], is_active: true }], permissions: ['members:read'] });
      if (path.endsWith('/assignments') && init?.method === 'POST') return response({
        id: 'assignment-id', staff_id: staffId, bundle_id: bundleId, scope_kind: 'branch', branch_id: branchId, is_active: true,
      }, 201);
      return response({ assignments: [] });
    });
    render(<OwnerManagementPage request={request} />);
    await screen.findAllByRole('option', { name: 'employee@example.test' });
    fireEvent.change(screen.getByLabelText('Existing staff account', { selector: '#role-staff' }), { target: { value: staffId } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Bundle' }), { target: { value: bundleId } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Scope' }), { target: { value: 'branch' } });
    fireEvent.change(screen.getByLabelText('Branch', { selector: '#role-branch' }), { target: { value: branchId } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign bundle' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/api/v1/admin/role-management/assignments', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ staff_id: staffId, bundle_id: bundleId, scope_kind: 'branch', branch_id: branchId }),
    })));
    expect(screen.queryByLabelText('Bootstrap owner')).not.toBeInTheDocument();
  });
});
