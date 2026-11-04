import { Field } from '@/shared/ui';
import type { AdminRosterProfileChoice } from '@/api/staffCredentialsApi';

interface Props {
  profile: AdminRosterProfileChoice;
  value: string;
  error: string;
  saving: boolean;
  onChange: (value: string) => void;
}

export function SalarySection({ profile, value, error, saving, onChange }: Props) {
  const unavailable = profile.monthly_salary_minor === undefined;
  return (
    <>
      <Field id="staff-name-input" label="Nombre completo *" value={profile.full_name} readOnly />
      <div className="field-row">
        <Field id="staff-salary-input" label="Sueldo mensual (MXN) *" type="text" disabled={unavailable || saving}
          value={unavailable ? 'No disponible en API' : value} error={error} onChange={event => onChange(event.target.value)} />
      </div>
    </>
  );
}
