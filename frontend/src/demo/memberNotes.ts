import type { MemberNote, MembershipPayment } from '../domain/models';

export function addMemberNote(notes: MemberNote[], input: Omit<MemberNote, 'id'> & { id?: string }): MemberNote[] {
  return [{ ...input, id: input.id ?? crypto.randomUUID() }, ...notes];
}

export function membershipHistory(payments: MembershipPayment[], memberId: string): MembershipPayment[] {
  return payments.filter(payment => payment.memberId === memberId && payment.status === 'paid')
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

export function membershipRenewalStreak(payments: MembershipPayment[], memberId: string): number {
  const months = [...new Set(membershipHistory(payments, memberId).map(payment => payment.recordedAt.slice(0, 7)))].sort().reverse();
  if (!months.length) return 0;
  let streak = 1;
  let [year, month] = months[0].split('-').map(Number);
  for (const key of months.slice(1)) {
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
    if (key !== `${year}-${String(month).padStart(2, '0')}`) break;
    streak += 1;
  }
  return streak;
}
