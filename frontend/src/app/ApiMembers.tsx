import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { SortingState } from '@tanstack/react-table';
import { useProductAccess } from '../features/auth/ProductAccessProvider';
import { Link, useLocation, useNavigate } from 'react-router';
import type { MemberReloadResponse, MemberStatus, MemberSummary } from '../api/memberReadsApi';
import type { Member, Role } from '../domain/models';
import { Members, MemberDetail, type MemberStatusFilter } from '../features/members/Members';
import { rolePath } from './navigation';
import { Button, Field, PageHeader, Panel } from '../shared/ui';
import {
  createMember,
  createMemberNote,
  createMemberNumber,
  listMemberNotes,
  updateMember,
  type MemberNoteDTO,
  type UpdateMemberPayload,
} from '../api/membersApi';
import { openLocalDb } from '../offline/db';
import { dispatch } from '../offline/dispatcher';
import { isOnlineHint } from '../offline/connectivity';
import { HttpError, isAbortError, NetworkError } from '../api/http';

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
  membership_ends_on?: string | null;
  membership_status?: string | null;
}

interface ApiMemberPage {
  items: ApiMember[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  offline?: boolean;
}

interface ApiMemberDetail extends ApiMember {
  email: string | null;
  birth_date: string | null;
  notes: string | null;
  pending_balance_minor: number;
  has_pending_balance: boolean;
}

type AuthenticatedRequest = (path: string, init?: RequestInit) => Promise<Response>;

const MEMBERS_PAGE_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 300;
const SORT_FIELD_MAP: Record<string, string> = {
  name: 'full_name',
  phone: 'phone',
  membership: 'membership_status',
  endsOn: 'membership_ends_on',
};

async function readResponse<T>(
  request: AuthenticatedRequest,
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await request(path, {
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    let message = 'No se pudieron cargar los datos desde la API.';
    if (response.status === 401) message = 'La sesión expiró. Inicia sesión nuevamente.';
    else if (response.status === 403) message = 'No tienes autorización para consultar estos datos.';
    else if (response.status === 404) message = 'El recurso solicitado no está disponible.';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return response.json() as Promise<T>;
}

async function loadLocalMembersPage(): Promise<ApiMemberPage | null> {
  try {
    const db = openLocalDb();
    const localMembers = await db.members.toArray();
    if (localMembers.length === 0) return null;
    const items: ApiMember[] = localMembers.map(m => {
      const latestEndsOn = Array.isArray(m.active_periods) && m.active_periods.length > 0
        ? m.active_periods.reduce<string | null>(
          (max, period) => (typeof period?.ends_on === 'string' && (!max || period.ends_on > max) ? period.ends_on : max),
          null,
        )
        : null;
      const membershipEndsOn = typeof m.membership_ends_on === 'string' ? m.membership_ends_on : latestEndsOn;
      const status = typeof m.status === 'string' ? m.status : 'active';
      return {
        id: m.member_id,
        member_number: m.member_number != null ? String(m.member_number) : '',
        full_name: typeof m.full_name === 'string' ? m.full_name : m.member_id,
        preferred_name: null,
        phone: typeof m.phone_last4 === 'string' ? `***${m.phone_last4}` : '',
        status,
        joined_on: m.changed_at ? String(m.changed_at).split('T')[0] : '',
        credit_balance_minor: 0,
        emergency_contact_name: null,
        emergency_contact_phone: null,
        photo_url: null,
        membership_ends_on: membershipEndsOn,
        membership_status: status,
      };
    });
    return { items, total: items.length, page: 1, limit: items.length, pages: 1, offline: true };
  } catch {
    return null;
  }
}

function useOptionalProductAccess() {
  try {
    return useProductAccess();
  } catch {
    return null;
  }
}

const CHECK_IN_DENIAL_MESSAGES: Record<string, string> = {
  membership_not_found: 'El socio no tiene una membresía registrada.',
  wrong_branch: 'La membresía pertenece a otra sucursal.',
  period_expired: 'La membresía está vencida.',
  period_not_started: 'La membresía aún no inicia.',
  transfer_not_received: 'La transferencia no tiene comprobante registrado.',
  transfer_missing_funds: 'La transferencia está pendiente: los fondos no se han recibido.',
  admin_payment_restriction: 'El administrador restringió el acceso por falta de pago.',
};

function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const error = (body as Record<string, unknown>).error ?? (body as Record<string, unknown>).detail;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
      return (error as Record<string, unknown>).message as string;
    }
    if (typeof (body as Record<string, unknown>).message === 'string') {
      return (body as Record<string, unknown>).message as string;
    }
  }
  return fallback;
}

