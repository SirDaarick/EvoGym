export interface OwnerStatus {
  staff_id: string;
  is_owner: boolean;
  can_manage_employees: boolean;
}

export interface RoleManagementStaff {
  id: string;
  login_identifier: string;
  is_admin: boolean;
  can_be_admin: boolean;
  reception_branch_ids: string[];
  is_owner: boolean;
}

export interface RoleManagementBranch {
  id: string;
  code: string;
  name: string;
}

export interface RoleBundle {
  id: string;
  name: string;
  permissions: string[];
  is_active: boolean;
}

export interface RoleBundleAssignment {
  id: string;
  staff_id: string;
  bundle_id: string;
  scope_kind: 'organization' | 'branch';
  branch_id: string | null;
  is_active: boolean;
}

export interface RoleManagementChoices {
  staff: RoleManagementStaff[];
  branches: RoleManagementBranch[];
  bundles: RoleBundle[];
  assignments: RoleBundleAssignment[];
  permissions: string[];
}

export class RoleManagementApiError extends Error {
  constructor(message = 'Owner management could not be completed.') {
    super(message);
    this.name = 'RoleManagementApiError';
  }
}

type AdminRequest = (path: string, init?: RequestInit) => Promise<Response>;
const base = '/api/v1/admin/role-management';

async function call<T>(request: AdminRequest, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await request(`${base}${path}`, init);
  } catch {
    throw new RoleManagementApiError();
  }
  if (!response.ok) throw new RoleManagementApiError();
  try {
    return await response.json() as T;
  } catch {
    throw new RoleManagementApiError();
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function getOwnerStatus(request: AdminRequest): Promise<OwnerStatus> {
  return call(request, '/me');
}

export async function getRoleManagementChoices(request: AdminRequest): Promise<RoleManagementChoices> {
  const [staff, branches, bundleResult, assignmentResult] = await Promise.all([
    call<{ staff: RoleManagementStaff[] }>(request, '/staff'),
    call<{ branches: RoleManagementBranch[] }>(request, '/branches'),
    call<{ bundles: RoleBundle[]; permissions: string[] }>(request, '/bundles'),
    call<{ assignments: RoleBundleAssignment[] }>(request, '/assignments'),
  ]);
  return { staff: staff.staff, branches: branches.branches, bundles: bundleResult.bundles,
    assignments: assignmentResult.assignments, permissions: bundleResult.permissions };
}

export function saveRoleBundle(request: AdminRequest, bundle: { name: string; permissions: string[] }, id?: string): Promise<RoleBundle> {
  return call(request, id ? `/bundles/${encodeURIComponent(id)}` : '/bundles',
    json(id ? 'PUT' : 'POST', bundle));
}

export function deactivateRoleBundle(request: AdminRequest, id: string): Promise<{ deactivated: boolean }> {
  return call(request, `/bundles/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function assignRoleBundle(request: AdminRequest, assignment: {
  staff_id: string; bundle_id: string; scope_kind: 'organization' | 'branch'; branch_id: string | null;
}): Promise<RoleBundleAssignment> {
  return call(request, '/assignments', json('POST', assignment));
}

export function revokeRoleBundle(request: AdminRequest, id: string): Promise<{ revoked: boolean }> {
  return call(request, `/assignments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function setAdminRole(request: AdminRequest, staffId: string, enabled: boolean): Promise<unknown> {
  return call(request, `/staff/${encodeURIComponent(staffId)}/admin`, { method: enabled ? 'POST' : 'DELETE' });
}

export function setReceptionRole(request: AdminRequest, staffId: string, branchId: string, enabled: boolean): Promise<unknown> {
  const path = `/staff/${encodeURIComponent(staffId)}/reception`;
  return call(request, enabled ? path : `${path}/${encodeURIComponent(branchId)}`,
    enabled ? json('POST', { branch_id: branchId }) : { method: 'DELETE' });
}
