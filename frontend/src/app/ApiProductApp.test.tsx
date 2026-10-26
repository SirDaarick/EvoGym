import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductRoutes } from './ProductRoutes';

const { access, admin } = vi.hoisted(() => ({
  access: {
    principal: null as any,
    loading: false,
    error: '',
    request: vi.fn(async (_path: string, _init?: RequestInit) => new Response('{}')),
    leaveProfile: vi.fn(async () => {}),
    unlinkPairedDevice: vi.fn(async () => {}),
  },
  admin: { status: 'authenticated', request: vi.fn(async (_path: string, _init?: RequestInit) => new Response('{}')) },
}));

vi.mock('../features/auth/ProductAccessProvider', () => ({ useProductAccess: () => access }));
vi.mock('../features/auth/AdminSessionProvider', () => ({ useAdminSession: () => admin }));
vi.mock('../features/attendance/AttendanceCalendar', () => ({ AttendanceCalendar: () => <div>Attendance calendar</div> }));
vi.mock('../features/owner/OwnerMemberAnalytics', () => ({ OwnerMemberAnalytics: () => null }));

const member = {
  id: '123e4567-e89b-42d3-a456-426614174000', member_number: 'M-100', full_name: 'Ada Lovelace',
  preferred_name: null, phone: '5550100', status: 'active', joined_on: '2025-01-01',
  credit_balance_minor: 0, emergency_contact_name: null, emergency_contact_phone: null, photo_url: null,
};

