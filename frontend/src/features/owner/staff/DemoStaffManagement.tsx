import { useCallback, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Panel } from '@/shared/ui';
import SwipeToast from '@/features/catalog/react-bits/SwipeToast';
import { DevicePairingModal } from '@/features/staff/DevicePairingModal';
import { saveStaffProfile, toggleStaffActive, useStaff, type StaffProfile } from '@/features/staff/staffStore';
import { issueInitialPin } from '@/api/staffCredentialsApi';
import { DemoStaffTable } from './DemoStaffTable';
import { IssuedPinDialog } from './IssuedPinDialog';
import { StaffFilters } from './StaffFilters';
import { StaffFormModal, type StaffFormValues } from './StaffFormModal';
import { mergeStaff, useStaffTable } from './useStaffTable';
import { useLiveStaffAccounts } from './useLiveStaffAccounts';
import { useAdminRequest, validUuid, type ManagedStaffProfile } from './utils';

interface ToastState { type: 'success' | 'error'; title: string; description: string }
type FormState = { staff: StaffProfile | null } | null;

/** Local/demo staff management (reception team) backed by the local store plus optional live accounts. */
export function DemoStaffManagement() {
  const staffList = useStaff();
  const request = useAdminRequest();
  const liveAccounts = useLiveStaffAccounts();
  const [form, setForm] = useState<FormState>(null);
  const [pairingStaff, setPairingStaff] = useState<StaffProfile | null>(null);
  const [issuedPin, setIssuedPin] = useState<{ staffName: string; pin: string } | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const merged = useMemo<ManagedStaffProfile[]>(() => mergeStaff(staffList, liveAccounts), [staffList, liveAccounts]);

  const issuePin = useMutation({
    mutationFn: ({ staff }: { staff: ManagedStaffProfile }) => issueInitialPin(request!, staff.staffUserId || staff.id),
    onSuccess: (pin, { staff }) => {
      setIssuedPin({ staffName: staff.name, pin });
      setToast({ type: 'success', title: 'PIN Inicial Emitido', description: `PIN temporal para ${staff.name}: ${pin}` });
    },
    onError: () => setToast({
      type: 'error', title: 'Error al emitir PIN',
      description: 'No se pudo generar el PIN inicial. Verifica tus permisos de administrador.',
    }),
  });

  const onIssuePin = useCallback((staff: ManagedStaffProfile) => {
    if (request && validUuid(staff.staffUserId || staff.id)) issuePin.mutate({ staff });
  }, [request, issuePin]);
  const onToggle = useCallback((staff: StaffProfile) => {
    const updated = toggleStaffActive(staff.id);
    if (updated) {
      setToast({
        type: 'success',
        title: updated.active ? 'Perfil reactivado' : 'Perfil desactivado',
        description: `${updated.name} ${updated.active ? 'ahora aparecerá' : 'ya no aparecerá'} en la pantalla de inicio.`,
      });
    }
  }, []);
  const onEdit = useCallback((staff: StaffProfile) => setForm({ staff }), []);

  const list = useStaffTable(merged, {
    canIssuePin: Boolean(request),
    pinIssuingId: issuePin.isPending ? issuePin.variables.staff.id : null,
    onIssuePin, onPair: setPairingStaff, onEdit, onToggle,
  });

  function handleSave(values: StaffFormValues) {
    const editing = form?.staff ?? null;
    saveStaffProfile({
      id: editing?.id ?? `recep-${Date.now().toString().slice(-4)}`,
      name: values.name, role: 'RECEPTION', shift: values.shift, salaryMinor: values.salaryMinor,
      hasPin: values.hasPin, pin: values.pin, active: values.active,
    });
    setToast({
      type: 'success',
      title: editing ? 'Perfil actualizado' : 'Recepcionista registrado',
      description: `El perfil de ${values.name} se ha guardado correctamente.`,
    });
    setForm(null);
  }

  return (
    <div className="staff-mgmt-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">ADMINISTRACIÓN · PERSONAL</p>
          <h1>Equipo de Recepción</h1>
          <p className="muted">{list.activeCount} activos · {list.inactiveCount} inactivos · {list.totalCount} en total</p>
        </div>
        <Button variant="primary" onClick={() => setForm({ staff: null })}><span>+</span> Nuevo recepcionista</Button>
      </header>

      <Panel className="staff-mgmt-panel">
        <StaffFilters searchQuery={list.searchQuery} onSearchChange={list.setSearchQuery}
          statusFilter={list.statusFilter} onStatusChange={list.setStatusFilter} placeholder="Buscar por nombre o turno..." />
        <DemoStaffTable table={list.table} columnCount={list.columnCount} />
      </Panel>

      {form && <StaffFormModal staff={form.staff} onSave={handleSave} onClose={() => setForm(null)} />}
      {issuedPin && (
        <IssuedPinDialog pin={issuedPin.pin} employeeName={issuedPin.staffName}
          description="Comunica esta credencial directamente al empleado. Sólo se muestra una vez."
          onClose={() => setIssuedPin(null)} />
      )}
      {toast && (
        <div className="staff-toast-wrapper">
          <SwipeToast open title={toast.title} description={toast.description} duration={3200}
            fuse={toast.type === 'error' ? 'none' : 'bottom'} closeButton closeLabel="Cerrar notificación"
            background="var(--color-surface)" color="var(--color-ink)"
            fuseColor={toast.type === 'error' ? 'var(--catalog-field-error, #A32222)' : 'var(--color-primary)'}
            onClose={() => setToast(null)} />
        </div>
      )}
      {pairingStaff && <DevicePairingModal isOpen staff={pairingStaff} onClose={() => setPairingStaff(null)} />}
    </div>
  );
}
