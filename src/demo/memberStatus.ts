import type { Member } from '../domain/models';

export type MemberStatus = 'active' | 'inactive' | 'unknown';
export const memberStatusLabels: Record<MemberStatus, string> = {
  active: 'Activos · demo', inactive: 'Inactivos · demo', unknown: 'Sin confirmar',
};

export function memberStatus(member: Member): { status: MemberStatus; label: string; provisional: boolean } {
  // Scenarios are explicit role-play fixtures, never eligibility inferred from dates.
  switch (member.demoScenario) {
    case 'active': return { status: 'active', label: 'Activa · demo', provisional: false };
    case 'expired': return { status: 'inactive', label: 'Vencida · demo', provisional: false };
    case 'expiry-today': return { status: 'active', label: 'Vence hoy · provisional', provisional: true };
    default: return { status: 'unknown', label: 'Sin confirmar', provisional: false };
  }
}

export function memberSearchGroups(members: readonly Member[], query: string) {
  const normalized = query.trim().toLocaleLowerCase('es-MX');
  const matches = normalized ? members.filter(member => `${member.name} ${member.phone} ${member.id}`.toLocaleLowerCase('es-MX').includes(normalized)) : [];
  return (['active', 'inactive', 'unknown'] as const).map(status => ({ status,
    members: matches.filter(member => memberStatus(member).status === status),
  }));
}