export function ApiMembers({ role, request }: { role: Role; request: AuthenticatedRequest }) {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [membershipStatus, setMembershipStatus] = useState<MemberStatusFilter>('all');
  const [sorting, setSorting] = useState<SortingState>([]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const timer = window.setTimeout(() => {
      setDebouncedSearch(prev => (prev === trimmed ? prev : trimmed));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const activeSort = sorting[0];
  const sortBy = (activeSort && SORT_FIELD_MAP[activeSort.id]) || 'full_name';
  const sortDir: 'asc' | 'desc' = activeSort ? (activeSort.desc ? 'desc' : 'asc') : 'asc';

  const {
    data,
    error,
    isPending,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['members', { search: debouncedSearch, membershipStatus, sortBy, sortDir }],
    staleTime: 0,
    placeholderData: keepPreviousData,
    initialPageParam: 1,
    getNextPageParam: (lastPage: ApiMemberPage) => (lastPage.page < lastPage.pages ? lastPage.page + 1 : undefined),
    queryFn: async ({ pageParam, signal }): Promise<ApiMemberPage> => {
      if (pageParam === 1 && !isOnlineHint()) {
        const offlinePage = await loadLocalMembersPage();
        if (offlinePage) return offlinePage;
        throw new Error('No se pudieron cargar los socios desde la API.');
      }
      const params = new URLSearchParams({
        page: String(pageParam),
        limit: String(MEMBERS_PAGE_LIMIT),
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (membershipStatus !== 'all') params.set('membership_status', membershipStatus);
      const path = `/api/v1/members?${params.toString()}`;
      try {
        return await readResponse<ApiMemberPage>(request, path, signal);
      } catch (reason) {
        if (isAbortError(reason) || signal.aborted) throw reason;
        const status = (reason as { status?: unknown } | null)?.status;
        const isHttpStatusError = reason instanceof HttpError || (typeof status === 'number' && status >= 400);
        if (pageParam === 1 && !isHttpStatusError) {
          const offlinePage = await loadLocalMembersPage();
          if (offlinePage) return offlinePage;
        }
        throw reason;
      }
    },
  });

  const { members, statuses } = useMemo(() => {
    const seen = new Set<string>();
    const nextMembers: Member[] = [];
    const nextStatuses: Record<string, { status: string; memberNumber?: string; searchAliases?: string; endsOn?: string | null }> = {};
    for (const page of data?.pages ?? []) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        nextMembers.push({
          id: item.id,
          name: item.preferred_name || item.full_name,
          phone: item.phone,
          email: undefined,
          creditMinor: item.credit_balance_minor,
          membership: null,
          joinedOn: item.joined_on,
        });
        nextStatuses[item.id] = {
          status: item.membership_status ?? item.status,
          memberNumber: item.member_number,
          searchAliases: item.full_name,
          endsOn: item.membership_ends_on ?? null,
        };
      }
    }
    return { members: nextMembers, statuses: nextStatuses };
  }, [data]);

  const isOffline = data?.pages[0]?.offline === true;
  const isRefreshing = isFetching && !isPending && !isFetchingNextPage;
  const total = data?.pages[0]?.total ?? members.length;
  const errorMessage = error instanceof Error
    ? (error.message !== 'offline' ? error.message : 'No se pudieron cargar los socios desde la API.')
    : error
      ? 'No se pudieron cargar los socios desde la API.'
      : '';

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['members'], refetchType: 'none' });
    void refetch();
  }, [queryClient, refetch]);

  const handleFetchNextPage = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  return (
    <Members
      role={role}
      liveData={
        isOffline
          ? {
            members,
            statuses,
            loading: isPending,
            refreshing: isRefreshing,
            error: errorMessage,
            onRefresh: handleRefresh,
            serverDriven: false,
          }
          : {
            members,
            statuses,
            loading: isPending,
            refreshing: isRefreshing,
            error: errorMessage,
            onRefresh: handleRefresh,
            serverDriven: true,
            total,
            hasNextPage: Boolean(hasNextPage),
            isFetchingNextPage,
            fetchNextPage: handleFetchNextPage,
            query: searchInput,
            onQueryChange: setSearchInput,
            statusFilter: membershipStatus,
            onStatusFilterChange: setMembershipStatus,
            sorting,
            onSortingChange: setSorting,
          }
      }
    />
  );
}

