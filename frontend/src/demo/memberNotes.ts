import type { MemberNote } from '../domain/models';

export function addMemberNote(notes: MemberNote[], input: Omit<MemberNote, 'id'> & { id?: string }): MemberNote[] {
  return [{ ...input, id: input.id ?? crypto.randomUUID() }, ...notes];
}

export { membershipHistory, membershipRenewalStreak } from '../domain/membership';
