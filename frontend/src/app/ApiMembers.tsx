import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { MemberReloadResponse } from '../api/memberReadsApi';
import type { Member, Role } from '../domain/models';
import { Members, MemberDetail } from '../features/members/Members';
import { rolePath } from './navigation';
import { Panel } from '../shared/ui';

interface ApiMember {
  id: string;
  member_number: string;
  full_name: string;
  preferred_name: string | null;
  phone: string;
  status: string;
  joined_on: string;
  credit_balance_minor: number;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  photo_url: string | null;
}

interface ApiMemberPage {
  items: ApiMember[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface ApiMemberDetail extends ApiMember {
  email: string | null;
  birth_date: string | null;
  notes: string | null;
  pending_balance_minor: number;
  has_pending_balance: boolean;
}

type AuthenticatedRequest = (path: string, init?: RequestInit) => Promise<Response>;

async function readResponse<T>(request: AuthenticatedRequest, path: string): Promise<T> {
  const response = await request(path, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    if (response.status === 401) throw new Error('La sesión expiró. Inicia sesión nuevamente.');
    if (response.status === 403) throw new Error('No tienes autorización para consultar estos datos.');
    if (response.status === 404) throw new Error('El recurso solicitado no está disponible.');
    throw new Error('No se pudieron cargar los datos desde la API.');
  }
  return response.json() as Promise<T>;
}

export function ApiMembers({ role, request }: { role: Role; request: AuthenticatedRequest }) {
  const [page, setPage] = useState<ApiMemberPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setPage(await readResponse<ApiMemberPage>(request, '/api/v1/members?page=1&limit=100'));
    } catch (reason) {
      setPage(null);
      setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los socios desde la API.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [request]);

  const members: Member[] = page?.items.map(item => ({
    id: item.id,
    name: item.preferred_name || item.full_name,
    phone: item.phone,
    email: undefined,
    creditMinor: item.credit_balance_minor,
    membership: null,
    joinedOn: item.joined_on,
  })) ?? [];
  const statuses = Object.fromEntries((page?.items ?? []).map(item => [item.id, { status: item.status, memberNumber: item.member_number }]));
  return <Members role={role} liveData={{ members, statuses, loading, error, onRefresh: () => void load() }} />;
}

export function ApiMemberDetail({ role, request, isAdmin }: { role: Role; request: AuthenticatedRequest; isAdmin: boolean }) {
  const location = useLocation();
  const memberId = location.pathname.split('/').filter(Boolean).at(-1) ?? '';
  const [member, setMember] = useState<ApiMemberDetail | null>(null);
  const [reload, setReload] = useState<MemberReloadResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!memberId) return;
    setLoading(true);
    setError('');
    try {
      const [profile, state] = await Promise.all([
        readResponse<ApiMemberDetail>(request, `/api/v1/members/${encodeURIComponent(memberId)}`),
        readResponse<MemberReloadResponse>(request, `/api/v1/members/${encodeURIComponent(memberId)}/reload?visit_limit=12`),
      ]);
      setMember(profile);
      setReload(state);
    } catch (reason) {
      setMember(null);
      setReload(null);
      setError(reason instanceof Error ? reason.message : 'No se pudo cargar el expediente desde la API.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [memberId, request]);

  if (loading) return <Panel><div role="status">Cargando expediente…</div></Panel>;
  if (error || !member || !reload) return <Panel><div role="alert">{error || 'El expediente solicitado no está disponible.'}</div><Link to={rolePath(role, 'members')}>Volver a socios</Link></Panel>;

  const detailMember: Member = { id: member.id, name: member.preferred_name || member.full_name, phone: member.phone, email: member.email ?? undefined, creditMinor: reload.financial.credit_balance_minor, membership: null, joinedOn: member.joined_on };
  return <MemberDetail role={role} liveData={{ member: detailMember, reload, notes: member.notes, status: member.status, isAdmin, onRefresh: () => void load() }} />;
}
