import { useEffect, useRef, useState } from 'react';
import { useProductAccess } from '../features/auth/ProductAccessProvider';
import { Link, useLocation, useNavigate } from 'react-router';
import type { MemberReloadResponse } from '../api/memberReadsApi';
import type { Member, Role } from '../domain/models';
import { Members, MemberDetail } from '../features/members/Members';
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

function useOptionalProductAccess() {
  try {
    return useProductAccess();
  } catch {
    return null;
  }
}

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
  const [page, setPage] = useState<ApiMemberPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const firstPage = await readResponse<ApiMemberPage>(request, '/api/v1/members?page=1&limit=100');
      const items = [...firstPage.items];
      for (let pageNumber = 2; pageNumber <= firstPage.pages; pageNumber += 1) {
        const nextPage = await readResponse<ApiMemberPage>(request, `/api/v1/members?page=${pageNumber}&limit=100`);
        items.push(...nextPage.items);
      }
      setPage({ ...firstPage, items });
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
  const statuses = Object.fromEntries((page?.items ?? []).map(item => [item.id, { status: item.status, memberNumber: item.member_number, searchAliases: item.full_name }]));
  return <Members role={role} liveData={{ members, statuses, loading, error, onRefresh: () => void load() }} />;
}

export function ApiNewMember({ role, request }: { role: Role; request: AuthenticatedRequest }) {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
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
  const [notesList, setNotesList] = useState<MemberNoteDTO[]>([]);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const access = useOptionalProductAccess();
  const employeeBranchId = access?.principal?.kind === 'employee' ? access.principal.branch.branch_id : null;
  const pendingKeyRef = useRef<{ target: string; key: string } | null>(null);

  async function load() {
    if (!memberId) return;
    setLoading(true);
    setError('');
    try {
      const [profile, state, notesData] = await Promise.all([
        readResponse<ApiMemberDetail>(request, `/api/v1/members/${encodeURIComponent(memberId)}`),
        readResponse<MemberReloadResponse>(request, `/api/v1/members/${encodeURIComponent(memberId)}/reload?visit_limit=12`),
        isAdmin ? listMemberNotes(request, memberId).catch(() => [] as MemberNoteDTO[]) : Promise.resolve(null),
      ]);
      setMember(profile);
      setReload(state);
      if (Array.isArray(notesData)) {
        setNotesList(notesData);
      }
    } catch (reason) {
      setMember(null);
      setReload(null);
      setError(reason instanceof Error ? reason.message : 'No se pudo cargar el expediente desde la API.');
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

  async function recordCheckIn(): Promise<{ ok: boolean; message: string }> {
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
        { method: 'POST', headers: { 'Idempotency-Key': pendingKeyRef.current.key } },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const code = body?.error?.code ?? body?.detail?.code;
        const reason = body?.error?.metadata?.reason ?? body?.detail?.metadata?.reason;
        if (code === 'membership_access_denied' || reason) {
          pendingKeyRef.current = null;
          return { ok: false, message: 'La membresía debe estar activa para registrar entrada.' };
        }
        return { ok: false, message: extractErrorMessage(body, 'No se pudo registrar la entrada.') };
      }
      pendingKeyRef.current = null;
      await load();
      return { ok: true, message: 'Entrada registrada.' };
    } catch {
      return { ok: false, message: 'No se pudo registrar la entrada.' };
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
        notes: member.notes,
        status: member.status,
        isAdmin,
        onRefresh: () => void load(),
        onCheckIn: recordCheckIn,
        legalFullName: member.full_name,
        email: member.email,
        liveNotesList: isAdmin ? notesList : undefined,
        onAddLiveNote: isAdmin ? handleAddNote : undefined,
        noteSubmitting,
        noteError,
        onUpdateMember: handleUpdateMember,
        apiRequest: request,
      }}
    />
  );
}
