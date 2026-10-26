import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { MemberReloadResponse } from '../api/memberReadsApi';
import type { Role } from '../domain/models';
import { rolePath } from './navigation';
import { Badge, Button, EmptyState, PageHeader, Panel, TableRegion } from '../shared/ui';

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

function formatMoney(minor: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(minor / 100);
}

function statusLabel(status: string) {
  return ({ active: 'Activo', inactive: 'Inactivo', expired: 'Vencido', suspended: 'Suspendido', pending: 'Pendiente' } as Record<string, string>)[status] ?? status;
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

  return <>
    <PageHeader eyebrow="SOCIOS · API" title="Socios y membresías" description="Consulta los socios autorizados para tu perfil operativo." action={<Button variant="secondary" disabled={loading} onClick={() => void load()}>Actualizar</Button>} />
    <Panel>
      {error ? <div role="alert">{error}</div> : loading ? <div role="status">Cargando socios…</div> : !page?.items.length ? <EmptyState title="No se encontraron socios">La API no devolvió socios para esta consulta.</EmptyState> : <TableRegion label="Socios">
        <table className="member-detail-table">
          <thead><tr><th scope="col">Socio</th><th scope="col">Teléfono</th><th scope="col">Estado</th><th scope="col">Alta</th><th scope="col">Saldo a favor</th></tr></thead>
          <tbody>{page.items.map(member => <tr key={member.id}>
            <td><Link className="member-name-link" to={rolePath(role, `members/${member.id}`)}>{member.preferred_name || member.full_name}</Link><div className="muted member-id">{member.member_number}</div></td>
            <td>{member.phone || 'No capturado'}</td>
            <td><Badge tone={member.status === 'active' ? 'success' : 'neutral'}>{statusLabel(member.status)}</Badge></td>
            <td>{member.joined_on}</td>
            <td>{formatMoney(member.credit_balance_minor)}</td>
          </tr>)}</tbody>
        </table>
      </TableRegion>}
    </Panel>
  </>;
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

  return <>
    <PageHeader eyebrow="SOCIO · API" title={member.preferred_name || member.full_name} description={`${member.member_number} · ${member.phone || 'Teléfono no capturado'}`} action={<Button variant="secondary" disabled={loading} onClick={() => void load()}>Actualizar</Button>} />
    <div className="member-detail-columns">
      <Panel><h2>Membresía actual</h2>{reload.active_periods.length ? <ul className="clean-list flow-gap-sm">{reload.active_periods.map(period => <li key={period.id}><strong>{period.plan_name}</strong><div>{period.starts_on} al {period.ends_on}</div><Badge tone={period.access_status === 'eligible' ? 'success' : 'warning'}>{period.access_status}</Badge></li>)}</ul> : <EmptyState title="Sin períodos activos">La API no reportó períodos de membresía activos.</EmptyState>}</Panel>
      <Panel><h2>Visitas recientes</h2>{reload.recent_visits.length ? <ul className="clean-list flow-gap-sm">{reload.recent_visits.map(visit => <li key={visit.id}><time dateTime={visit.occurred_at}>{new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(visit.occurred_at))}</time> · {visit.access_reason}</li>)}</ul> : <EmptyState title="Sin visitas recientes">La API no devolvió visitas en este expediente.</EmptyState>}</Panel>
    </div>
    {isAdmin && <Panel><h2>Adeudos pendientes</h2>{reload.financial.debts.length ? <TableRegion label="Adeudos pendientes"><table className="member-detail-table"><thead><tr><th scope="col">Fecha</th><th scope="col">Adeudo</th><th scope="col">Saldo restante</th></tr></thead><tbody>{reload.financial.debts.map(debt => <tr key={debt.debt_id}><td>{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' }).format(new Date(debt.created_at))}</td><td>{formatMoney(debt.initial_outstanding_minor)}</td><td>{formatMoney(debt.remaining_balance_minor)}</td></tr>)}</tbody></table></TableRegion> : <EmptyState title="Sin adeudos pendientes">La API no reporta adeudos para este socio.</EmptyState>}</Panel>}
    <Panel><h2>Datos de contacto</h2><dl><dt>Correo</dt><dd>{member.email || 'No capturado'}</dd><dt>Fecha de nacimiento</dt><dd>{member.birth_date || 'No capturada'}</dd><dt>Saldo a favor</dt><dd>{formatMoney(reload.financial.credit_balance_minor)}</dd></dl></Panel>
    <div className="flow member-detail-back-flow"><Link to={rolePath(role, 'members')} className="member-back-link">Volver a socios</Link></div>
  </>;
}
