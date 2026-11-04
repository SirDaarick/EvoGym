import { useQuery } from '@tanstack/react-query';
import { getMember, type AuthenticatedRequest } from '@/api/membersApi';
import { queryKeys } from '@/api/queryKeys';

/** Resolves the display name of the member attached to a recovered pending sale. */
export function useRecoveredMember(request: AuthenticatedRequest, identityId: string | undefined, memberId: string | null | undefined): string {
  const { data } = useQuery({
    queryKey: queryKeys.members.detail(identityId, memberId ?? ''),
    queryFn: () => getMember(request, memberId!),
    enabled: Boolean(memberId),
    retry: false,
  });
  return memberId && typeof data?.full_name === 'string' ? data.full_name : '';
}
