/**
 * Typed TanStack Query key factories. Every key starts with a domain root
 * (`.all`) so `invalidateQueries({ queryKey: queryKeys.inventory.all })` works.
 * Keys are scoped by identity so cached data never leaks between principals.
 */
type Id = string | null | undefined;
const who = (identityId: Id) => identityId ?? 'anon';

export const queryKeys = {
  branches: (identityId: Id) => ['branches', who(identityId)] as const,
  cashRegisters: (identityId: Id, branchId: string) => ['cashRegisters', who(identityId), branchId] as const,
  inventory: {
    all: ['inventory'] as const,
    stock: (identityId: Id, branchId: string) => ['inventory', 'stock', who(identityId), branchId] as const,
  },
  members: {
    all: ['members'] as const,
    search: (identityId: Id, query: string) => ['members', 'search', who(identityId), query] as const,
    detail: (identityId: Id, memberId: string) => ['members', 'detail', who(identityId), memberId] as const,
  },
  productSales: {
    all: ['productSales'] as const,
    pending: (identityId: Id, actorId: string) => ['productSales', 'pending', who(identityId), actorId] as const,
  },
  staff: {
    all: ['staff'] as const,
    roster: (identityId: Id, branchId: string) => ['staff', 'roster', who(identityId), branchId] as const,
    accounts: (identityId: Id) => ['staff', 'accounts', who(identityId)] as const,
    scheduleSeries: (identityId: Id, branchId: string) => ['staff', 'scheduleSeries', who(identityId), branchId] as const,
    occurrences: (identityId: Id, profileId: string, from: string, to: string) =>
      ['staff', 'occurrences', who(identityId), profileId, from, to] as const,
    payrollWeek: (identityId: Id, branchId: string, weekStart: string) =>
      ['staff', 'payrollWeek', who(identityId), branchId, weekStart] as const,
  },
} as const;