describe('API product routes', () => {
  beforeEach(() => {
    access.principal = { kind: 'admin', identity: { id: 'admin-1', display_name: 'Owner', is_owner: true, can_manage_employees: true } };
    access.request.mockReset();
    admin.request.mockReset();
    admin.request.mockImplementation(async path => {
      if (path.startsWith('/api/v1/members?')) return new Response(JSON.stringify({ items: [member], total: 1, page: 1, limit: 100, pages: 1 }));
      if (path.endsWith('/reload?visit_limit=12')) return new Response(JSON.stringify({
        profile: { id: member.id, organization_id: 'org-1', home_branch_id: 'branch-1', member_number: member.member_number,
          full_name: member.full_name, preferred_name: null, phone: member.phone, email: null, birth_date: null,
          joined_on: member.joined_on, status: 'active', photo_url: null, emergency_contact_name: null, emergency_contact_phone: null },
        active_periods: [
          { id: 'period-1', order_item_id: 'order-item-1', plan_version_id: 'plan-1', plan_name: 'Plan actual', starts_on: '2026-01-01', ends_on: '2026-12-31', branch_id: null, is_current: true, access_status: 'eligible' },
          { id: 'period-2', order_item_id: 'order-item-2', plan_version_id: 'plan-2', plan_name: 'Plan adicional', starts_on: '2026-03-01', ends_on: '2026-04-30', branch_id: 'branch-1', is_current: false, access_status: 'branch_restricted' },
        ], class_samples: [], financial: { has_pending_balance: true, credit_balance_minor: 0,
          total_pending_balance_minor: 12500, currency: 'MXN', debts: [{ debt_id: 'debt-1', order_id: 'order-1', branch_id: 'branch-1',
            currency: 'MXN', initial_outstanding_minor: 15000, remaining_balance_minor: 12500, created_at: '2026-01-02T12:00:00Z' }] },
        recent_visits: [], server_time: '2026-01-02T12:00:00Z',
      }));
      if (path.endsWith(`/members/${member.id}`)) return new Response(JSON.stringify({ ...member, email: null, birth_date: null, notes: null, pending_balance_minor: 12500, has_pending_balance: true }));
      return new Response(JSON.stringify({}));
    });
    access.request.mockImplementation(async path => {
      if (path.startsWith('/api/v1/staff-roster?')) return new Response(JSON.stringify({ items: [{ id: 'profile-1', full_name: 'API Employee', position: 'Entrenador', is_active: true }], total: 1 }));
      if (path.startsWith('/api/v1/staff-attendance?')) return new Response(JSON.stringify({ items: [] }));
      return new Response('{}');
    });
  });

  it('renders member DTOs through the authenticated product route without mounting demo state', async () => {
    render(<MemoryRouter initialEntries={['/owner/members']}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(admin.request).toHaveBeenCalledWith(expect.stringContaining('/api/v1/members?'), expect.any(Object));
    expect(screen.queryByTestId('demo-provider')).not.toBeInTheDocument();
    expect(screen.getByText('M-100')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Buscar socio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ordenar por Socio' })).toBeInTheDocument();
    const search = screen.getByRole('textbox', { name: 'Buscar socio' });
    await userEvent.type(search, 'M-100');
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, 'not-a-member');
    expect(screen.getByText('Sin coincidencias')).toBeInTheDocument();
  });

  it('does not substitute demo rows when the API member response is empty', async () => {
    admin.request.mockResolvedValueOnce(new Response(JSON.stringify({ items: [], total: 0, page: 1, limit: 100, pages: 0 })));
    render(<MemoryRouter initialEntries={['/owner/members']}><ProductRoutes /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/sin socios registrados/i)).toBeInTheDocument());
    expect(screen.queryByText(/maría/i)).not.toBeInTheDocument();
  });

  it('keeps the existing member screen and reports an API authorization error without demo rows', async () => {
    admin.request.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    render(<MemoryRouter initialEntries={['/owner/members']}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByText('No tienes autorización para consultar estos datos.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Buscar socio' })).toBeInTheDocument();
    expect(screen.queryByText('María López')).not.toBeInTheDocument();
  });

  it('loads the authenticated detail and renders itemized debt DTOs for Admin', async () => {
    render(<MemoryRouter initialEntries={[`/owner/members/${member.id}`]}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mostrador' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Expediente' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Asistencia previa' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Historial de membresías' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Expediente' }));
    expect(await screen.findByText('Plan adicional')).toBeInTheDocument();
    expect(await screen.findByText('Adeudos pendientes')).toBeInTheDocument();
    expect(screen.queryByText('debt-1')).not.toBeInTheDocument();
    expect(screen.getByText('$125.00 MXN')).toBeInTheDocument();
    expect(admin.request).toHaveBeenCalledWith(`/api/v1/members/${member.id}/reload?visit_limit=12`, expect.any(Object));
    await userEvent.click(screen.getByRole('tab', { name: 'Mostrador' }));
    expect(screen.getByText('Mostrador no disponible')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar entrada' })).not.toBeInTheDocument();
  });

  it('routes reception staff attendance through the operating profile and API roster', async () => {
    const branchId = '423e4567-e89b-42d3-a456-426614174000';
    access.principal = { kind: 'employee', identity: { id: 'reception-1', display_name: 'Reception', is_owner: false, can_manage_employees: false }, branch: { branch_id: branchId }, session: { purpose: 'reception', accessToken: 'session-token' } };
    render(<MemoryRouter initialEntries={['/reception/staff']}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByText('Pase de Lista del Personal')).toBeInTheDocument();
    expect(await screen.findByText('API Employee')).toBeInTheDocument();
    expect(screen.queryByText('Emigdio')).not.toBeInTheDocument();
    expect(access.request).toHaveBeenCalledWith(`/api/v1/staff-roster?branch_id=${branchId}`);
    expect(access.request).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/v1\/staff-attendance\?branch_id=/));
  });

  it('uses the employee request path and keeps Admin-only itemized debts hidden', async () => {
    const branchId = '423e4567-e89b-42d3-a456-426614174000';
    access.principal = { kind: 'employee', identity: { id: 'reception-1', display_name: 'Reception', is_owner: false, can_manage_employees: false }, branch: { branch_id: branchId }, session: { purpose: 'reception', accessToken: 'session-token' } };
    access.request.mockImplementation(async path => {
      if (path.endsWith('/reload?visit_limit=12')) return new Response(JSON.stringify({
        profile: {}, active_periods: [], class_samples: [], financial: { has_pending_balance: true, credit_balance_minor: 0,
          total_pending_balance_minor: null, currency: 'MXN', debts: [] }, recent_visits: [], server_time: '2026-01-02T12:00:00Z',
      }));
      if (path.endsWith(`/members/${member.id}`)) return new Response(JSON.stringify({ ...member, email: null, birth_date: null, notes: null, pending_balance_minor: 12500, has_pending_balance: true }));
      return new Response('{}');
    });
    render(<MemoryRouter initialEntries={[`/reception/members/${member.id}`]}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText('Adeudos pendientes')).not.toBeInTheDocument();
    expect(access.request).toHaveBeenCalledWith(`/api/v1/members/${member.id}/reload?visit_limit=12`, expect.any(Object));
  });

  it('shows the API detail error instead of falling back to a demo member', async () => {
    admin.request.mockImplementation(async path => path.endsWith(`/members/${member.id}`)
      ? new Response('{}', { status: 404 })
      : new Response('{}'));
    render(<MemoryRouter initialEntries={[`/owner/members/${member.id}`]}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('El recurso solicitado no está disponible.');
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.queryByText('María López')).not.toBeInTheDocument();
  });
});
