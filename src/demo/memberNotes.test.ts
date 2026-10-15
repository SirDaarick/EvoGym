import { describe, expect, it } from 'vitest';
import { addMemberNote, membershipRenewalStreak, membershipHistory } from './memberNotes';
import type { MembershipPayment } from '../domain/models';
const payment = (id: string, date: string): MembershipPayment => ({ id, memberId: 'm', planId: 'p', planName: 'Plan', amountMinor: 100, method: 'cash', status: 'paid', recordedAt: `${date}T12:00:00-06:00`, shiftId: 's', effectiveDates: null });
describe('member notes and membership history', () => {
  it('snapshots the selected employee and recorded timestamp for a note', () => {
    const note = addMemberNote([], { memberId: 'm', body: 'Follow up', authorId: 'recep-1', authorName: 'Valeria M.', createdAt: '2026-10-08T12:00:00-06:00', id: 'n1' });
    expect(note[0]).toMatchObject({ memberId: 'm', body: 'Follow up', authorId: 'recep-1', authorName: 'Valeria M.', createdAt: '2026-10-08T12:00:00-06:00' });
  });
  it('uses paid member-attributed records and breaks renewal streaks across missing months', () => {
    const records: MembershipPayment[] = [payment('a', '2026-10-01'), payment('b', '2026-09-01'), payment('c', '2026-07-01'), { ...payment('x','2026-08-01'), status: 'pending' }, { ...payment('u','2026-10-01'), memberId: 'other' }];
    expect(membershipHistory(records, 'm')).toHaveLength(3);
    expect(membershipRenewalStreak(records, 'm')).toBe(2);
    expect(membershipRenewalStreak([payment('a', '2026-10-01'), payment('b','2026-08-01')], 'm')).toBe(1);
  });
});
