import type { AttendanceVisit, DemoState } from '../domain/models';
import type { Transaction } from './operations';
import type { OperationResult } from './inventoryOperations';
import { memberStatus } from './memberStatus';

export const demoGymTimezone = 'America/Mexico_City';
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: demoGymTimezone, year: 'numeric', month: '2-digit', day: '2-digit' });
export function attendanceDay(value: string) {
  if (!Number.isFinite(Date.parse(value))) return null;
  const parts = dayFormatter.formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
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
const fail = (state: DemoState, message: string): Transaction<OperationResult> => ({ state, result: { status: 'error', message } });
function validClock(state: DemoState, now: string) {
  return Number.isFinite(Date.parse(now)) && Date.parse(now) >= Date.parse(state.demoClock);
}
function reconciledVisits(state: DemoState, now: string) {
  return state.attendance.map(visit => {
    const boundary = attendanceClosing(visit.observedCheckIn);
    return openAttendance(visit) && boundary && Date.parse(boundary) >= Date.parse(visit.observedCheckIn) && Date.parse(boundary) <= Date.parse(now)
      ? { ...visit, autoClosedAt: boundary } : visit;
  });
}
export function advanceAttendanceClock(state: DemoState, now: string): Transaction<OperationResult> {
  if (!validClock(state, now)) return fail(state, 'La hora no puede retroceder ni ser inválida.');
  return { state: { ...state, demoClock: new Date(now).toISOString(), revision: state.revision + 1,
    attendance: reconciledVisits(state, now) }, result: { status: 'ok' } };
}
export function enterMember(state: DemoState, request: { id: string; memberId: string; now: string }): Transaction<OperationResult> {
  if (!validClock(state, request.now)) return fail(state, 'Revisa la hora.');
  const member = state.members.find(item => item.id === request.memberId);
  if (!member || memberStatus(member).status !== 'active') return fail(state, 'Renueva la membresía antes de registrar la entrada.');
  if (member.demoScenario === 'expiry-today' && !state.attendancePolicy.allowExpiryDay) return fail(state, 'Q-01: entrada en vencimiento desactivada.');
  if (!request.id.trim() || state.attendance.some(visit => visit.id === request.id)) return fail(state, 'Referencia de asistencia no disponible.');
  const day = attendanceDay(request.now)!;
  if (Date.parse(request.now) >= Date.parse(attendanceClosing(request.now)!)) return fail(state, 'Q-09: no se registran entradas después del cierre.');
  const visits = reconciledVisits(state, request.now);
  if (visits.some(visit => visit.memberId === member.id && openAttendance(visit))) return fail(state, 'El socio ya tiene una entrada abierta.');
  if (!state.attendancePolicy.allowRepeatVisits && visits.some(visit => visit.memberId === member.id && attendanceDay(visit.observedCheckIn) === day)) return fail(state, 'Q-03: las visitas repetidas están desactivadas.');
  return { state: { ...state, demoClock: new Date(request.now).toISOString(), revision: state.revision + 1,
    attendance: [...visits, { id: request.id, memberId: member.id, observedCheckIn: new Date(request.now).toISOString(), observedCheckOut: null, autoClosedAt: null }] }, result: { status: 'ok' } };
}
export function exitMember(state: DemoState, memberId: string, now: string): Transaction<OperationResult> {
  if (!validClock(state, now)) return fail(state, 'La salida no puede preceder a la entrada.');
  const visits = reconciledVisits(state, now);
  const open = visits.find(visit => visit.memberId === memberId && openAttendance(visit));
  if (!open || Date.parse(now) < Date.parse(open.observedCheckIn)) return fail(state, 'No hay una visita abierta para registrar salida.');
  return { state: { ...state, demoClock: new Date(now).toISOString(), revision: state.revision + 1,
    attendance: visits.map(visit => visit.id === open.id ? { ...visit, observedCheckOut: new Date(now).toISOString() } : visit) }, result: { status: 'ok' } };
}
