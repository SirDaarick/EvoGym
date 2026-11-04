import { useAdminSession } from '@/features/auth/AdminSessionProvider';
import { queryKeys } from '@/api/queryKeys';
import type { StaffProfile } from '@/features/staff/staffStore';

export interface ManagedStaffProfile extends StaffProfile {
  staffUserId?: string;
}

export type StatusFilter = 'all' | 'active' | 'inactive';
export type StaffRequest = (path: string, init?: RequestInit) => Promise<Response>;

/** The admin session when a provider is mounted; `null` in the local/demo shell. */
export function useOptionalAdminSession() {
  try {
    return useAdminSession();
  } catch {
    return null;
  }
}

/** The authenticated request function, or `null` when there is no usable Admin session. */
export function useAdminRequest(): StaffRequest | null {
  const session = useOptionalAdminSession();
  return session && session.status === 'authenticated' ? session.request : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** `HH:MM` -> `HH:MM:SS` as the schedules API expects. */
export function toApiTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

/**
 * Query keys that extend the shared `queryKeys.staff` factories. Everything sits under
 * `queryKeys.staff.all`, so a single invalidation of that prefix refreshes the whole feature.
 * The identity segment is `null` because the whole cache is cleared on principal change.
 */
export const staffKeys = {
  branches: () => queryKeys.branches(null),
  roster: (branchId: string) => queryKeys.staff.roster(null, branchId),
  accounts: (branchId: string) => [...queryKeys.staff.accounts(null), branchId] as const,
  series: (branchId: string) => queryKeys.staff.scheduleSeries(null, branchId),
  payrollAll: [...queryKeys.staff.all, 'payrollWeek'] as const,
  payroll: (branchId: string, weekStart: string) => queryKeys.staff.payrollWeek(null, branchId, weekStart),
  occurrences: (profileId: string, from: string, to: string) => queryKeys.staff.occurrences(null, profileId, from, to),
  liveAccounts: () => queryKeys.staff.accounts(null),
};

export function profileInitials(fullName: string): string {
  return fullName.trim().split(/\s+/).slice(0, 2).map(part => part[0] ?? '').join('').toUpperCase() || '?';
}
