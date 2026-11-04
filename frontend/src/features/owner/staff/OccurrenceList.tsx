import { useState } from 'react';
import { Button } from '@/shared/ui';
import type { StaffScheduleOccurrenceItem } from '@/api/staffSchedulesApi';

interface Props {
  occurrences: StaffScheduleOccurrenceItem[];
  busy: boolean;
  onSkip: (localDate: string) => void;
  onOverride: (localDate: string, startTime: string, endTime: string) => Promise<boolean>;
}

const small = { fontSize: '11px', padding: '2px 8px' } as const;

export function OccurrenceList({ occurrences, busy, onSkip, onOverride }: Props) {
  const [overridingDate, setOverridingDate] = useState<string | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState('');

  async function save(localDate: string) {
    if (!start || !end) { setError('Indica la hora de inicio y fin.'); return; }
    setError('');
    if (await onOverride(localDate, start, end)) setOverridingDate(null);
  }

  return (
    <div style={{ marginTop: '16px', borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
      <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--color-muted)' }}>Próximas ocurrencias (7 días)</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {occurrences.map(occ => {
          const editing = overridingDate === occ.local_date;
          return (
            <div key={occ.local_date} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--color-canvas, #1a1a1a)', borderRadius: '6px', fontSize: '12px' }}>
              <span>
                <strong>{occ.local_date}</strong> · {occ.local_start.slice(11, 16)}–{occ.local_end.slice(11, 16)}
                {occ.recorded_exception === 'skip' && <span className="badge badge-neutral" style={{ marginLeft: '6px', fontSize: '10px' }}>Omitida</span>}
                {occ.recorded_exception === 'override' && <span className="badge badge-warning" style={{ marginLeft: '6px', fontSize: '10px' }}>Hora cambiada</span>}
              </span>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                {editing ? <>
                  <input type="time" value={start} onChange={e => setStart(e.target.value)} aria-label="Hora inicio excepción"
                    aria-invalid={Boolean(error) && !start} style={{ fontSize: '11px', padding: '2px 4px' }} />
                  <span>–</span>
                  <input type="time" value={end} onChange={e => setEnd(e.target.value)} aria-label="Hora fin excepción"
                    aria-invalid={Boolean(error) && !end} style={{ fontSize: '11px', padding: '2px 4px' }} />
                  <Button variant="primary" disabled={busy} onClick={() => void save(occ.local_date)} style={small}>Guardar</Button>
                  <Button variant="secondary" disabled={busy} onClick={() => { setOverridingDate(null); setError(''); }} style={small}>Cancelar</Button>
                </> : <>
                  <Button variant="secondary" disabled={busy || occ.recorded_exception === 'skip'} onClick={() => onSkip(occ.local_date)} style={small}>Omitir</Button>
                  <Button variant="secondary" disabled={busy} style={small} onClick={() => {
                    setOverridingDate(occ.local_date);
                    setStart(occ.local_start.slice(11, 16));
                    setEnd(occ.local_end.slice(11, 16));
                    setError('');
                  }}>Cambiar hora</Button>
                </>}
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="field-error" style={{ marginTop: '6px' }}>{error}</p>}
    </div>
  );
}
