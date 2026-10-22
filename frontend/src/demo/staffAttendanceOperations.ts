import type { DemoState, StaffAttendanceRecord } from '../domain/models';
import type { Transaction } from './operations';

export interface ClockInParams {
  staffId: string;
  staffName: string;
  roleOrDepartment?: string;
  recordedBy: string;
  notes?: string;
  clockInAt?: string;
  shiftId?: string;
}

export interface ClockOutParams {
  staffId: string;
  clockOutAt?: string;
  notes?: string;
}

export type StaffAttendanceResult =
  | { status: 'ok'; record: StaffAttendanceRecord }
  | { status: 'error'; message: string };

export function isStaffClockedIn(record: StaffAttendanceRecord): boolean {
  return !record.clockOutAt && !record.clock_out_at;
}

export function getActiveStaffAttendance(
  records: readonly StaffAttendanceRecord[] | undefined,
  staffId: string
): StaffAttendanceRecord | undefined {
  if (!records) return undefined;
  return records.find(r => r.staffId === staffId && isStaffClockedIn(r));
}

export function getStaffAttendanceStatus(
  records: readonly StaffAttendanceRecord[] | undefined,
  staffId: string
): { isClockedIn: boolean; activeRecord?: StaffAttendanceRecord; lastRecord?: StaffAttendanceRecord } {
  if (!records || records.length === 0) {
    return { isClockedIn: false };
  }
  const staffRecords = records.filter(r => r.staffId === staffId);
  const activeRecord = staffRecords.find(isStaffClockedIn);
  const lastRecord = staffRecords[staffRecords.length - 1];

  return {
    isClockedIn: Boolean(activeRecord),
    activeRecord,
    lastRecord,
  };
}

export function recordStaffClockIn(
  state: DemoState,
  params: ClockInParams
): Transaction<StaffAttendanceResult> {
  const currentAttendance = state.staffAttendance ?? [];
  const existingActive = getActiveStaffAttendance(currentAttendance, params.staffId);

  if (existingActive) {
    return {
      state,
      result: {
        status: 'error',
        message: `${params.staffName} ya tiene una entrada activa registrada.`,
      },
    };
  }

  const nowIso = params.clockInAt ?? new Date().toISOString();
  const id = `staff-att-${crypto.randomUUID()}`;

  const record: StaffAttendanceRecord = {
    id,
    staffId: params.staffId,
    staffName: params.staffName,
    roleOrDepartment: params.roleOrDepartment,
    clockInAt: nowIso,
    clock_in_at: nowIso,
    clockOutAt: null,
    clock_out_at: null,
    recordedBy: params.recordedBy,
    recorded_by: params.recordedBy,
    notes: params.notes?.trim() || undefined,
    shiftId: params.shiftId ?? state.currentShiftId,
  };

  const nextState: DemoState = {
    ...state,
    revision: state.revision + 1,
    staffAttendance: [...currentAttendance, record],
  };

  return {
    state: nextState,
    result: {
      status: 'ok',
      record,
    },
  };
}

export function recordStaffClockOut(
  state: DemoState,
  params: ClockOutParams
): Transaction<StaffAttendanceResult> {
  const currentAttendance = state.staffAttendance ?? [];
  const activeIndex = currentAttendance.findIndex(
    r => r.staffId === params.staffId && isStaffClockedIn(r)
  );

  if (activeIndex === -1) {
    return {
      state,
      result: {
        status: 'error',
        message: 'No se encontró un turno activo para este empleado.',
      },
    };
  }

  const activeRecord = currentAttendance[activeIndex];
  const nowIso = params.clockOutAt ?? new Date().toISOString();

  const updatedRecord: StaffAttendanceRecord = {
    ...activeRecord,
    clockOutAt: nowIso,
    clock_out_at: nowIso,
    notes: params.notes?.trim()
      ? activeRecord.notes
        ? `${activeRecord.notes} | Salida: ${params.notes.trim()}`
        : params.notes.trim()
      : activeRecord.notes,
  };

  const updatedAttendance = [...currentAttendance];
  updatedAttendance[activeIndex] = updatedRecord;

  const nextState: DemoState = {
    ...state,
    revision: state.revision + 1,
    staffAttendance: updatedAttendance,
  };

  return {
    state: nextState,
    result: {
      status: 'ok',
      record: updatedRecord,
    },
  };
}
