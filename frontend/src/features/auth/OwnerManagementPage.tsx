import { useCallback, useEffect, useState } from 'react';
import {
  assignRoleBundle,
  deactivateRoleBundle,
  getRoleManagementChoices,
  revokeRoleBundle,
  saveRoleBundle,
  setAdminRole,
  setReceptionRole,
  type RoleManagementChoices,
} from '../../api/adminRoleManagementApi';
import { Badge, Button, PageHeader, Panel } from '../../shared/ui';

type Request = (path: string, init?: RequestInit) => Promise<Response>;

export function OwnerManagementPage({ request }: { request: Request }) {
  const [choices, setChoices] = useState<RoleManagementChoices | null>(null);
  const [name, setName] = useState('');
  const [editingBundleId, setEditingBundleId] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [staffId, setStaffId] = useState('');
  const [bundleId, setBundleId] = useState('');
  const [scope, setScope] = useState<'organization' | 'branch'>('organization');
  const [branchId, setBranchId] = useState('');
  const [individualBranchId, setIndividualBranchId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setChoices(await getRoleManagementChoices(request));
    } catch {
      setError('Owner management data could not be loaded. Check your session and try again.');
    }
  }, [request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function mutate(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch {
      setError('The change was not confirmed. Reload the current state before trying again.');
    } finally {
      setBusy(false);
    }
  }

  const activeBundles = choices?.bundles.filter((bundle) => bundle.is_active) ?? [];
  const staff = choices?.staff.filter((item) => !item.is_owner) ?? [];
  const selectedStaff = staff.find((item) => item.id === staffId);

  return (
    <section aria-label="Owner management" className="owner-mgmt-container" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        eyebrow="PROPIETARIO · SEGURIDAD"
        title="Owner management"
        description="Manage existing staff access and reusable permission bundles. Changes are checked by the server on every request."
      />

      {error && (
        <div role="alert" style={{ color: 'var(--color-danger, #A32222)', padding: '12px 16px', background: 'rgba(163,34,34,0.1)', borderRadius: '8px' }}>
          {error}
        </div>
      )}

      {!choices && <p role="status">Loading owner management…</p>}

      {choices && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
          {/* Panel 1: Bundle Creator / Editor */}
          <Panel className="owner-bundle-editor-panel">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>Create or replace a permission bundle</h2>
              <fieldset disabled={busy} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <legend className="sr-only">Create or replace a permission bundle</legend>

                <div className="field">
                  <label htmlFor="edit-role-bundle">Edit existing bundle</label>
                  <select
                    id="edit-role-bundle"
                    value={editingBundleId}
                    onChange={(event) => {
                      const id = event.target.value;
                      const selected = choices.bundles.find((bundle) => bundle.id === id);
                      setEditingBundleId(id);
                      setName(selected?.name ?? '');
                      setPermissions(selected?.permissions ?? []);
                    }}
                  >
                    <option value="">Create a new bundle</option>
                    {choices.bundles
                      .filter((bundle) => bundle.is_active)
                      .map((bundle) => (
                        <option key={bundle.id} value={bundle.id}>
                          {bundle.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="role-bundle-name">Bundle name</label>
                  <input
                    id="role-bundle-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. Turn Supervisor"
                  />
                </div>

                <fieldset style={{ border: '1px solid var(--color-divider, #333)', borderRadius: '8px', padding: '12px 16px', margin: 0 }}>
                  <legend style={{ padding: '0 6px', fontWeight: 600, fontSize: '13px' }}>Permissions</legend>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', marginTop: '4px' }}>
                    {choices.permissions.map((permission) => (
                      <label key={permission} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={permissions.includes(permission)}
                          onChange={(event) =>
                            setPermissions((current) =>
                              event.target.checked
                                ? [...current, permission]
                                : current.filter((item) => item !== permission)
                            )
                          }
                        />
                        <span>{permission}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <Button
                  variant="primary"
                  type="button"
                  disabled={!name.trim() || permissions.length === 0}
                  onClick={() =>
                    void mutate(async () => {
                      await saveRoleBundle(request, { name, permissions }, editingBundleId || undefined);
                      setName('');
                      setPermissions([]);
                      setEditingBundleId('');
                    })
                  }
                >
                  {editingBundleId ? 'Save bundle changes' : 'Create permission bundle'}
                </Button>
              </fieldset>

              <div style={{ borderTop: '1px solid var(--color-divider, #333)', paddingTop: '16px' }}>
                <p style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px' }}>Active bundles catalogue</p>
                <ul aria-label="Permission bundles" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {choices.bundles.map((bundle) => (
                    <li
                      key={bundle.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: 'var(--color-canvas, #1a1a1a)',
                        borderRadius: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Badge tone={bundle.is_active ? 'success' : 'neutral'}>
                          {bundle.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        <span style={{ fontWeight: 600, fontSize: '13px' }}>
                          {bundle.name}
                          {bundle.is_active ? '' : ' (inactive)'}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        disabled={busy || !bundle.is_active}
                        onClick={() => void mutate(() => deactivateRoleBundle(request, bundle.id))}
                      >
                        Deactivate {bundle.name}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Panel>

          {/* Panel 2: Bundle Assignment */}
          <Panel className="owner-assignment-panel">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>Assign a permission bundle</h2>
              <fieldset disabled={busy} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <legend className="sr-only">Assign a permission bundle</legend>

                <div className="field">
                  <label htmlFor="role-staff">Existing staff account</label>
                  <select id="role-staff" value={staffId} onChange={(event) => setStaffId(event.target.value)}>
                    <option value="">Choose staff</option>
                    {staff.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.login_identifier}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="role-bundle">Bundle</label>
                  <select
                    id="role-bundle"
                    aria-label="Bundle"
                    value={bundleId}
                    onChange={(event) => setBundleId(event.target.value)}
                  >
                    <option value="">Choose bundle</option>
                    {activeBundles.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="role-scope">Scope</label>
                  <select
                    id="role-scope"
                    aria-label="Scope"
                    value={scope}
                    onChange={(event) => setScope(event.target.value as 'organization' | 'branch')}
                  >
                    <option value="organization">Organization</option>
                    <option value="branch">Branch</option>
                  </select>
                </div>

                {scope === 'branch' && (
                  <div className="field">
                    <label htmlFor="role-branch">Branch</label>
                    <select
                      id="role-branch"
                      value={branchId}
                      onChange={(event) => setBranchId(event.target.value)}
                    >
                      <option value="">Choose branch</option>
                      {choices.branches.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.code})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <Button
                  variant="primary"
                  type="button"
                  disabled={!staffId || !bundleId || (scope === 'branch' && !branchId)}
                  onClick={() =>
                    void mutate(() =>
                      assignRoleBundle(request, {
                        staff_id: staffId,
                        bundle_id: bundleId,
                        scope_kind: scope,
                        branch_id: scope === 'branch' ? branchId : null,
                      })
                    )
                  }
                >
                  Assign bundle
                </Button>
              </fieldset>

              <div style={{ borderTop: '1px solid var(--color-divider, #333)', paddingTop: '16px' }}>
                <h3 style={{ fontSize: '15px', margin: '0 0 10px 0' }}>Current assignments</h3>
                {choices.assignments.length === 0 ? (
                  <p style={{ color: 'var(--color-muted)', fontSize: '13px' }}>No active bundle assignments.</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {choices.assignments.map((assignment) => {
                      const bundle = choices.bundles.find((item) => item.id === assignment.bundle_id);
                      const person = choices.staff.find((item) => item.id === assignment.staff_id);
                      const branch = choices.branches.find((item) => item.id === assignment.branch_id);

                      return (
                        <li
                          key={assignment.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            background: 'var(--color-canvas, #1a1a1a)',
                            borderRadius: '6px',
                          }}
                        >
                          <div style={{ fontSize: '13px' }}>
                            <strong>{person?.login_identifier ?? 'Staff'}</strong> — {bundle?.name ?? 'Bundle'} —{' '}
                            <Badge tone="neutral">{assignment.scope_kind}</Badge>
                            {branch ? ` (${branch.name})` : ''}
                          </div>
                          {assignment.is_active && (
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void mutate(() => revokeRoleBundle(request, assignment.id))}
                            >
                              Revoke assignment
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </Panel>

          {/* Panel 3: Individual Roles */}
          <Panel className="owner-individual-panel">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontSize: '16px', margin: 0 }}>Individual Admin and Reception access</h3>
              <p style={{ color: 'var(--color-muted)', fontSize: '13px', margin: 0 }}>
                Configure base roles, platform admin status, or assign specific branch reception station permissions.
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}>
                <div className="field" style={{ minWidth: '260px', flex: 1 }}>
                  <label htmlFor="individual-staff">Existing staff account</label>
                  <select
                    id="individual-staff"
                    value={staffId}
                    onChange={(event) => setStaffId(event.target.value)}
                  >
                    <option value="">Choose staff</option>
                    {staff.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.login_identifier}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedStaff && (
                  <>
                    {selectedStaff.can_be_admin && (
                      <Button
                        variant="secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => void mutate(() => setAdminRole(request, selectedStaff.id, !selectedStaff.is_admin))}
                      >
                        {selectedStaff.is_admin ? 'Revoke Admin identity' : 'Grant Admin identity'}
                      </Button>
                    )}

                    <div className="field" style={{ minWidth: '200px' }}>
                      <label htmlFor="reception-branch">Reception branch</label>
                      <select
                        id="reception-branch"
                        value={individualBranchId}
                        onChange={(event) => setIndividualBranchId(event.target.value)}
                      >
                        <option value="">Choose branch</option>
                        {choices.branches.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <Button
                      variant="secondary"
                      type="button"
                      disabled={busy || !individualBranchId}
                      onClick={() =>
                        void mutate(() =>
                          setReceptionRole(
                            request,
                            selectedStaff.id,
                            individualBranchId,
                            !selectedStaff.reception_branch_ids.includes(individualBranchId)
                          )
                        )
                      }
                    >
                      {selectedStaff.reception_branch_ids.includes(individualBranchId)
                        ? 'Revoke Reception access'
                        : 'Grant Reception access'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </Panel>
        </div>
      )}
    </section>
  );
}
