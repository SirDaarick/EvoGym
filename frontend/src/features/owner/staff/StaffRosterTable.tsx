import { formatMoney } from '@/shared/formatters/money';
import { addDays } from '@/shared/formatters/date';
import { Button } from '@/shared/ui';
import { formatScheduleSummary, type StaffScheduleSeriesItem } from '@/api/staffSchedulesApi';
import type { PayrollItem, PayrollWeek } from '@/api/payrollApi';
import type { AdminRosterProfileChoice, AdminStaffAccountChoice } from '@/api/staffCredentialsApi';
import { activeSeriesFor } from './useStaffSchedule';
import { profileInitials } from './utils';

export interface StaffRosterTableProps {
  profiles: AdminRosterProfileChoice[];
  accounts: AdminStaffAccountChoice[];
  series: StaffScheduleSeriesItem[];
  payroll: PayrollWeek | null;
  payrollWeekStart: string | null;
  emptyMessage: string;
  pinIssuingId: string | null;
  deactivationBusy: boolean;
  onPayroll: (item: PayrollItem, mode: 'advance' | 'pay', targetWeek?: string) => void;
  onIssuePin: (profile: AdminRosterProfileChoice) => void;
  onPairDevice: (profile: AdminRosterProfileChoice) => void;
  onEdit: (profile: AdminRosterProfileChoice) => void;
  onDeactivation: (profile: AdminRosterProfileChoice, active: boolean) => void;
}

function payrollStatus(item: PayrollItem): string {
  if (!item.paid) return `Pendiente ${formatMoney(item.net_minor)} netos`;
  return item.advances_minor > 0
    ? `Pagado ${formatMoney(item.net_minor)} + ${formatMoney(item.advances_minor)} (adelanto)`
    : `Pagado ${formatMoney(item.net_minor)}`;
}

function PayrollActions({ item, weekStart, onPayroll }: { item: PayrollItem; weekStart: string; onPayroll: StaffRosterTableProps['onPayroll'] }) {
  if (item.paid) {
    return <Button variant="secondary" onClick={() => onPayroll(item, 'advance', addDays(weekStart, 7))}>Adelantar próx. semana</Button>;
  }
  return (
    <>
      {item.net_minor > 0 && <Button variant="secondary" onClick={() => onPayroll(item, 'advance')}>Adelantar</Button>}
      <Button variant="secondary" onClick={() => onPayroll(item, 'pay')}>Pagar {formatMoney(item.net_minor)}</Button>
    </>
  );
}

export function StaffRosterTable(props: StaffRosterTableProps) {
  const { profiles, accounts, series, payroll, payrollWeekStart, pinIssuingId, deactivationBusy } = props;
  return (
    <div className="table-region staff-table-region" role="region" aria-label="Listado de recepcionistas">
      <table className="staff-table">
        <thead>
          <tr><th>Recepcionista</th><th>Turno</th><th>Sueldo mensual</th><th>Credencial</th><th>Estado</th><th style={{ textAlign: 'right' }}>Acciones</th></tr>
        </thead>
        <tbody>
          {profiles.length === 0 ? (
            <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--color-muted)' }}>{props.emptyMessage}</td></tr>
          ) : profiles.map(profile => {
            const account = profile.staff_user_id
              ? accounts.find(row => row.id === profile.staff_user_id && row.linked_profile_id === profile.id)
              : undefined;
            const item = payroll?.items.find(row => row.profile_id === profile.id);
            return (
              <tr key={profile.id}>
                <td>
                  <div className="staff-cell">
                    <div className="staff-avatar staff-avatar-recep" aria-hidden="true">{profileInitials(profile.full_name)}</div>
                    <div className="staff-info">
                      <strong>{profile.full_name}</strong>
                      <span className="muted">{profile.position} · ID: {profile.id}</span>
                      {account && <span className="muted">Cuenta: {account.login_identifier} · {account.is_active ? 'Activa' : 'Inactiva'}</span>}
                    </div>
                  </div>
                </td>
                <td>{formatScheduleSummary(activeSeriesFor(series, profile.id))}</td>
                <td>
                  <span className="staff-salary-cell">
                    <strong>{profile.monthly_salary_minor === undefined ? 'No disponible en API' : formatMoney(profile.monthly_salary_minor)}</strong>
                    {item && <span className="muted payroll-status">{payrollStatus(item)}</span>}
                  </span>
                </td>
                <td>No disponible en API</td>
                <td><span className={`badge ${profile.is_active ? 'badge-success' : 'badge-neutral'}`}>{profile.is_active ? '● Activo' : '○ Inactivo'}</span></td>
                <td>
                  <div style={{ display: 'inline-flex', gap: '8px', justifyContent: 'flex-end', width: '100%', flexWrap: 'wrap' }}>
                    {item && payrollWeekStart && <PayrollActions item={item} weekStart={payrollWeekStart} onPayroll={props.onPayroll} />}
                    <Button variant="secondary" disabled={!profile.staff_user_id || pinIssuingId === profile.id}
                      onClick={() => props.onIssuePin(profile)} title={profile.staff_user_id ? 'Emitir PIN inicial desde la API' : 'Vincula una cuenta antes de emitir el PIN'}>
                      {pinIssuingId === profile.id ? 'Emitiendo…' : 'Emitir PIN'}
                    </Button>
                    <Button variant="secondary" disabled={!account?.is_active || !profile.is_active}
                      onClick={() => props.onPairDevice(profile)} title="Gestionar dispositivos vinculados desde la API">Vincular Dispositivo</Button>
                    <Button variant="secondary" onClick={() => props.onEdit(profile)}>Editar</Button>
                    <Button variant="secondary" disabled={!account || deactivationBusy}
                      onClick={() => props.onDeactivation(profile, Boolean(account?.is_active))}>
                      {account?.is_active ? 'Desactivar cuenta' : 'Consultar venta pendiente'}
                    </Button>
                    <Button variant="secondary" disabled title="La activación y desactivación aún no están disponibles en la API.">
                      {profile.is_active ? 'Desactivar' : 'Activar'}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
