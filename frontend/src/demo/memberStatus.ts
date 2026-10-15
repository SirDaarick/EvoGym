import type { Member } from '../domain/models';

export type MemberStatus = 'active' | 'expired' | 'inactive' | 'unknown';
export const memberStatusLabels: Record<MemberStatus, string> = {
  active: 'Activos',
  expired: 'Vencidos',
  inactive: 'Inactivos',
  unknown: 'Sin confirmar',
};

export function memberStatus(
  member: Member,
  referenceDate?: string | Date,
): { status: MemberStatus; label: string; provisional: boolean } {
  // Scenarios are explicit role-play fixtures, never eligibility inferred from dates.
  if (member.demoScenario) {
    switch (member.demoScenario) {
      case 'active':
        return { status: 'active', label: 'Activa', provisional: false };
      case 'expiry-today':
        return { status: 'active', label: 'Vence hoy · provisional', provisional: true };
      case 'expired':
        return { status: 'expired', label: 'Vencida', provisional: false };
      case 'unknown':
      default:
        return { status: 'unknown', label: 'Sin confirmar', provisional: false };
    }
  }

  // When referenceDate is provided or dates evaluated
  if (referenceDate !== undefined) {
    if (!member.membership) {
      return { status: 'inactive', label: 'Inactiva', provisional: false };
    }

    const ref = typeof referenceDate === 'string' ? new Date(referenceDate) : new Date(referenceDate);
    const endsOn = new Date(member.membership.endsOn);
    const diffMs = ref.getTime() - endsOn.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) {
      return { status: 'active', label: 'Activa', provisional: false };
    } else if (diffDays <= 31) {
      return { status: 'expired', label: 'Vencida', provisional: false };
    } else {
      return { status: 'inactive', label: 'Inactiva', provisional: false };
    }
  }

  // If referenceDate is omitted and no demoScenario, default to unknown to preserve existing tests.
  return { status: 'unknown', label: 'Sin confirmar', provisional: false };
}

export function memberSearchGroups(
  members: readonly Member[],
  query: string,
  referenceDate?: string | Date,
  includeAllOnEmpty = false,
) {
  const isWhitespace = query.length > 0 && query.trim() === '';
  const normalized = query.trim().toLocaleLowerCase('es-MX');

  let matches: readonly Member[] = [];
  if (isWhitespace) {
    matches = [];
  } else if (!normalized && includeAllOnEmpty) {
    matches = members;
  } else if (normalized) {
    matches = members.filter(member =>
      `${member.name} ${member.phone} ${member.id}`.toLocaleLowerCase('es-MX').includes(normalized),
    );
  }

  return (['active', 'expired', 'inactive', 'unknown'] as const).map(status => ({
    status,
    members: matches.filter(member => memberStatus(member, referenceDate).status === status),
  }));
}
