import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
        recent_visits: [{ id: 'visit-log-1', visit_id: 'visit-1', branch_id: 'branch-1', period_id: 'period-1', sample_entitlement_id: null,
          occurred_at: '2026-01-02T12:00:00Z', access_reason: 'eligible', access_warnings: [] }], server_time: '2026-01-02T12:00:00Z',
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

  it('loads shift registers and current/history through the mounted authenticated API route', async () => {
    const register = { id: 'register-1', branch_id: 'branch-1', code: 'front', name: 'Recepción', status: 'active', has_open_shift: false };
    admin.request.mockImplementation(async path => {
      if (path === '/api/v1/registers') return new Response(JSON.stringify([register]));
      if (path.startsWith('/api/v1/shifts?')) return new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 100 }));
      if (path.startsWith('/api/v1/shifts/current?')) return new Response('{}', { status: 404 });
      return new Response('{}');
    });

    render(<MemoryRouter initialEntries={['/owner/shifts']}><ProductRoutes /></MemoryRouter>);

    expect(await screen.findByText('No hay turnos registrados para esta caja.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turno' })).toBeEnabled();
    expect(admin.request).toHaveBeenCalledWith('/api/v1/registers', undefined);
    expect(admin.request).toHaveBeenCalledWith('/api/v1/shifts?register_id=register-1&offset=0&limit=100', undefined);
    expect(admin.request).toHaveBeenCalledWith('/api/v1/shifts/current?register_id=register-1', undefined);
    expect(screen.queryByTestId('demo-provider')).not.toBeInTheDocument();
  });

  it('renders opening inventory baselines from the shift snapshot without implying current stock', async () => {
    const register = { id: 'register-1', branch_id: 'branch-1', code: 'front', name: 'Recepción', status: 'active', has_open_shift: true };
    const shift = {
      id: 'shift-1', cash_register_id: register.id, opened_by: 'admin-1', opened_at: '2026-10-26T14:00:00Z', closed_at: null,
      status: 'open', opening_cash_minor: 50000, denomination_counts: [], closing_denomination_counts: [],
      inventory_review: { snapshot_id: 'snapshot-1', observations: [
        { product_id: 'product-1', code: 'T-1', name: 'Toalla', unit: 'piezas', physical_quantity: 4, reason: 'Diferencia verificada', expected_quantity: 5, initialized: true },
        { product_id: 'product-2', code: 'W-1', name: 'Agua', unit: 'botellas', physical_quantity: 2, reason: null, expected_quantity: null, initialized: false },
      ] },
      expected_cash_at_close_minor: null, current_expected_cash_minor: 50000, counted_cash_minor: null, difference_minor: null, closing_notes: null,
    };
    admin.request.mockImplementation(async path => {
      if (path === '/api/v1/registers') return new Response(JSON.stringify([register]));
      if (path.startsWith('/api/v1/shifts?')) return new Response(JSON.stringify({ items: [shift], total: 1, offset: 0, limit: 100 }));
      if (path.startsWith('/api/v1/shifts/current?')) return new Response(JSON.stringify(shift));
      if (path.endsWith('/summary')) return new Response(JSON.stringify({
        shift_id: shift.id, confirmed_minor: 0, confirmed_cash_minor: 0, pending_transfer_minor: 0,
        payment_methods: [], activities: [], payments: [], expected_cash_minor: 50000,
      }));
      return new Response('{}');
    });

    render(<MemoryRouter initialEntries={['/owner/shifts']}><ProductRoutes /></MemoryRouter>);

    expect(await screen.findByText(/4 piezas · esperado al abrir: 5 piezas · Motivo: Diferencia verificada/)).toBeInTheDocument();
    expect(screen.getByText(/2 botellas · esperado al abrir: Sin registrar/)).toBeInTheDocument();
    expect(screen.queryByText(/stock actual/i)).not.toBeInTheDocument();
  });

  it('opens from the authenticated route with an explicit zero manual total and the captured snapshot', async () => {
    const register = { id: 'register-1', branch_id: 'branch-1', code: 'front', name: 'Recepción', status: 'active', has_open_shift: false };
    let opened = false;
    const shift = {
      id: 'shift-1', cash_register_id: register.id, opened_by: 'admin-1', opened_at: '2026-10-26T14:00:00Z', closed_at: null,
      status: 'open', opening_cash_minor: 0, denomination_counts: [], closing_denomination_counts: [], inventory_review: null,
      expected_cash_at_close_minor: null, current_expected_cash_minor: 0, counted_cash_minor: null, difference_minor: null, closing_notes: null,
    };
    admin.request.mockImplementation(async (path, init) => {
      if (path === '/api/v1/registers') return new Response(JSON.stringify([register]));
      if (path.endsWith('/inventory-snapshots')) return new Response(JSON.stringify({ id: 'snapshot-1', source_state: 'initialized', items: [{ product_id: 'product-1', name: 'Toalla', unit: 'piezas', initialized: true, expected_quantity: 2 }] }));
      if (path.startsWith('/api/v1/shifts?')) return new Response(JSON.stringify({ items: opened ? [shift] : [], total: opened ? 1 : 0, offset: 0, limit: 100 }));
      if (path.startsWith('/api/v1/shifts/current?')) return opened ? new Response(JSON.stringify(shift)) : new Response('{}', { status: 404 });
      if (path === '/api/v1/shifts/open' && init?.method === 'POST') { opened = true; return new Response(JSON.stringify(shift), { status: 201 }); }
      if (path.endsWith('/summary')) return new Response(JSON.stringify({ shift_id: shift.id, confirmed_minor: 0, confirmed_cash_minor: 0, pending_transfer_minor: 0, payment_methods: [], activities: [], payments: [], expected_cash_minor: 0 }));
      return new Response('{}');
    });

    render(<MemoryRouter initialEntries={['/owner/shifts']}><ProductRoutes /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir Turno' }));
    await userEvent.selectOptions(await screen.findByLabelText('Forma de conteo'), 'manual');
    await userEvent.type(screen.getByLabelText('Fondo inicial (MXN)'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Continuar a Inventario →' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar a Resumen →' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e Iniciar Turno' }));

    await waitFor(() => expect(admin.request).toHaveBeenCalledWith('/api/v1/shifts/open', expect.objectContaining({ method: 'POST' })));
    const request = admin.request.mock.calls.find(([path]) => path === '/api/v1/shifts/open');
    const payload = JSON.parse(String(request?.[1]?.body));
    expect(payload).toMatchObject({ cash_register_id: register.id, inventory_snapshot_id: 'snapshot-1', opening_cash_minor: 0,
      inventory_observations: [{ product_id: 'product-1', physical_quantity: 2 }] });
    expect(payload).not.toHaveProperty('denomination_counts');
    expect(await screen.findByText('Turno abierto exitosamente.')).toBeInTheDocument();
  });

  it('keeps the API opening draft open and unchanged when the real controller receives a 422', async () => {
    const register = { id: 'register-1', branch_id: 'branch-1', code: 'front', name: 'Recepción', status: 'active', has_open_shift: false };
    let resolveOpen!: (response: Response) => void;
    const pendingOpen = new Promise<Response>(resolve => { resolveOpen = resolve; });
    admin.request.mockImplementation(async (path, init) => {
      if (path === '/api/v1/registers') return new Response(JSON.stringify([register]));
      if (path.endsWith('/inventory-snapshots')) return new Response(JSON.stringify({ id: 'snapshot-1', source_state: 'initialized', items: [
        { product_id: 'protein', name: 'Protein', unit: 'pieces', initialized: true, expected_quantity: 5 },
        { product_id: 'water', name: 'Water', unit: 'bottles', initialized: true, expected_quantity: 10 },
      ] }));
      if (path.startsWith('/api/v1/shifts?')) return new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 100 }));
      if (path.startsWith('/api/v1/shifts/current?')) return new Response('{}', { status: 404 });
      if (path === '/api/v1/shifts/open' && init?.method === 'POST') return pendingOpen;
      return new Response('{}');
    });

    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/owner/shifts']}><ProductRoutes /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Abrir Turno' }));
    await user.type(await screen.findByLabelText('Billete $100.00 · cantidad'), '3');
    await user.type(screen.getByLabelText('Billete $50.00 · cantidad'), '4');
    await user.click(screen.getByRole('button', { name: 'Continuar a Inventario →' }));
    fireEvent.change(screen.getByLabelText('Stock físico de Protein'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Stock físico de Water'), { target: { value: '11' } });

    await user.click(screen.getByRole('button', { name: 'Continuar a Resumen →' }));
    expect(screen.getByText('2. Inventario Inicial')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Indica el motivo de la diferencia de Protein.');
    await user.selectOptions(screen.getByLabelText('Motivo de diferencia para Protein'), 'Otro motivo');
    await user.selectOptions(screen.getByLabelText('Motivo de diferencia para Water'), 'Otro motivo');
    await user.click(screen.getByRole('button', { name: 'Continuar a Resumen →' }));
    expect(screen.getByText('2. Inventario Inicial')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Indica el motivo de la diferencia de Protein.');
    await user.type(screen.getAllByPlaceholderText('Especificar motivo...')[0], 'Conteo físico verificado');
    await user.selectOptions(screen.getByLabelText('Motivo de diferencia para Water'), 'Caducidad');
    await user.click(screen.getByRole('button', { name: 'Continuar a Resumen →' }));

    const confirm = screen.getByRole('button', { name: 'Confirmar e Iniciar Turno' });
    await user.click(confirm);
    await waitFor(() => expect(admin.request).toHaveBeenCalledWith('/api/v1/shifts/open', expect.objectContaining({ method: 'POST' })));
    const payload = JSON.parse(String(admin.request.mock.calls.find(([path]) => path === '/api/v1/shifts/open')?.[1]?.body));
    expect(payload).toMatchObject({ cash_register_id: register.id, inventory_snapshot_id: 'snapshot-1', denomination_counts: [
      { denomination_minor: 10000, quantity: 3 }, { denomination_minor: 5000, quantity: 4 },
    ], inventory_observations: [
      { product_id: 'protein', physical_quantity: 4, reason: 'Conteo físico verificado' },
      { product_id: 'water', physical_quantity: 11, reason: 'Caducidad' },
    ] });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(admin.request.mock.calls.filter(([path]) => path === '/api/v1/shifts/open')).toHaveLength(1);

    resolveOpen(new Response(JSON.stringify({ detail: 'Revisa los datos enviados.' }), { status: 422 }));
    const dialog = screen.getByRole('dialog', { name: 'Iniciar Nuevo Turno de Trabajo' });
    expect(await within(dialog).findByText('Revisa los datos enviados e intenta nuevamente.')).toBeInTheDocument();
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByLabelText('Billete $100.00 · cantidad')).toHaveValue('3');
    expect(screen.getByLabelText('Billete $50.00 · cantidad')).toHaveValue('4');
    await user.click(screen.getByRole('button', { name: 'Continuar a Inventario →' }));
    expect(screen.getByLabelText('Stock físico de Protein')).toHaveValue(4);
    expect(screen.getByLabelText('Stock físico de Water')).toHaveValue(11);
    expect(screen.getAllByPlaceholderText('Especificar motivo...')[0]).toHaveValue('Conteo físico verificado');
    expect(screen.getByLabelText('Motivo de diferencia para Water')).toHaveValue('Caducidad');
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
    await userEvent.click(screen.getByRole('tab', { name: 'Expediente' }));
    expect(screen.getByRole('heading', { name: 'Asistencia previa' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Períodos de membresía' })).toBeInTheDocument();
    expect(await screen.findByText('Plan adicional')).toBeInTheDocument();
    expect(await screen.findByText('Adeudos pendientes')).toBeInTheDocument();
    expect(screen.getByText('order-1')).toBeInTheDocument();
    expect(screen.getByText('$150.00 MXN')).toBeInTheDocument();
    expect(screen.getByText('$125.00 MXN')).toBeInTheDocument();
    expect(screen.queryByText(/0 meses/i)).not.toBeInTheDocument();
    expect(screen.getByText('Historial de compras no disponible')).toBeInTheDocument();
    expect(screen.getAllByText('No disponible en esta integración')).toHaveLength(2);
    expect(screen.getByText(/Vencimiento: No disponible en esta integración/)).toBeInTheDocument();
    expect(screen.queryByText('Sin asignación')).not.toBeInTheDocument();
    expect(screen.queryByText('Sin compras registradas')).not.toBeInTheDocument();
    expect(screen.getByText('Frecuencia histórica no disponible')).toBeInTheDocument();
    expect(screen.getByText('Últimas visitas (máximo 12)')).toBeInTheDocument();
    expect(screen.getByText('Períodos activos informados por la API; no representa el historial completo de pagos.')).toBeInTheDocument();
    expect(screen.queryByText(/visitas totales/i)).not.toBeInTheDocument();
    expect(admin.request).toHaveBeenCalledWith(`/api/v1/members/${member.id}/reload?visit_limit=12`, expect.any(Object));
    await userEvent.click(screen.getByRole('tab', { name: 'Mostrador' }));
    expect(screen.getByRole('region', { name: 'Vista operativa de mostrador' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar entrada' })).toBeInTheDocument();
  });

  it('routes reception staff attendance through the operating profile and API roster', async () => {
    const branchId = '423e4567-e89b-42d3-a456-426614174000';
    access.principal = { kind: 'employee', identity: { id: 'reception-1', display_name: 'Reception', is_owner: false, can_manage_employees: false }, branch: { branch_id: branchId }, session: { purpose: 'reception', accessToken: 'session-token' } };
    render(<MemoryRouter initialEntries={['/reception/staff']}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByText('Pase de Lista del Personal')).toBeInTheDocument();
    expect(await screen.findByText('API Employee')).toBeInTheDocument();
    expect(screen.getByTestId('staff-card-profile-1')).not.toHaveTextContent('·');
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
          total_pending_balance_minor: null, currency: 'MXN', debts: [{ debt_id: 'debt-1', order_id: 'order-1', branch_id: 'branch-1',
            currency: 'MXN', initial_outstanding_minor: 15000, remaining_balance_minor: 12500, created_at: '2026-01-02T12:00:00Z' }] }, recent_visits: [], server_time: '2026-01-02T12:00:00Z',
      }));
      if (path.endsWith(`/members/${member.id}`)) return new Response(JSON.stringify({ ...member, email: null, birth_date: null, notes: null, pending_balance_minor: 12500, has_pending_balance: true }));
      return new Response('{}');
    });
    render(<MemoryRouter initialEntries={[`/reception/members/${member.id}`]}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText('Adeudos pendientes')).not.toBeInTheDocument();
    expect(screen.queryByText('order-1')).not.toBeInTheDocument();
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

  it('loads and searches members beyond the first API page, then opens the matched DTO', async () => {
    const laterMember = { ...member, id: '223e4567-e89b-42d3-a456-426614174099', member_number: 'M-101', full_name: 'Later Page Member' };
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...member,
      id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
      member_number: `M-${String(index + 1).padStart(3, '0')}`,
      full_name: `Member ${index + 1}`,
    }));
    admin.request.mockImplementation(async path => {
      if (path.startsWith('/api/v1/members?')) {
        const page = new URLSearchParams(path.split('?')[1]).get('page');
        return new Response(JSON.stringify({ items: page === '2' ? [laterMember] : firstPage, total: 101, page: Number(page ?? 1), limit: 100, pages: 2 }));
      }
      if (path.endsWith('/reload?visit_limit=12')) return new Response(JSON.stringify({
        profile: {}, active_periods: [], class_samples: [], financial: { has_pending_balance: false, credit_balance_minor: 0,
          total_pending_balance_minor: 0, currency: 'MXN', debts: [] }, recent_visits: [], server_time: '2026-01-02T12:00:00Z',
      }));
      if (path.endsWith(`/members/${laterMember.id}`)) return new Response(JSON.stringify({ ...laterMember, email: null, birth_date: null, notes: null, pending_balance_minor: 0, has_pending_balance: false }));
      return new Response('{}');
    });

    render(<MemoryRouter initialEntries={['/owner/members']}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: 'Member 1' })).toBeInTheDocument();
    await waitFor(() => expect(admin.request).toHaveBeenCalledWith('/api/v1/members?page=2&limit=100', expect.any(Object)));
    const search = screen.getByRole('textbox', { name: 'Buscar socio' });
    await userEvent.type(search, 'M-101');
    await userEvent.click(screen.getByRole('link', { name: 'Later Page Member' }));
    expect(await screen.findByText('Later Page Member')).toBeInTheDocument();
    expect(admin.request).toHaveBeenCalledWith(`/api/v1/members/${laterMember.id}`, expect.any(Object));
  });

  it('searches API-backed members by preferred name, legal name, and member number', async () => {
    const namedMember = { ...member, preferred_name: 'Fixture Member', full_name: 'Synthetic Member One', member_number: 'SYN0001' };
    admin.request.mockResolvedValueOnce(new Response(JSON.stringify({ items: [namedMember], total: 1, page: 1, limit: 100, pages: 1 })));
    render(<MemoryRouter initialEntries={['/owner/members']}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: 'Fixture Member' })).toBeInTheDocument();
    const search = screen.getByRole('textbox', { name: 'Buscar socio' });
    for (const term of ['Synthetic Member One', 'SYN0001', 'Fixture Member']) {
      await userEvent.clear(search);
      await userEvent.type(search, term);
      expect(screen.getByRole('link', { name: 'Fixture Member' })).toBeInTheDocument();
    }
  });

  it('/reception/members/new and /owner/members/new render the live creation form instead of treating "new" as a :memberId lookup', async () => {
    // 1. Owner route
    render(<MemoryRouter initialEntries={['/owner/members/new']}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Nuevo socio' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre completo')).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar socio' })).toBeInTheDocument();
    expect(admin.request).not.toHaveBeenCalledWith(expect.stringContaining('/members/new'), expect.any(Object));

    cleanup();

    // 2. Receptionist route
    access.principal = {
      kind: 'employee',
      identity: { id: 'emp-1', display_name: 'Receptionist' },
      branch: { branch_id: 'branch-1', name: 'Central Branch' },
      session: { purpose: 'desk' },
    };
    render(<MemoryRouter initialEntries={['/reception/members/new']}><ProductRoutes /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Nuevo socio' })).toBeInTheDocument();
    expect(access.request).not.toHaveBeenCalledWith(expect.stringContaining('/members/new'), expect.any(Object));
  });
});
