import { useMemo, useState } from 'react';
import { Button, Panel } from '@/shared/ui';
import { DevicePairingModal } from '@/features/staff/DevicePairingModal';
import { branchPayrollDate, type PayrollItem } from '@/api/payrollApi';
import type { AdminRosterProfileChoice } from '@/api/staffCredentialsApi';
import { DeactivationDialog } from './DeactivationDialog';
import { IssuedPinDialog } from './IssuedPinDialog';
import { PayrollDialog } from './PayrollDialog';
import { StaffEditModal } from './StaffEditModal';
import { StaffFilters } from './StaffFilters';
import { StaffRosterTable } from './StaffRosterTable';
import { usePayroll, type PayrollDialogState } from './usePayroll';
import { useStaffAccountActions } from './useStaffAccountActions';
import { useStaffRoster } from './useStaffRoster';
import type { StatusFilter } from './utils';

/** Server-only staff management for the authenticated product shell. */
export function ApiStaffManagement() {
  const [branchId, setBranchId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [payrollDialog, setPayrollDialog] = useState<PayrollDialogState | null>(null);
  const [deviceProfile, setDeviceProfile] = useState<AdminRosterProfileChoice | null>(null);

  const roster = useStaffRoster(branchId);
  const { profiles, accounts, series, payroll, payrollDate, branches } = roster;
  const payrollMutation = usePayroll(branchId);
  const actions = useStaffAccountActions(branchId, { onError: setActionError, onNotice: setNotice });

  const editingProfile = profiles.find(profile => profile.id === editingId) ?? null;
  const error = actionError || roster.loadError;
  const filteredProfiles = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return profiles.filter(profile =>
      (statusFilter === 'all' || (statusFilter === 'active' ? profile.is_active : !profile.is_active)) &&
      `${profile.full_name} ${profile.position}`.toLocaleLowerCase().includes(query));
  }, [profiles, searchQuery, statusFilter]);
  const activeCount = profiles.filter(profile => profile.is_active).length;
  const deviceAccount = deviceProfile?.staff_user_id
    ? accounts.find(account => account.id === deviceProfile.staff_user_id && account.linked_profile_id === deviceProfile.id)
    : undefined;

  function selectBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setEditingId(null);
    setPayrollDialog(null);
    setDeviceProfile(null);
    setActionError('');
    setNotice('');
    payrollMutation.reset();
    actions.reset();
  }

  function openEdit(profile: AdminRosterProfileChoice) {
    setEditingId(profile.id);
    setActionError('');
    setNotice('');
  }

  function openPayroll(item: PayrollItem, mode: 'advance' | 'pay', targetWeek?: string) {
    const timezone = branches.find(branch => branch.id === branchId)?.timezone;
    if (!payrollDate || !timezone) return;
    if (branchPayrollDate(timezone).weekStart !== payrollDate.weekStart) {
      void roster.reload();
      return;
    }
    payrollMutation.reset();
    setPayrollDialog({ item, mode, targetWeek: targetWeek ?? payrollDate.weekStart, key: crypto.randomUUID(), nextWeekKey: crypto.randomUUID() });
  }

  function closeEdit() {
    setEditingId(null);
  }

  function saveSalary(amountMinor: number) {
    if (!editingProfile || editingProfile.monthly_salary_minor === undefined) return;
    setActionError('');
    actions.saveSalary.mutate({ profileId: editingProfile.id, amountMinor }, {
      onSuccess: () => { closeEdit(); setNotice('Sueldo actualizado correctamente.'); },
      onError: () => setActionError('No se pudo guardar el sueldo. Verifica los adelantos pendientes e intenta de nuevo.'),
    });
  }

  function linkAccount(accountId: string) {
    const profile = editingProfile;
    const account = accounts.find(row => row.id === accountId);
    if (!profile || profile.staff_user_id || !account || !account.is_active || actions.link.isPending ||
        (account.linked_profile_id !== null && account.linked_profile_id !== profile.id)) return;
    setActionError('');
    setNotice('');
    actions.link.mutate(
      { profileId: profile.id, accountId, branch: branchId, label: `La cuenta ${account.login_identifier} quedó vinculada a ${profile.full_name}.` },
      { onSuccess: closeEdit },
    );
  }

  function issuePin(profile: AdminRosterProfileChoice) {
    if (!profile.staff_user_id) return;
    setActionError('');
    actions.clearIssuedPin();
    actions.issuePin.mutate({ profileId: profile.id, name: profile.full_name, staffUserId: profile.staff_user_id, branch: branchId });
  }

  return (
    <div className="staff-mgmt-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">ADMINISTRACIÓN · PERSONAL</p>
          <h1>Equipo de Recepción</h1>
          <p className="muted">{activeCount} activos · {profiles.length - activeCount} inactivos · {profiles.length} en total</p>
        </div>
        <Button variant="primary" disabled title="La creación de perfiles aún no está disponible en la API.">
          <span>+</span> Nuevo recepcionista
        </Button>
      </header>

      <Panel className="staff-mgmt-panel">
        <StaffFilters
          searchQuery={searchQuery} onSearchChange={setSearchQuery}
          statusFilter={statusFilter} onStatusChange={setStatusFilter}
          placeholder="Buscar recepcionista o turno..."
          leading={
            <div className="field staff-mgmt-search">
              <label htmlFor="api-staff-branch">Sucursal</label>
              <select id="api-staff-branch" value={branchId} disabled={roster.loading || !branches.length}
                onChange={event => selectBranch(event.target.value)}>
                <option value="">Selecciona una sucursal</option>
                {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>)}
              </select>
            </div>
          }
        />
        {error && <p role="alert" className="staff-pin-error">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {roster.loading && <p role="status">Cargando personal desde la API…</p>}
        <StaffRosterTable
          profiles={filteredProfiles} accounts={accounts} series={series} payroll={payroll}
          payrollWeekStart={payrollDate?.weekStart ?? null}
          emptyMessage={branchId ? 'No se encontraron recepcionistas con los criterios actuales.' : 'Selecciona una sucursal para consultar al personal.'}
          pinIssuingId={actions.issuingId} deactivationBusy={actions.deactivationBusy}
          onPayroll={openPayroll} onIssuePin={issuePin} onPairDevice={setDeviceProfile} onEdit={openEdit}
          onDeactivation={(profile, active) => actions.openDeactivation({ profile, active })}
        />
      </Panel>

      {payrollDialog && payrollDate && (
        <PayrollDialog
          dialog={payrollDialog} currentWeekStart={payrollDate.weekStart}
          busy={payrollMutation.isPending}
          serverError={payrollMutation.error?.message ?? ''}
          onSubmit={submission => payrollMutation.mutate(submission, { onSuccess: () => setPayrollDialog(null) })}
          onClose={() => setPayrollDialog(null)}
        />
      )}
      {actions.deactivation && (
        <DeactivationDialog
          state={actions.deactivation} busy={actions.deactivationBusy}
          onResolve={() => actions.resolveSale(actions.deactivation!)}
          onConfirm={() => actions.confirmDeactivation(actions.deactivation!)}
          onClose={actions.closeDeactivation}
        />
      )}
      {editingProfile && (
        <StaffEditModal
          key={editingProfile.id} profile={editingProfile} branchId={branchId} accounts={accounts} series={series}
          error={error} salarySaving={actions.saveSalary.isPending} linking={actions.link.isPending}
          onSaveSalary={saveSalary} onLink={linkAccount} onNotice={setNotice} onClose={closeEdit}
        />
      )}
      {actions.issuedPin && (
        <IssuedPinDialog
          pin={actions.issuedPin.value}
          description={`Entrega este PIN a ${actions.issuedPin.name} de forma segura. Sólo se muestra una vez.`}
          onClose={actions.clearIssuedPin}
        />
      )}
      {deviceProfile && deviceAccount && (
        <DevicePairingModal isOpen staff={null}
          serverIdentity={{ staffId: deviceAccount.id, staffName: deviceProfile.full_name, contextId: branchId }}
          onClose={() => setDeviceProfile(null)} />
      )}
    </div>
  );
}
