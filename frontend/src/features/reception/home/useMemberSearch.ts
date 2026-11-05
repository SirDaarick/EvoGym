import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listMembers, type AuthenticatedRequest } from '@/api/membersApi';
import { queryKeys } from '@/api/queryKeys';
import { openLocalDb } from '@/offline/db';
import { isOnlineHint } from '@/offline/connectivity';

export type SearchMember = { id: string; full_name: string; phone: string };
const NO_MEMBERS: SearchMember[] = [];
const DEBOUNCE_MS = 250;
const MIN_LENGTH = 2;

async function searchLocalMembers(term: string): Promise<{ items: SearchMember[] }> {
  try {
    const db = openLocalDb();
    const lower = term.toLowerCase();
    const all = await db.members.toArray();
    const matches = all.filter(m => {
      const num = m.member_number != null ? String(m.member_number).toLowerCase() : '';
      const name = typeof m.full_name === 'string' ? m.full_name.toLowerCase() : '';
      const tokens = Array.isArray(m.nameTokens) ? m.nameTokens : [];
      return (
        num.includes(lower) ||
        name.includes(lower) ||
        tokens.some(t => typeof t === 'string' && t.toLowerCase().includes(lower))
      );
    }).slice(0, 20);
    return {
      items: matches.map(m => ({
        id: m.member_id,
        full_name: typeof m.full_name === 'string' ? m.full_name : m.member_id,
        phone: typeof m.phone_last4 === 'string' ? `***${m.phone_last4}` : '',
      })),
    };
  } catch {
    return { items: [] };
  }
}

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
    queryFn: async () => {
      if (!isOnlineHint()) {
        return searchLocalMembers(debounced);
      }
      try {
        return await listMembers(request, { page: 1, limit: 20, search: debounced });
      } catch {
        return searchLocalMembers(debounced);
      }
    },
    enabled: active,
    retry: false,
  });
  const members: SearchMember[] = active ? search.data?.items ?? NO_MEMBERS : NO_MEMBERS;
  return { query, setQuery, members };
}
