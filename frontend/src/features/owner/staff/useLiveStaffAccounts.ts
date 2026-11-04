import { useQuery } from '@tanstack/react-query';
import { listAdminBranches, listAdminStaffAccounts, type AdminStaffAccountChoice } from '@/api/staffCredentialsApi';
import { staffKeys, useAdminRequest } from './utils';

const NONE: AdminStaffAccountChoice[] = [];

/** Live Admin accounts merged into the demo list; falls back to nothing if the API is unavailable. */
export function useLiveStaffAccounts(): AdminStaffAccountChoice[] {
  const request = useAdminRequest();
  const query = useQuery({
    queryKey: staffKeys.liveAccounts(),
    enabled: Boolean(request),
    queryFn: async () => {
      try {
        const branches = await listAdminBranches(request!);
        const branchId = import.meta.env.VITE_BRANCH_ID || branches[0]?.id;
        return branchId ? await listAdminStaffAccounts(request!, branchId) : NONE;
      } catch {
        return NONE; // graceful fallback to the local store
      }
    },
  });
  return request ? query.data ?? NONE : NONE;
}
