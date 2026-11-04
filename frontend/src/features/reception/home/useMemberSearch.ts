import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listMembers, type AuthenticatedRequest } from '@/api/membersApi';
import { queryKeys } from '@/api/queryKeys';

export type SearchMember = { id: string; full_name: string; phone: string };
const NO_MEMBERS: SearchMember[] = [];
const DEBOUNCE_MS = 250;
const MIN_LENGTH = 2;

/** Debounced member search; `disabled` (a member is already assigned) yields no results. */
export function useMemberSearch(request: AuthenticatedRequest, identityId: string | undefined, disabled: boolean) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const term = query.trim();

  useEffect(() => {
    if (term.length < MIN_LENGTH) { setDebounced(''); return; }
    const timer = window.setTimeout(() => setDebounced(term), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [term]);

  const active = !disabled && term.length >= MIN_LENGTH && debounced === term;
  const search = useQuery({
    queryKey: queryKeys.members.search(identityId, debounced),
    queryFn: () => listMembers(request, { page: 1, limit: 20, search: debounced }),
    enabled: active,
    retry: false,
  });
  const members: SearchMember[] = active ? search.data?.items ?? NO_MEMBERS : NO_MEMBERS;
  return { query, setQuery, members };
}
