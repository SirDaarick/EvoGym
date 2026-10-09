import { useState } from 'react';
import type { AttendanceVisit } from '../../domain/models';
import { attendanceDay, attendanceDuration } from '../../demo/attendanceOperations';

export function AttendanceCalendar({ visits, now }: { visits: AttendanceVisit[]; now: string }) {
  const [selected, setSelected] = useState('');
  const endDay = attendanceDay(now)!;
  const end = Date.parse(`${endDay}T12:00:00-06:00`);
  const days = Array.from({ length: 84 }, (_, index) => {
    const day = attendanceDay(new Date(end - (83 - index) * 86400000).toISOString())!;
    const items = visits.filter(visit => attendanceDay(visit.observedCheckIn) === day);
    const minutes = items.reduce((sum, visit) => sum + (attendanceDuration(visit) ?? 0), 0);
    const unknown = items.filter(visit => attendanceDuration(visit) === null).length;
    return { day, count: items.length, minutes, unknown, label: `${day}: ${items.length} visitas, ${minutes} min medidos, ${unknown} duración desconocida` };
  });
  const relevant = days.filter(day => day.count);
  return <section className="attendance-calendar" aria-label="Frecuencia de asistencia demo">
    <h2>Frecuencia de asistencia</h2>
    <p>{relevant.length} días con asistencia · {relevant.reduce((sum, day) => sum + day.count, 0)} visitas</p>
    <p>{relevant.reduce((sum, day) => sum + day.minutes, 0)} min medidos · {relevant.reduce((sum, day) => sum + day.unknown, 0)} visitas con duración desconocida</p>
    <p className="muted">Últimas 12 semanas · Más naranja significa más visitas, no más tiempo. Los registros iniciales son ejemplos ficticios.</p>
    <div className="attendance-grid">{days.map(day => <button type="button" key={day.day} className={`attendance-day attendance-level-${Math.min(day.count, 3)}`}
      aria-label={day.label} title={day.label} onFocus={() => setSelected(day.label)} onClick={() => setSelected(day.label)}>{day.count || <span aria-hidden="true">·</span>}</button>)}</div>
    <p className="muted">Leyenda: · sin visitas · 1, 2, 3+ visitas. Duración desconocida no significa cero.</p>
    <p role="status" aria-label="Detalle del día">{selected || 'Selecciona un día para ver su detalle.'}</p>
  </section>;
}
