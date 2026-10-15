import { describe, expect, it } from 'vitest';
import { createDemoState } from './adapter';
import { enterMember, exitMember, advanceAttendanceClock, attendanceDuration, attendanceDay } from './attendanceOperations';

const noon = '2026-10-08T12:00:00-06:00';
const later = '2026-10-08T12:30:00-06:00';
describe('controlled demo attendance', () => {
  it('records entry and observed exit with measured time, never overlapping entries', () => {
    const first = enterMember(createDemoState(), { id: 'visit', memberId: 'demo-active', now: noon });
    expect(first.result.status).toBe('ok');
    expect(enterMember(first.state, { id: 'double', memberId: 'demo-active', now: noon }).state).toBe(first.state);
    const done = exitMember(first.state, 'demo-active', later);
    expect(attendanceDuration(done.state.attendance.find(item => item.id === 'visit')!)).toBe(30);
    expect(exitMember(first.state, 'demo-active', '2026-10-08T11:00:00-06:00').state).toBe(first.state);
  });
  it('gates only new entry on scenario and provisional policy, never traps exit', () => {
    const initial = createDemoState();
    for (const memberId of ['missing', 'demo-expired', 'demo-001', 'demo-unknown']) expect(enterMember(initial, { id: 'v', memberId, now: noon }).state).toBe(initial);
    const expiryBlocked = { ...initial, attendancePolicy: { ...initial.attendancePolicy, allowExpiryDay: false } };
    expect(enterMember(expiryBlocked, { id: 'v', memberId: 'demo-expiry', now: noon }).state).toBe(expiryBlocked);
    const first = enterMember(initial, { id: 'v', memberId: 'demo-expiry', now: noon }).state;
    const changed = { ...first, attendancePolicy: { ...first.attendancePolicy, allowExpiryDay: false } };
    expect(exitMember(changed, 'demo-expiry', later).result.status).toBe('ok');
    const expiredWhileInside = { ...first, members: first.members.map(member => member.id === 'demo-expiry' ? { ...member, demoScenario: 'expired' as const } : member) };
    expect(exitMember(expiredWhileInside, 'demo-expiry', later).result.status).toBe('ok');
  });
  it('tries multiple visits as provisional policy and rejects invalid clocks', () => {
    const initial = createDemoState();
    const entered = enterMember(initial, { id: 'one', memberId: 'demo-active', now: noon }).state;
    const done = exitMember(entered, 'demo-active', later).state;
    expect(enterMember(done, { id: 'two', memberId: 'demo-active', now: later }).result.status).toBe('ok');
    const limited = { ...done, attendancePolicy: { ...done.attendancePolicy, allowRepeatVisits: false } };
    expect(enterMember(limited, { id: 'two', memberId: 'demo-active', now: later }).state).toBe(limited);
    expect(advanceAttendanceClock(done, 'bad').state).toBe(done);
    expect(attendanceDay('2026-10-09T05:59:00Z')).toBe('2026-10-08');
    expect(attendanceDay('2026-10-09T06:00:00Z')).toBe('2026-10-09');
    expect(enterMember(initial, { id: 'one', memberId: 'demo-active', now: '2026-10-08T22:00:00-06:00' }).result.status).toBe('error');
  });
  it('closes at 22:00 with unknown duration including overdue prior-day visits', () => {
    const entered = enterMember(createDemoState(), { id: 'one', memberId: 'demo-active', now: noon }).state;
    const closed = advanceAttendanceClock(entered, '2026-10-09T12:00:00-06:00');
    const visit = closed.state.attendance.find(item => item.id === 'one')!;
    expect(visit.observedCheckOut).toBeNull();
    expect(visit.autoClosedAt).toBe('2026-10-09T04:00:00.000Z');
    expect(attendanceDuration(visit)).toBeNull();
    expect(attendanceDuration({ ...visit, autoClosedAt: null, observedCheckOut: '2026-10-08T11:00:00-06:00' })).toBeNull();
    expect(exitMember(closed.state, 'demo-active', closed.state.demoClock).result.status).toBe('error');
  });
});
