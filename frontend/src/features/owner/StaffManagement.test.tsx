import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockAdminSession: any = null;
vi.mock('../auth/AdminSessionProvider', () => ({
  useAdminSession: () => {
    if (!mockAdminSession) throw new Error('No admin session');
    return mockAdminSession;
  },
  useOptionalAdminSession: () => mockAdminSession,
}));

import { ApiStaffManagement } from './StaffManagement';
import { App } from '../../app/App';
import { DemoProvider } from '../../demo/DemoProvider';
import { resetStaff } from '../staff/staffStore';

async function mount(path = '/owner/staff') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <DemoProvider>
        <App />
      </DemoProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando pantalla' })).not.toBeInTheDocument(), { timeout: 10000 });
}

describe('StaffManagement (T02 — Admin Staff Management)', () => {
  beforeEach(() => {
    resetStaff();
    mockAdminSession = null;
  });

  it('renders reception staff table with salary and without KPI summary cards', async () => {
    await mount('/owner/staff');

    expect(screen.getByRole('heading', { name: 'Equipo de Recepción' })).toBeVisible();
    // Verify NO KPI cards are rendered
    expect(screen.queryByText(/Total recepcionistas/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Perfiles activos/i)).not.toBeInTheDocument();

    // Verify receptionists are listed with shift, salary, and credential indicator
    expect(screen.getByText('Emigdio')).toBeVisible();
    expect(screen.getByText('Sheila')).toBeVisible();
    expect(screen.getAllByText('$14,000.00')[0]).toBeVisible(); // Emigdio's salary
    expect(screen.getAllByText('🔒 Con PIN').length).toBeGreaterThan(0);
    expect(screen.getAllByText('⚡ Acceso directo').length).toBeGreaterThan(0);
  });

  it('filters staff by search query and status filter buttons', async () => {
    await mount('/owner/staff');

    // Search for Sheila
    await userEvent.type(screen.getByLabelText('Buscar recepcionista'), 'Sheila');
    expect(screen.getByText('Sheila')).toBeVisible();
    expect(screen.queryByText('Emigdio')).not.toBeInTheDocument();

    // Clear search
    await userEvent.clear(screen.getByLabelText('Buscar recepcionista'));
    expect(screen.getByText('Emigdio')).toBeVisible();

    // Inactive filter with JellyRadio (initially all are active)
    await userEvent.click(screen.getByRole('radio', { name: 'Inactivos' }));
    expect(
      screen.getByText('No se encontraron recepcionistas con los criterios actuales.')
    ).toBeVisible();

    // Return to Todos with JellyRadio
    await userEvent.click(screen.getByRole('radio', { name: 'Todos' }));
    expect(screen.getByText('Emigdio')).toBeVisible();
  });

  it('toggles staff active/inactive status and reflects in profile selection', async () => {
    await mount('/owner/staff');

    // Find Sheila row and deactivate her
    const deactivateButtons = screen.getAllByRole('button', { name: 'Desactivar' });
    // Sheila is the second receptionist
    await userEvent.click(deactivateButtons[1]);

    // Check toast notification is shown
    expect(screen.getByText(/ya no aparecerá en la pantalla de inicio/)).toBeInTheDocument();

    // Sheila now shows Activar button
    expect(screen.getByRole('button', { name: 'Activar' })).toBeVisible();
  });

  it('validates 2-phase PIN matching when creating a new receptionist with salary', async () => {
    await mount('/owner/staff');

    await userEvent.click(screen.getByRole('button', { name: '+ Nuevo recepcionista' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Nuevo Recepcionista' })).toBeVisible();

    await userEvent.type(screen.getByLabelText('Nombre completo *'), 'Lucía Ramos');
    await userEvent.clear(screen.getByLabelText('Sueldo mensual (MXN) *'));
    await userEvent.type(screen.getByLabelText('Sueldo mensual (MXN) *'), '9000');

    // Enable PIN switch
    await userEvent.click(screen.getByRole('switch', { name: 'Activar PIN de acceso' }));

    // Type non-matching PINs
    const pin1Input = screen.getByLabelText('Primer ingreso del PIN');
    const pin2Input = screen.getByLabelText('Confirmación del PIN');

    await userEvent.type(pin1Input, '5678');
    await userEvent.type(pin2Input, '9999');

    // Error should be indicated
    expect(screen.getByText('Los PINs no coinciden. Por favor verifica.')).toBeInTheDocument();
    // Save button should be disabled
    expect(screen.getByRole('button', { name: 'Crear perfil' })).toBeDisabled();

    // Correct second PIN to match using backspaces to clear slots
    await userEvent.type(pin2Input, '{backspace}{backspace}{backspace}{backspace}5678');
    expect(screen.getByText('✓ PIN confirmado correctamente')).toBeInTheDocument();

    // Submit form
    await userEvent.click(screen.getByRole('button', { name: 'Crear perfil' }));

    // Lucía Ramos is now in the table with $9,000.00
    expect(screen.getByText('Lucía Ramos')).toBeVisible();
    expect(screen.getByText('$9,000.00')).toBeVisible();
  });

  it('displays active and inactive counts and allows selecting status in the modal with JellyRadio', async () => {
    await mount('/owner/staff');

    // Header displays counts
    expect(screen.getByText(/9 en total/)).toHaveTextContent('9 activos · 0 inactivos · 9 en total');

    // Open create modal and select Inactivo
    await userEvent.click(screen.getByRole('button', { name: '+ Nuevo recepcionista' }));
    await userEvent.type(screen.getByLabelText('Nombre completo *'), 'Esteban Morales');

    // Select Inactivo via JellyRadio in modal
    await userEvent.click(screen.getByRole('radio', { name: '○ Inactivo' }));

    // Submit form
    await userEvent.click(screen.getByRole('button', { name: 'Crear perfil' }));

    // Count updates
    expect(screen.getByText(/10 en total/)).toHaveTextContent('9 activos · 1 inactivos · 10 en total');

    // Esteban Morales is created with badge ○ Inactivo
    expect(screen.getByText('Esteban Morales')).toBeVisible();
    expect(screen.getByText('○ Inactivo')).toBeVisible();
  });

  it('supports interactive column sorting with TanStack Table', async () => {
    await mount('/owner/staff');

    // Initially in default list order: Emigdio is first row
    const rowsInitial = screen.getAllByRole('row');
    expect(rowsInitial[1]).toHaveTextContent('Emigdio');

    // Sort by Recepcionista column (click sort button)
    const sortNameBtn = screen.getByRole('button', { name: /ordenar por recepcionista/i });
    await userEvent.click(sortNameBtn);

    // Ascending: Alan should now be the first row
    const rowsAsc = screen.getAllByRole('row');
    expect(rowsAsc[1]).toHaveTextContent('Alan');

    // Click again for descending sort: Tadeo is first row
    await userEvent.click(sortNameBtn);
    const rowsDesc = screen.getAllByRole('row');
    expect(rowsDesc[1]).toHaveTextContent('Tadeo');

    // Click on Sueldo mensual sort button
    const sortSalaryBtn = screen.getByRole('button', { name: /ordenar por sueldo mensual/i });
    await userEvent.click(sortSalaryBtn);

    // Ascending: Iñaky ($4,000.00) is first
    const rowsSalaryAsc = screen.getAllByRole('row');
    expect(rowsSalaryAsc[1]).toHaveTextContent('Iñaky');
    expect(rowsSalaryAsc[1]).toHaveTextContent('$4,000.00');
  });

  it('opens DevicePairingModal when clicking Vincular Dispositivo button', async () => {
    await mount('/owner/staff');

    // Find "Vincular Dispositivo" buttons
    const pairButtons = screen.getAllByRole('button', { name: /vincular dispositivo/i });
    expect(pairButtons.length).toBeGreaterThan(0);

    // Click on the first one (Emigdio)
    await userEvent.click(pairButtons[0]);

    // Modal opens with employee info and 6-digit code
    expect(screen.getByRole('heading', { name: /vincular dispositivo/i })).toBeVisible();
    expect(screen.getAllByText(/Emigdio/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId('pairing-code-display')).toBeVisible();

    // Close modal
    const closeBtn = screen.getByRole('button', { name: /cerrar modal/i });
    await userEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('pairing-code-display')).not.toBeInTheDocument();
    });
  });
});


describe('ApiStaffManagement (F08 — Schedule Series & Exceptions)', () => {
  const branchId = '00000000-0000-4000-8000-000000000001';
  const profileId = '11111111-1111-4111-8111-111111111111';

  it('displays active schedule summary in Turno column and allows updating schedule', async () => {
    const user = userEvent.setup();
    let updatedPayload: any = null;

    const mockRequest = vi.fn().mockImplementation(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/api/v1/admin/staff-accounts/branches')) {
        return new Response(JSON.stringify({
          branches: [{ id: branchId, code: 'SUR', name: 'Sucursal Sur' }],
        }), { status: 200 });
      }
      if (path.includes('/roster-profiles')) {
        return new Response(JSON.stringify({
          profiles: [{ id: profileId, full_name: 'Lucia Mendez', position: 'Recepcionista', is_active: true, staff_user_id: null }],
        }), { status: 200 });
      }
      if (path.includes('/admin/staff-accounts?')) {
        return new Response(JSON.stringify({ accounts: [] }), { status: 200 });
      }
      if (path.includes('/api/v1/staff-schedules/branches/') && method === 'GET') {
        return new Response(JSON.stringify([
          {
            id: 'series-101',
            profile_id: profileId,
            branch_id: branchId,
            start_date: '2026-10-01',
            weekdays: [0, 1, 2, 3, 4],
            start_time: '06:00:00',
            end_time: '14:00:00',
            end_date: null,
            occurrence_count: null,
            cancelled_from: null,
          },
        ]), { status: 200 });
      }
      if (path.includes('/occurrences?') && method === 'GET') {
        return new Response(JSON.stringify([
          {
            series_id: 'series-101',
            local_date: '2026-10-28',
            local_start: '2026-10-28T06:00:00',
            local_end: '2026-10-28T14:00:00',
            starts_at: '2026-10-28T12:00:00Z',
            ends_at: '2026-10-28T20:00:00Z',
            timezone: 'America/Mexico_City',
            recorded_exception: null,
          },
        ]), { status: 200 });
      }
      if (path.includes('/edit') && method === 'PATCH') {
        updatedPayload = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({
          id: 'series-101',
          profile_id: profileId,
          branch_id: branchId,
          start_date: '2026-10-01',
          weekdays: updatedPayload.weekdays,
          start_time: updatedPayload.start_time,
          end_time: updatedPayload.end_time,
          end_date: null,
          occurrence_count: null,
          cancelled_from: null,
        }), { status: 201 });
      }
      return new Response('Not found', { status: 404 });
    });

    mockAdminSession = {
      status: 'authenticated',
      request: mockRequest,
    };

    render(
      <MemoryRouter>
        <ApiStaffManagement />
      </MemoryRouter>
    );

    // Wait for branch to load
    await waitFor(() => {
      expect(screen.getByText(/Sucursal Sur/)).toBeInTheDocument();
    });

    // Select branch
    const branchSelect = screen.getByLabelText('Sucursal');
    await user.selectOptions(branchSelect, branchId);

    // Turno column should display the active schedule summary
    await waitFor(() => {
      expect(screen.getByText('L, M, X, J, V · 06:00–14:00')).toBeInTheDocument();
    });

    // Open edit modal
    const editBtn = screen.getByRole('button', { name: 'Editar' });
    await user.click(editBtn);

    // Modal should show weekly recurring schedule card
    expect(screen.getByText('Horario semanal recurrente')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/2026-10-28/)).toBeInTheDocument();
    });

    // Change time and submit
    const startTimeInput = screen.getByLabelText('Hora inicio');
    await user.clear(startTimeInput);
    await user.type(startTimeInput, '07:00');

    const updateBtn = screen.getByRole('button', { name: 'Actualizar horario' });
    await user.click(updateBtn);

    await waitFor(() => {
      expect(screen.getByText('Horario actualizado correctamente.')).toBeInTheDocument();
    });
    expect(updatedPayload).not.toBeNull();
    expect(updatedPayload.start_time).toBe('07:00:00');
  });

  it('disables submit button while schedule request is in flight', async () => {
    const user = userEvent.setup();
    let resolvePost: (res: Response) => void;
    const postPromise = new Promise<Response>(resolve => {
      resolvePost = resolve;
    });

    const mockRequest = vi.fn().mockImplementation(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/api/v1/admin/staff-accounts/branches')) {
        return new Response(JSON.stringify({
          branches: [{ id: branchId, code: 'SUR', name: 'Sucursal Sur' }],
        }), { status: 200 });
      }
      if (path.includes('/roster-profiles')) {
        return new Response(JSON.stringify({
          profiles: [{ id: profileId, full_name: 'Lucia Mendez', position: 'Recepcionista', is_active: true, staff_user_id: null }],
        }), { status: 200 });
      }
      if (path.includes('/admin/staff-accounts?')) {
        return new Response(JSON.stringify({ accounts: [] }), { status: 200 });
      }
      if (path.includes('/api/v1/staff-schedules/branches/') && method === 'GET') {
        return new Response(JSON.stringify([]), { status: 200 }); // Sin horario
      }
      if (path.includes('/profiles/') && method === 'POST') {
        return postPromise; // In-flight
      }
      return new Response('Not found', { status: 404 });
    });

    mockAdminSession = {
      status: 'authenticated',
      request: mockRequest,
    };

    render(
      <MemoryRouter>
        <ApiStaffManagement />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText(/Sucursal Sur/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Sucursal'), branchId);

    // Displays Sin horario
    await waitFor(() => {
      expect(screen.getByText('Sin horario')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Editar' }));

    const assignBtn = screen.getByRole('button', { name: 'Asignar horario' });
    expect(assignBtn).not.toBeDisabled();

    // Click assign
    await user.click(assignBtn);

    // Button should be disabled and in flight
    expect(assignBtn).toBeDisabled();
    expect(screen.getByText('Guardando horario…')).toBeInTheDocument();

    // Resolve request
    resolvePost!(new Response(JSON.stringify({
      id: 'series-new',
      profile_id: profileId,
      branch_id: branchId,
      start_date: '2026-10-27',
      weekdays: [0, 1, 2, 3, 4],
      start_time: '06:00:00',
      end_time: '14:00:00',
      end_date: null,
      occurrence_count: null,
      cancelled_from: null,
    }), { status: 201 }));

    await waitFor(() => {
      expect(screen.getByText('Horario asignado correctamente.')).toBeInTheDocument();
    });
  });
});

it('requires an administrator to resolve a pending sale before disabling the account', async () => {
  const user = userEvent.setup();
  const branch = '00000000-0000-4000-8000-000000000001';
  const profile = '11111111-1111-4111-8111-111111111111';
  const staff = '22222222-2222-4222-8222-222222222222';
  const register = '33333333-3333-4333-8333-333333333333';
  let pending = true;
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/branches')) return new Response(JSON.stringify({ branches: [{ id: branch, code: 'B', name: 'Branch' }] }));
    if (path.includes('/roster-profiles')) return new Response(JSON.stringify({ profiles: [{ id: profile, full_name: 'Employee', position: 'Receptionist', is_active: true, staff_user_id: staff }] }));
    if (path.includes('/admin/staff-accounts?')) return new Response(JSON.stringify({ accounts: [{ id: staff, login_identifier: 'employee', is_active: true, link_state: 'linked', linked_profile_id: profile }] }));
    if (path.endsWith('/product-sale-intent/resolve')) { pending = false; return new Response(JSON.stringify({ status: 'cancelled' })); }
    if (path.endsWith('/product-sale-intent')) return new Response(JSON.stringify(pending ? { key: 'sale', register_id: register, payload: { expected_total_minor: 500, items: [{ product_id: register, quantity: 1 }] } } : null));
    if (path.includes('/deactivate/')) return new Response(null, { status: 204 });
    if (path.includes('/staff-schedules/')) return new Response(JSON.stringify([]));
    return new Response(null, { status: 404 });
  });
  mockAdminSession = { status: 'authenticated', request };
  render(<MemoryRouter><ApiStaffManagement /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(/Branch/)).toBeInTheDocument());
  await user.selectOptions(screen.getByLabelText('Sucursal'), branch);
  await user.click(await screen.findByRole('button', { name: 'Desactivar cuenta' }));
  expect(await screen.findByText(/Hay una venta pendiente/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirmar desactivación de cuenta' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Resolver venta pendiente' }));
  await user.click(await screen.findByRole('button', { name: 'Confirmar desactivación de cuenta' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('/deactivate/'), expect.objectContaining({ method: 'POST' })));
});
