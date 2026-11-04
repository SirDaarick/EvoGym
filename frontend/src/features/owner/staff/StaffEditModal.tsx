import { useState } from 'react';
import { Button } from '@/shared/ui';
import { Dialog } from '@/shared/components/ui';
import JellyRadio from '@/features/catalog/react-bits/JellyRadio';
import SquishSwitch from '@/features/catalog/react-bits/SquishSwitch';
import { parseMoney } from '@/shared/formatters/money';
import type { AdminRosterProfileChoice, AdminStaffAccountChoice } from '@/api/staffCredentialsApi';
import type { StaffScheduleSeriesItem } from '@/api/staffSchedulesApi';
import { SalarySection } from './SalarySection';
import { ScheduleSection } from './ScheduleSection';

interface Props {
  profile: AdminRosterProfileChoice;
  branchId: string;
  accounts: AdminStaffAccountChoice[];
  series: StaffScheduleSeriesItem[];
  error: string;
  salarySaving: boolean;
  linking: boolean;
  onSaveSalary: (amountMinor: number) => void;
  onLink: (accountId: string) => void;
  onNotice: (message: string) => void;
  onClose: () => void;
}

export function StaffEditModal({ profile, branchId, accounts, series, error, salarySaving, linking, onSaveSalary, onLink, onNotice, onClose }: Props) {
  const [salaryText, setSalaryText] = useState(
    profile.monthly_salary_minor === undefined ? '' : (profile.monthly_salary_minor / 100).toFixed(2));
  const [salaryError, setSalaryError] = useState('');
  const [accountId, setAccountId] = useState(profile.staff_user_id ?? '');

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (profile.monthly_salary_minor === undefined) return;
    const amount = parseMoney(salaryText);
    if (amount === null || amount < 0 || !Number.isSafeInteger(amount)) {
      setSalaryError('Ingresa un sueldo mensual válido.');
      return;
    }
    setSalaryError('');
    onSaveSalary(amount);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!linking && !salarySaving}
      hideCloseButton
      size="lg"
      title="Editar Recepcionista"
      description="Administra el horario semanal y la cuenta de acceso del colaborador."
    >
      <form className="staff-form" onSubmit={submit} noValidate>
        <SalarySection profile={profile} value={salaryText} error={salaryError} saving={salarySaving} onChange={setSalaryText} />
        <ScheduleSection profileId={profile.id} branchId={branchId} series={series} onNotice={onNotice} />
        {!profile.staff_user_id && (
          <div className="field">
            <label htmlFor="staff-account-select">Vincular cuenta de acceso</label>
            <select id="staff-account-select" value={accountId} onChange={event => setAccountId(event.target.value)} disabled={linking}>
              <option value="">Selecciona una cuenta activa</option>
              {accounts.filter(a => a.is_active && (a.linked_profile_id === null || a.linked_profile_id === profile.id))
                .map(a => <option key={a.id} value={a.id}>{a.login_identifier}</option>)}
            </select>
            <p className="muted">La vinculación se confirma en el servidor y no se infiere por nombre.</p>
          </div>
        )}
        {profile.staff_user_id && <p role="status">La cuenta vinculada no se puede cambiar desde esta pantalla.</p>}
        <div className="field">
          <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Estado del perfil</label>
          <JellyRadio items={[{ value: 'active', label: '● Activo' }, { value: 'inactive', label: '○ Inactivo' }]}
            value={profile.is_active ? 'active' : 'inactive'} size="sm" disabled ariaLabel="Estado del perfil" />
        </div>
        <div className="staff-pin-toggle-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>Configurar PIN de acceso</strong>
              <p className="muted" style={{ fontSize: '12px', margin: '2px 0 0' }}>El estado del PIN no está disponible en la API. Usa la acción de emisión cuando corresponda.</p>
            </div>
            <SquishSwitch checked={false} disabled ariaLabel="Estado de PIN no disponible en API" />
          </div>
        </div>
        {error && <p role="alert" className="staff-pin-error">{error}</p>}
        <div className="staff-modal-actions">
          <Button variant="secondary" disabled={linking} onClick={onClose}>Cancelar</Button>
          {!profile.staff_user_id && (
            <Button variant="primary" disabled={!accountId || linking} onClick={() => onLink(accountId)}>
              {linking ? 'Vinculando…' : 'Vincular cuenta'}
            </Button>
          )}
          <Button variant="primary" type="submit" disabled={profile.monthly_salary_minor === undefined || salarySaving}>
            {salarySaving ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
