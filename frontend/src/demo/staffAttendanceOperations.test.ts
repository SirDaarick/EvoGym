import { describe, expect, it } from 'vitest';
import { createBaselineDemoState } from './adapter';
import {
  getActiveStaffAttendance,
  getStaffAttendanceStatus,
  recordStaffClockIn,
  recordStaffClockOut,
} from './staffAttendanceOperations';

describe('staffAttendanceOperations', () => {
  it('records staff clock in with clock_in_at, recorded_by, and optional notes', () => {
    const initialState = createBaselineDemoState();
    const result = recordStaffClockIn(initialState, {
      staffId: 'staff-charly',
      staffName: 'Charly',
      roleOrDepartment: 'Entrenador',
      recordedBy: 'Sheila',
      notes: 'Llegó 15 min tarde con justificante',
      clockInAt: '2026-10-08T08:15:00-06:00',
    });

    expect(result.result.status).toBe('ok');
    if (result.result.status === 'ok') {
      expect(result.result.record.staffId).toBe('staff-charly');
      expect(result.result.record.staffName).toBe('Charly');
      expect(result.result.record.roleOrDepartment).toBe('Entrenador');
      expect(result.result.record.clock_in_at).toBe('2026-10-08T08:15:00-06:00');
      expect(result.result.record.clockInAt).toBe('2026-10-08T08:15:00-06:00');
      expect(result.result.record.recorded_by).toBe('Sheila');
      expect(result.result.record.recordedBy).toBe('Sheila');
      expect(result.result.record.notes).toBe('Llegó 15 min tarde con justificante');
      expect(result.result.record.clockOutAt).toBeNull();
      expect(result.result.record.clock_out_at).toBeNull();
    }

    const nextState = result.state;
    expect(nextState.staffAttendance?.length).toBe(
      (initialState.staffAttendance?.length ?? 0) + 1
    );

    const status = getStaffAttendanceStatus(nextState.staffAttendance, 'staff-charly');
    expect(status.isClockedIn).toBe(true);
    expect(status.activeRecord?.staffId).toBe('staff-charly');
  });

  it('rejects double clock in for staff already in turn', () => {
    const initialState = createBaselineDemoState();
    const first = recordStaffClockIn(initialState, {
      staffId: 'staff-charly',
      staffName: 'Charly',
      recordedBy: 'Sheila',
    });

    const second = recordStaffClockIn(first.state, {
      staffId: 'staff-charly',
      staffName: 'Charly',
      recordedBy: 'Emigdio',
    });

    expect(second.result.status).toBe('error');
    if (second.result.status === 'error') {
      expect(second.result.message).toContain('ya tiene una entrada activa');
    }
  });

  it('records staff clock out and marks employee out of turn', () => {
    const initialState = createBaselineDemoState();
    const clockedIn = recordStaffClockIn(initialState, {
      staffId: 'staff-silvia',
      staffName: 'Silvia',
      roleOrDepartment: 'Mantenimiento',
      recordedBy: 'Sheila',
      clockInAt: '2026-10-08T06:30:00-06:00',
    });

    const clockedOut = recordStaffClockOut(clockedIn.state, {
      staffId: 'staff-silvia',
      clockOutAt: '2026-10-08T14:30:00-06:00',
    });

    expect(clockedOut.result.status).toBe('ok');
    if (clockedOut.result.status === 'ok') {
      expect(clockedOut.result.record.clockOutAt).toBe('2026-10-08T14:30:00-06:00');
      expect(clockedOut.result.record.clock_out_at).toBe('2026-10-08T14:30:00-06:00');
    }

    const status = getStaffAttendanceStatus(clockedOut.state.staffAttendance, 'staff-silvia');
    expect(status.isClockedIn).toBe(false);
    expect(status.lastRecord?.clockOutAt).toBe('2026-10-08T14:30:00-06:00');
  });

  it('returns error when attempting clock out without active shift', () => {
    const initialState = createBaselineDemoState();
    const result = recordStaffClockOut(initialState, {
      staffId: 'non-clocked-in',
    });

    expect(result.result.status).toBe('error');
  });
});
