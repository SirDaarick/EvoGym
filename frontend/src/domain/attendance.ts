import type { AttendanceVisit } from './models';
import { GYM_TIME_ZONE, businessDate } from '../shared/formatters/date';

export const demoGymTimezone = GYM_TIME_ZONE;
export function attendanceDay(value: string) {
  if (!Number.isFinite(Date.parse(value))) return null;
  return businessDate(new Date(value));
}
export function attendanceClosing(value: string) {
  const day = attendanceDay(value);
  // The controlled 2026 Mexico City demo uses UTC-06. Other gym zones remain Q-02.
  return day ? new Date(`${day}T22:00:00-06:00`).toISOString() : null;
}
export function attendanceDuration(visit: AttendanceVisit): number | null {
  if (!visit.observedCheckOut || visit.autoClosedAt) return null;
  const difference = Date.parse(visit.observedCheckOut) - Date.parse(visit.observedCheckIn);
  return Number.isFinite(difference) && difference >= 0 ? difference / 60000 : null;
}
export function openAttendance(visit: AttendanceVisit) { return !visit.observedCheckOut && !visit.autoClosedAt; }

export type AttendancePeriod = 'today' | 'week' | 'month';

export const GYM_CAPACITY = 50;

export const DAYS_SPANISH = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

export const DAYS_SHORT_SPANISH = [
  'Lun',
  'Mar',
  'Mié',
  'Jue',
  'Vie',
  'Sáb',
  'Dom',
] as const;
