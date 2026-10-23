import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoProvider } from '../../demo/DemoProvider';
import { resetStaff, setSelectedStaff } from '../staff/staffStore';
import { StaffAttendanceView } from './StaffAttendanceView';

const testBranchId = '00000000-0000-4000-8000-000000000001';

describe('StaffAttendanceView', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_API_BASE_URL', 'https://gym.example');
    vi.stubEnv('VITE_BRANCH_ID', testBranchId);
    vi.restoreAllMocks();
    resetStaff();
    setSelectedStaff({ id: 'staff-sheila', name: 'Sheila' });
  });

  function renderView() {
    return render(
      <DemoProvider>
        <StaffAttendanceView />
      </DemoProvider>
    );
  }

  it('renders the header, KPIs and employee cards with department indicators', async () => {
    renderView();

    expect(screen.getByText('RECEPCIÓN · PERSONAL')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pase de Lista del Personal' })).toBeInTheDocument();

    // Bento KPIs
    expect(screen.getByText('En Turno')).toBeInTheDocument();
    expect(screen.getByText('Fuera del Gym')).toBeInTheDocument();
    expect(screen.getByText('Total Equipo')).toBeInTheDocument();
    expect(screen.getAllByText('Sheila').length).toBeGreaterThan(0);

    // Verify employees exist
    expect(screen.getByTestId('staff-card-staff-mikel')).toBeInTheDocument();
    expect(screen.getByTestId('staff-card-staff-charly')).toBeInTheDocument();
    expect(screen.getByTestId('staff-card-staff-silvia')).toBeInTheDocument();

    // Verify departments
    expect(screen.getAllByText('Entrenador').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mantenimiento').length).toBeGreaterThan(0);
  });

  it('displays status indicator: Fuera del gym (gray) vs En turno (green with check-in time)', async () => {
    renderView();

    // From initial seed, Mikel is in turn
    const mikelCard = screen.getByTestId('staff-card-staff-mikel');
    expect(mikelCard).toHaveTextContent('En turno');
    expect(mikelCard).toHaveTextContent('Hora de entrada:');
    expect(mikelCard).toHaveTextContent('07:00 hrs');
    expect(mikelCard).toHaveTextContent('Registrado por:');

    // Charly is outside the gym
    const charlyCard = screen.getByTestId('staff-card-staff-charly');
    expect(charlyCard).toHaveTextContent('Fuera del gym');
    expect(charlyCard).toHaveTextContent('Marcar Entrada');
  });

  it('records check-in with one click, storing clock_in_at, recorded_by, and optional note', async () => {
    const user = userEvent.setup();
    renderView();

    const charlyCard = screen.getByTestId('staff-card-staff-charly');
    expect(charlyCard).toHaveTextContent('Fuera del gym');

    // Type optional note
    const noteInput = screen.getByLabelText('Nota opcional de entrada para Charly');
    await user.type(noteInput, 'Llegó 15 min tarde con justificante');

    // Click Marcar Entrada
    const checkInBtn = screen.getByRole('button', { name: 'Marcar entrada para Charly' });
    await user.click(checkInBtn);

    // Verify Charly is now in turn
    await waitFor(() => {
      expect(charlyCard).toHaveTextContent('En turno');
      expect(charlyCard).toHaveTextContent('Nota: Llegó 15 min tarde con justificante');
      expect(charlyCard).toHaveTextContent('Sheila');
    });

    // Shows Marcar Salida button
    expect(screen.getByRole('button', { name: 'Marcar salida para Charly' })).toBeInTheDocument();
  });

  it('records check-out when employee finishes shift', async () => {
    const user = userEvent.setup();
    renderView();

    const mikelCard = screen.getByTestId('staff-card-staff-mikel');
    expect(mikelCard).toHaveTextContent('En turno');

    // Click Marcar Salida
    const checkOutBtn = screen.getByRole('button', { name: 'Marcar salida para Mikel' });
    await user.click(checkOutBtn);

    // Verify Mikel is now outside the gym
    await waitFor(() => {
      expect(mikelCard).toHaveTextContent('Fuera del gym');
    });

    expect(screen.getByRole('button', { name: 'Marcar entrada para Mikel' })).toBeInTheDocument();
  });

  it('filters employees by search query', async () => {
    const user = userEvent.setup();
    renderView();

    const searchInput = screen.getByLabelText('Buscar empleado');
    await user.type(searchInput, 'Silvia');

    expect(screen.getByTestId('staff-card-staff-silvia')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-charly')).not.toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-mikel')).not.toBeInTheDocument();
  });

  it('filters employees by department pills', async () => {
    const user = userEvent.setup();
    renderView();

    const maintenancePill = screen.getByRole('button', { name: 'Mantenimiento' });
    await user.click(maintenancePill);

    expect(screen.getByTestId('staff-card-staff-silvia')).toBeInTheDocument();
    expect(screen.getByTestId('staff-card-staff-alan')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-mikel')).not.toBeInTheDocument();
  });

  it('filters employees by status pills (En turno / Fuera del gym)', async () => {
    const user = userEvent.setup();
    renderView();

    const inTurnPill = screen.getByRole('button', { name: /En turno/ });
    await user.click(inTurnPill);

    expect(screen.getByTestId('staff-card-staff-mikel')).toBeInTheDocument();
    expect(screen.getByTestId('staff-card-staff-silvia')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-charly')).not.toBeInTheDocument();

    const outPill = screen.getByRole('button', { name: /Fuera del gym/ });
    await user.click(outPill);

    expect(screen.getByTestId('staff-card-staff-charly')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-mikel')).not.toBeInTheDocument();
  });

  it('displays the audit table with recorded check-ins', () => {
    renderView();

    expect(screen.getByRole('heading', { name: 'Historial de registros de hoy' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Tabla de registros de asistencia del personal' })).toBeInTheDocument();
    expect(screen.getAllByText('Sheila').length).toBeGreaterThan(0);
  });

  describe('Live Operational Mode', () => {
    it('successfully loads server-accepted attendance items and review required badge', async () => {
      sessionStorage.setItem('evogym:operational-session', 'valid-bearer-token');

      const mockItems = [
        {
          id: 'att-mikel',
          profile_id: 'staff-mikel',
          branch_id: testBranchId,
          full_name: 'Mikel',
          position: 'Entrenador',
          recorded_by: 'Supervisor Central',
          occurred_at: '2026-10-23T07:00:00Z',
          business_date: '2026-10-23',
          status: 'present',
          expected_entry_time: '07:00:00',
          grace_tolerance_minutes: 15,
          checkout_at: null,
          checkout_recorded_by: null,
          series_id: 'series-mikel',
          occurrence_date: '2026-10-23',
          device_captured_at: '2026-10-23T07:00:00Z',
          server_received_at: '2026-10-23T07:00:05Z',
          idempotency_key: 'idem-mikel',
          clock_validation_status: 'accepted',
          review_required: false,
          schedule_conflict: false,
        },
        {
          id: 'att-charly',
          profile_id: 'staff-charly',
          branch_id: testBranchId,
          full_name: 'Charly',
          position: 'Staff',
          recorded_by: 'Supervisor Central',
          occurred_at: '2026-10-23T09:20:00Z',
          business_date: '2026-10-23',
          status: 'late',
          expected_entry_time: '09:00:00',
          grace_tolerance_minutes: 10,
          checkout_at: null,
          checkout_recorded_by: null,
          series_id: 'series-charly',
          occurrence_date: '2026-10-23',
          device_captured_at: '2026-10-23T09:20:00Z',
          server_received_at: '2026-10-23T09:20:02Z',
          idempotency_key: 'idem-charly',
          clock_validation_status: 'review_required',
          review_required: true,
          schedule_conflict: false,
        },
      ];

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/api/v1/staff-attendance')) {
          return new Response(JSON.stringify({ items: mockItems, total: 2 }), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      });

      renderView();

      // Mikel should show present mark and in-turn status
      await waitFor(() => {
        const mikelCard = screen.getByTestId('staff-card-staff-mikel');
        expect(mikelCard).toHaveTextContent('En turno');
        expect(mikelCard).toHaveTextContent('present');
      });

      // Charly should show late mark and review required badge
      const charlyCard = screen.getByTestId('staff-card-staff-charly');
      expect(charlyCard).toHaveTextContent('En turno');
      expect(charlyCard).toHaveTextContent('late');
      expect(charlyCard).toHaveTextContent('Revisión requerida');
    });

    it('performs live clock-in and clock-out with server responses', async () => {
      const user = userEvent.setup();
      sessionStorage.setItem('evogym:operational-session', 'live-token');

      let currentAttendance: any[] = [];

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (url.includes('/api/v1/staff-attendance') && method === 'GET') {
          return new Response(JSON.stringify({ items: currentAttendance, total: currentAttendance.length }), { status: 200 });
        }

        if (url.includes('/profiles/staff-charly') && method === 'POST') {
          const body = JSON.parse(String(init?.body || '{}'));
          const newItem = {
            id: 'att-live-charly',
            profile_id: 'staff-charly',
            branch_id: testBranchId,
            full_name: 'Charly',
            position: 'Staff',
            recorded_by: 'Operador Recepción',
            occurred_at: '2026-10-23T08:00:00Z',
            business_date: '2026-10-23',
            status: 'present',
            expected_entry_time: '08:00:00',
            grace_tolerance_minutes: 10,
            checkout_at: null,
            checkout_recorded_by: null,
            series_id: null,
            occurrence_date: '2026-10-23',
            device_captured_at: body.device_captured_at,
            server_received_at: new Date().toISOString(),
            idempotency_key: body.idempotency_key,
            clock_validation_status: 'accepted',
            review_required: false,
            schedule_conflict: false,
          };
          currentAttendance = [newItem];
          return new Response(JSON.stringify(newItem), { status: 201 });
        }

        if (url.includes('/att-live-charly/checkout') && method === 'POST') {
          return new Response(
            JSON.stringify({
              id: 'chk-live-charly',
              attendance_id: 'att-live-charly',
              recorded_by: 'Operador Recepción',
              occurred_at: '2026-10-23T16:00:00Z',
            }),
            { status: 200 }
          );
        }

        return new Response('Not Found', { status: 404 });
      });

      renderView();

      const charlyCard = screen.getByTestId('staff-card-staff-charly');
      expect(charlyCard).toHaveTextContent('Fuera del gym');

      // Click Marcar Entrada in live mode
      const clockInBtn = screen.getByRole('button', { name: 'Marcar entrada para Charly' });
      await user.click(clockInBtn);

      // Verify card updates to En turno
      await waitFor(() => {
        expect(charlyCard).toHaveTextContent('En turno');
        expect(screen.getByText('Entrada registrada')).toBeInTheDocument();
      });

      // Shows Marcar Salida button
      const clockOutBtn = screen.getByRole('button', { name: 'Marcar salida para Charly' });
      expect(clockOutBtn).toBeInTheDocument();

      // Click Marcar Salida in live mode
      await user.click(clockOutBtn);

      // Verify checkout completed and status returns to Fuera del gym
      await waitFor(() => {
        expect(charlyCard).toHaveTextContent('Fuera del gym');
        expect(screen.getByText('Salida registrada')).toBeInTheDocument();
      });
    });

    it('handles live API errors for 409 conflict and 403 forbidden', async () => {
      const user = userEvent.setup();
      sessionStorage.setItem('evogym:operational-session', 'live-token');

      let responseStatus = 409;
      let responseBody = {
        error: {
          code: 'ATTENDANCE_CONFLICT',
          message: 'Conflicto de turno detectado',
        },
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (url.includes('/api/v1/staff-attendance') && method === 'GET') {
          return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
        }

        if (method === 'POST') {
          return new Response(JSON.stringify(responseBody), { status: responseStatus });
        }

        return new Response('Not Found', { status: 404 });
      });

      renderView();

      const clockInBtn = screen.getByRole('button', { name: 'Marcar entrada para Charly' });
      await user.click(clockInBtn);

      // Verify 409 conflict error toast
      await waitFor(() => {
        expect(screen.getByText('Error al marcar entrada')).toBeInTheDocument();
        expect(
          screen.getByText('La solicitud entra en conflicto con el estado actual.')
        ).toBeInTheDocument();
      });

      // Switch to 403 forbidden
      responseStatus = 403;
      responseBody = {
        error: {
          code: 'FORBIDDEN',
          message: 'Sin permisos de recepcionista',
        },
      };

      await user.click(clockInBtn);

      // Verify 403 forbidden error toast
      await waitFor(() => {
        expect(
          screen.getByText('No tienes autorización para realizar esta acción.')
        ).toBeInTheDocument();
      });
    });
  });
});
