import { useState } from 'react';
import { Button, Field } from '@/shared/ui';
import JellyRadio from '@/features/catalog/react-bits/JellyRadio';
import { businessDate } from '@/shared/formatters/date';
import type { StaffScheduleSeriesItem } from '@/api/staffSchedulesApi';
import { OccurrenceList } from './OccurrenceList';
import { activeSeriesFor, useStaffSchedule, type ScheduleFormValues } from './useStaffSchedule';

interface Props {
  profileId: string;
  branchId: string;
  series: StaffScheduleSeriesItem[];
  onNotice: (message: string) => void;
}

const DAYS = [
  { day: 0, label: 'L' }, { day: 1, label: 'M' }, { day: 2, label: 'X' }, { day: 3, label: 'J' },
  { day: 4, label: 'V' }, { day: 5, label: 'S' }, { day: 6, label: 'D' },
];
const labelStyle = { fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' } as const;
type Errors = Partial<Record<'startTime' | 'endTime' | 'startDate', string>>;

function initialForm(active: StaffScheduleSeriesItem | undefined): ScheduleFormValues {
  return {
    weekdays: active?.weekdays.length ? active.weekdays : [0, 1, 2, 3, 4],
    startTime: active ? active.start_time.slice(0, 5) : '06:00',
    endTime: active ? active.end_time.slice(0, 5) : '14:00',
    startDate: active ? active.start_date : businessDate(),
    endDate: active?.end_date ?? '',
    scope: 'this_and_future',
  };
}

export function ScheduleSection({ profileId, branchId, series, onNotice }: Props) {
  const active = activeSeriesFor(series, profileId);
  const schedule = useStaffSchedule(profileId, branchId, active);
  const [form, setForm] = useState(() => initialForm(active));
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState('');
  const busy = schedule.saving || schedule.cancelling;
  const set = <K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K]) => setForm(prev => ({ ...prev, [key]: value }));

  async function run<T>(action: () => Promise<T>, fallback: string, notice: (result: T) => string) {
    setServerError('');
    try {
      const result = await action();
      onNotice(notice(result));
      return true;
    } catch (err) {
      setServerError(err instanceof Error ? err.message : fallback);
      return false;
    }
  }

  function save() {
    const next: Errors = {};
    if (!form.startTime) next.startTime = 'Indica la hora de inicio.';
    if (!form.endTime) next.endTime = 'Indica la hora de fin.';
    if (!form.startDate) next.startDate = 'Indica la fecha de inicio.';
    setErrors(next);
    if (Object.keys(next).length) return;
    void run(() => schedule.save.mutateAsync(form), 'Error al guardar horario.',
      kind => (kind === 'updated' ? 'Horario actualizado correctamente.' : 'Horario asignado correctamente.'));
  }

  const toggleDay = (day: number) => set('weekdays', form.weekdays.includes(day)
    ? (form.weekdays.length > 1 ? form.weekdays.filter(d => d !== day) : form.weekdays)
    : [...form.weekdays, day].sort((a, b) => a - b));

  return (
    <div className="staff-pin-toggle-card" style={{ marginTop: '12px' }}>
      <div>
        <strong>Horario semanal recurrente</strong>
        <p className="muted" style={{ fontSize: '12px', margin: '2px 0 8px' }}>Define los días y horas de turno habituales para este colaborador.</p>
      </div>
      <div style={{ margin: '8px 0' }}>
        <label style={labelStyle}>Días laborales</label>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {DAYS.map(({ day, label }) => {
            const on = form.weekdays.includes(day);
            return (
              <button key={day} type="button" className={`staff-att-pill-btn ${on ? 'active' : ''}`} disabled={busy}
                style={on ? { background: 'var(--color-primary, #FC6C06)', color: '#000', fontWeight: 700 } : undefined}
                onClick={() => toggleDay(day)} aria-label={`Día ${label}`}>{label}</button>
            );
          })}
        </div>
      </div>
      <div className="field-row">
        <Field id="staff-schedule-start-time" label="Hora inicio" type="time" value={form.startTime} error={errors.startTime} disabled={busy} onChange={e => set('startTime', e.target.value)} />
        <Field id="staff-schedule-end-time" label="Hora fin" type="time" value={form.endTime} error={errors.endTime} disabled={busy} onChange={e => set('endTime', e.target.value)} />
      </div>
      <div className="field-row">
        <Field id="staff-schedule-start-date" label="Fecha inicio" type="date" value={form.startDate} error={errors.startDate} disabled={busy} onChange={e => set('startDate', e.target.value)} />
        <Field id="staff-schedule-end-date" label="Fecha fin (opcional)" type="date" value={form.endDate} disabled={busy} onChange={e => set('endDate', e.target.value)} />
      </div>
      {active && (
        <div className="field" style={{ margin: '8px 0' }}>
          <label style={{ ...labelStyle, marginBottom: '6px' }}>Alcance de edición</label>
          <JellyRadio items={[{ value: 'this_and_future', label: 'Esta y futuras' }, { value: 'all_future', label: 'Toda la serie' }]}
            value={form.scope} onChange={val => set('scope', val as ScheduleFormValues['scope'])} size="sm" ariaLabel="Alcance de edición de horario" />
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <Button variant="primary" disabled={busy} onClick={save}>
          {schedule.saving ? 'Guardando horario…' : active ? 'Actualizar horario' : 'Asignar horario'}
        </Button>
        {active && (
          <Button variant="secondary" disabled={busy}
            onClick={() => void run(() => schedule.cancel.mutateAsync(), 'Error al cancelar horario.', () => 'Serie de horario cancelada.')}>
            {schedule.cancelling ? 'Cancelando…' : 'Cancelar serie futura'}
          </Button>
        )}
      </div>
      {serverError && <p role="alert" className="staff-pin-error" style={{ marginTop: '8px' }}>{serverError}</p>}
      {active && schedule.occurrences.length > 0 && (
        <OccurrenceList
          occurrences={schedule.occurrences}
          busy={schedule.exceptionSaving}
          onSkip={date => void run(() => schedule.skip.mutateAsync(date), 'Error al omitir ocurrencia.', () => `Ocurrencia del ${date} omitida.`)}
          onOverride={(date, startTime, endTime) => run(() => schedule.override.mutateAsync({ localDate: date, startTime, endTime }),
            'Error al cambiar horario de la ocurrencia.', () => `Horario modificado para el ${date}.`)}
        />
      )}
    </div>
  );
}