export function ApiNewMember({ role, request }: { role: Role; request: AuthenticatedRequest }) {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [numberConflict, setNumberConflict] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !fullName.trim() || !phone.trim()) return;
    setSubmitting(true);
    setError('');
    setNumberConflict(false);
    try {
      const created = await createMember(request, {
        member_number: createMemberNumber(),
        full_name: fullName.trim(),
        ...(preferredName.trim() ? { preferred_name: preferredName.trim() } : {}),
        phone: phone.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      navigate(rolePath(role, `members/${created.id}`));
    } catch (err) {
      if (err instanceof Error && 'kind' in err && err.kind === 'conflict') {
        setNumberConflict(true);
        setError('El número generado ya está asociado a otro socio. Intenta nuevamente.');
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo registrar el socio.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="ALTA DE SOCIO"
        title="Nuevo socio"
        description="Registra los datos del socio para habilitar su expediente."
      />
      <Panel>
        <form onSubmit={handleRegister} className="flow">
          <Field
            id="member-full-name"
            label="Nombre completo"
            required
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            disabled={submitting}
          />
          <Field
            id="member-preferred-name"
            label="¿Cómo le gusta que le digan? (opcional)"
            value={preferredName}
            onChange={e => setPreferredName(e.target.value)}
            maxLength={160}
            disabled={submitting}
          />
          <Field
            id="member-phone"
            label="Teléfono"
            required
            value={phone}
            onChange={e => setPhone(e.target.value)}
            disabled={submitting}
          />
          <Field
            id="member-email"
            label="Correo electrónico (opcional)"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={submitting}
          />
          {error && <p role="alert" className="text-danger">{error}</p>}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}>
            <Button type="submit" disabled={submitting || !fullName.trim() || !phone.trim()}>
              {submitting ? 'Registrando…' : numberConflict ? 'Reintentar registro' : 'Registrar socio'}
            </Button>
            <Link to={rolePath(role, 'members')} className="button button-secondary">
              Volver a socios
            </Link>
          </div>
        </form>
      </Panel>
    </>
  );
}

export function ApiMemberDetail({ role, request, isAdmin }: { role: Role; request: AuthenticatedRequest; isAdmin: boolean }) {
  const location = useLocation();
  const memberId = location.pathname.split('/').filter(Boolean).at(-1) ?? '';
  const [member, setMember] = useState<ApiMemberDetail | null>(null);
  const [reload, setReload] = useState<MemberReloadResponse | null>(null);
  const [summary, setSummary] = useState<MemberSummary | null>(null);
  const [notesList, setNotesList] = useState<MemberNoteDTO[]>([]);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const access = useOptionalProductAccess();
  const employeeBranchId = access?.principal?.kind === 'employee' ? access.principal.branch.branch_id : null;
  const pendingKeyRef = useRef<{ target: string; key: string; confirmed?: boolean } | null>(null);

  async function load() {
    if (!memberId) return;
    setLoading(true);
    setError('');
    try {
      if (!isOnlineHint()) {
        throw new Error('offline');
      }
      const [profile, state, notesData, summaryData] = await Promise.all([
        readResponse<ApiMemberDetail>(request, `/api/v1/members/${encodeURIComponent(memberId)}`),
        readResponse<MemberReloadResponse>(request, `/api/v1/members/${encodeURIComponent(memberId)}/reload?visit_limit=12`),
        listMemberNotes(request, memberId).catch(() => [] as MemberNoteDTO[]),
        readResponse<MemberSummary>(request, `/api/v1/members/${encodeURIComponent(memberId)}/summary`).catch(() => null),
      ]);
      setMember(profile);
      setReload(state);
      setSummary(summaryData?.financial && summaryData?.habits ? summaryData : null);
      if (Array.isArray(notesData)) {
        setNotesList(notesData);
      }
    } catch (reason) {
      try {
        const db = openLocalDb();
        const local = await db.members.get(memberId);
        if (local) {
          const profileStatus: MemberStatus = local.status === 'active' || local.status === 'inactive' || local.status === 'expired' || local.status === 'suspended' || local.status === 'pending'
            ? local.status
            : 'active';

          const profile: ApiMemberDetail = {
            id: local.member_id,
            member_number: local.member_number != null ? String(local.member_number) : '',
            full_name: typeof local.full_name === 'string' ? local.full_name : local.member_id,
            preferred_name: null,
            phone: typeof local.phone_last4 === 'string' ? `***${local.phone_last4}` : '',
            email: null,
            birth_date: null,
            status: profileStatus,
            joined_on: local.changed_at ? String(local.changed_at).split('T')[0] : '',
            credit_balance_minor: 0,
            notes: null,
            pending_balance_minor: local.has_debt ? 1 : 0,
            has_pending_balance: Boolean(local.has_debt),
            emergency_contact_name: null,
            emergency_contact_phone: null,
            photo_url: null,
          };
          const period = Array.isArray(local.active_periods) && local.active_periods.length > 0 ? local.active_periods[0] : null;
          const reloadFallback: MemberReloadResponse = {
            profile: {
              id: local.member_id,
              organization_id: '',
              home_branch_id: '',
              member_number: local.member_number != null ? String(local.member_number) : '',
              full_name: typeof local.full_name === 'string' ? local.full_name : local.member_id,
              preferred_name: null,
              phone: typeof local.phone_last4 === 'string' ? `***${local.phone_last4}` : '',
              email: null,
              birth_date: null,
              joined_on: local.changed_at ? String(local.changed_at).split('T')[0] : '',
              status: profileStatus,
              photo_url: null,
              emergency_contact_name: null,
              emergency_contact_phone: null,
            },
            active_periods: period ? [{
              id: period.period_id,
              order_item_id: 'offline-order-item',
              plan_version_id: 'offline-plan-version',
              plan_name: 'Membresía activa',
              starts_on: period.starts_on,
              ends_on: period.ends_on,
              branch_id: null,
              is_current: true,
              access_status: period.access === 'valid' ? 'eligible' : period.access === 'valid_with_outstanding_balance' ? 'restricted_unpaid' : 'expired',
            }] : [],
            class_samples: [],
            financial: {
              currency: 'MXN',
              credit_balance_minor: 0,
              total_pending_balance_minor: local.has_debt ? 1 : 0,
              has_pending_balance: Boolean(local.has_debt),
              debts: [],
            },
            recent_visits: [],
            server_time: new Date().toISOString(),
          };
          setMember(profile);
          setReload(reloadFallback);
          setError('');
          return;
        }
      } catch { /* proceed with error */ }
      setMember(null);
      setReload(null);
      setError(reason instanceof Error && reason.message !== 'offline' ? reason.message : 'No se pudo cargar el expediente desde la API.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddNote(bodyText: string) {
    setNoteSubmitting(true);
    setNoteError('');
    try {
      const newNote = await createMemberNote(request, memberId, bodyText);
      setNotesList(prev => [newNote, ...prev]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo guardar la nota.';
      setNoteError(msg);
      throw err;
    } finally {
      setNoteSubmitting(false);
    }
  }

  async function handleUpdateMember(payload: UpdateMemberPayload) {
    const updated = await updateMember(request, memberId, payload);
    setMember(prev => (prev ? { ...prev, ...updated } : updated as ApiMemberDetail));
    await load();
  }

  async function recordOfflineCheckIn(): Promise<{ ok: boolean; message: string }> {
    const db = openLocalDb();
    if (await db.meta.where('key').startsWith(`member-roster-uncertain:${memberId}:`).first()) {
      return { ok: false, message: 'La información local del socio no está confirmada. Reintenta al recuperar la conexión.' };
    }
    const local = await db.members.get(memberId);
    if (!local || local.status !== 'active') {
      return { ok: false, message: 'La membresía debe estar activa para registrar entrada.' };
    }
    const period = Array.isArray(local.active_periods) && local.active_periods.length > 0
      ? local.active_periods[0]
      : null;
    if (!period || period.access === 'denied') {
      return { ok: false, message: 'La membresía debe estar activa para registrar entrada.' };
    }
    const localDecision = period.access;
    if (pendingKeyRef.current && !pendingKeyRef.current.confirmed && localDecision === 'valid_with_outstanding_balance') {
      return { ok: false, message: 'No se pudo verificar la entrada pendiente. Reintenta al recuperar la conexión.' };
    }
    const confirmed = pendingKeyRef.current?.confirmed || (localDecision === 'valid_with_outstanding_balance'
      && window.confirm('El socio tiene un adeudo pendiente. ¿Confirmas su entrada?'));
    if (localDecision === 'valid_with_outstanding_balance' && !confirmed) {
      return { ok: false, message: 'Entrada cancelada.' };
    }
    const actorStaffId = access?.principal ? access.principal.identity.id : 'offline-staff';
    const branchMeta = await db.meta.get('branch');
    const branchVal = branchMeta?.value as { id?: string } | undefined;
    const branchId = employeeBranchId || branchVal?.id || 'branch-default';
    if (pendingKeyRef.current && pendingKeyRef.current.target !== `${branchId}:${period.period_id}`) {
      return { ok: false, message: 'No se pudo verificar la entrada pendiente. Reintenta al recuperar la conexión.' };
    }

    try {
      await dispatch(
        db,
        {
          type: 'attendance.check_in',
          payload: {
            member_id: memberId,
            period_id: period.period_id,
            branch_id: branchId,
            local_access_decision: localDecision,
            ...(confirmed ? { confirm_outstanding_balance: true } : {}),
            ...(pendingKeyRef.current ? { online_idempotency_key: pendingKeyRef.current.key } : {}),
          },
        },
        actorStaffId,
      );
      pendingKeyRef.current = null;
      return { ok: true, message: 'Entrada registrada en contingencia.' };
    } catch {
      return { ok: false, message: 'No se pudo registrar la entrada en contingencia.' };
    }
  }

  async function recordCheckIn(): Promise<{ ok: boolean; message: string }> {
    if (!isOnlineHint()) {
      return await recordOfflineCheckIn();
    }
    if (!reload) return { ok: false, message: 'El expediente solicitado no está disponible.' };
    const period = reload.active_periods.find(p => p.is_current) ?? reload.active_periods[0];
    const branchId = employeeBranchId ?? period?.branch_id ?? reload.profile.home_branch_id;
    if (!period || !branchId) {
      return { ok: false, message: 'La membresía debe estar activa para registrar entrada.' };
    }
    const target = `${branchId}:${period.id}`;
    if (pendingKeyRef.current?.target !== target) {
      pendingKeyRef.current = { target, key: `checkin-${crypto.randomUUID()}` };
    }
    try {
      const response = await request(
        `/api/v1/member-check-ins/branches/${encodeURIComponent(branchId)}/periods/${encodeURIComponent(period.id)}`,
        { method: 'POST', headers: { 'Idempotency-Key': pendingKeyRef.current.key, ...(pendingKeyRef.current.confirmed ? { 'Content-Type': 'application/json' } : {}) },
          ...(pendingKeyRef.current.confirmed ? { body: JSON.stringify({ confirm_outstanding_balance: true }) } : {}) },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const code = body?.error?.code ?? body?.detail?.code;
        const reason = body?.error?.metadata?.reason ?? body?.detail?.metadata?.reason;
        if (code === 'debt_confirmation_required') {
          if (pendingKeyRef.current.confirmed) return { ok: false, message: 'No se pudo confirmar la entrada con adeudo.' };
          if (!window.confirm('El socio tiene un adeudo pendiente. ¿Confirmas su entrada?')) {
            pendingKeyRef.current = null;
            return { ok: false, message: 'Entrada cancelada.' };
          }
          pendingKeyRef.current.confirmed = true;
          return await recordCheckIn();
        }
        if (code === 'membership_access_denied' || reason) {
          pendingKeyRef.current = null;
          return { ok: false, message: CHECK_IN_DENIAL_MESSAGES[reason as string] ?? 'La membresía debe estar activa para registrar entrada.' };
        }
        return { ok: false, message: extractErrorMessage(body, 'No se pudo registrar la entrada.') };
      }
      pendingKeyRef.current = null;
      await load();
      return { ok: true, message: 'Entrada registrada.' };
    } catch (reason) {
      if (reason instanceof TypeError || reason instanceof NetworkError) return await recordOfflineCheckIn();
      return { ok: false, message: reason instanceof Error ? reason.message : 'No se pudo registrar la entrada.' };
    }
  }

  useEffect(() => { void load(); }, [memberId, request]);

  if (loading) return <Panel><div role="status">Cargando expediente…</div></Panel>;
  if (error || !member || !reload) return <Panel><div role="alert">{error || 'El expediente solicitado no está disponible.'}</div><Link to={rolePath(role, 'members')}>Volver a socios</Link></Panel>;

  const detailMember: Member = {
    id: member.id,
    name: member.preferred_name || member.full_name,
    phone: member.phone,
    email: member.email ?? undefined,
    creditMinor: reload.financial.credit_balance_minor,
    membership: null,
    joinedOn: member.joined_on,
  };
  return (
    <MemberDetail
      role={role}
      liveData={{
        member: detailMember,
        reload,
        summary,
        notes: member.notes,
        status: member.status,
        isAdmin,
        onRefresh: () => void load(),
        onCheckIn: recordCheckIn,
        legalFullName: member.full_name,
        preferredName: member.preferred_name,
        email: member.email,
        liveNotesList: notesList,
        onAddLiveNote: handleAddNote,
        noteSubmitting,
        noteError,
        onUpdateMember: handleUpdateMember,
        apiRequest: request,
      }}
    />
  );
}
