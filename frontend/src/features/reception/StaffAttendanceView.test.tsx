import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoProvider } from '../../demo/DemoProvider';
import { resetStaff, setSelectedStaff } from '../staff/staffStore';
import { StaffAttendanceView } from './StaffAttendanceView';
import { businessDate } from '../../shared/formatters/date';

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
    // The seed is 07:00-06:00; the card renders it in the viewer's zone, so derive the hour instead of assuming Mexico.
    const seededHour = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date('2026-10-08T07:00:00-06:00'));
    expect(mikelCard).toHaveTextContent(`${seededHour} hrs`);
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

    // 1. Filter by Mantenimiento
    const maintenancePill = screen.getByRole('button', { name: 'Mantenimiento' });
    await user.click(maintenancePill);

    expect(screen.getByTestId('staff-card-staff-silvia')).toBeInTheDocument();
    expect(screen.getByTestId('staff-card-staff-alan')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-mikel')).not.toBeInTheDocument();

    // 2. Filter by Staff / Recepción
    const staffPill = screen.getByRole('button', { name: 'Staff / Recepción' });
    await user.click(staffPill);

    expect(screen.getByTestId('staff-card-staff-maho')).toBeInTheDocument();
    expect(screen.getByTestId('staff-card-staff-sheila')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-silvia')).not.toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-mikel')).not.toBeInTheDocument();

    // 3. Filter by Entrenadores
    const trainerPill = screen.getByRole('button', { name: 'Entrenadores' });
    await user.click(trainerPill);

    expect(screen.getByTestId('staff-card-staff-mikel')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-silvia')).not.toBeInTheDocument();
    expect(screen.queryByTestId('staff-card-staff-reception')).not.toBeInTheDocument();
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
    // Live mode comes only from props; tests route liveRequest through the mocked fetch.
    const liveRequest = (path: string, init: RequestInit = {}) => fetch(path, init);
    const liveStaff = [
      { id: 'staff-mikel', name: 'Mikel', shift: '07:00 - 15:00', active: true, avatarInitials: 'M', department: 'Entrenador' },
      { id: 'staff-charly', name: 'Charly', shift: '08:00 - 16:00', active: true, avatarInitials: 'C', department: 'Staff' },
    ];
    function renderLive() {
      return render(
        <DemoProvider>
          <StaffAttendanceView liveRequest={liveRequest} liveStaff={liveStaff} branchId={testBranchId} />
        </DemoProvider>
      );
    }

    it('successfully loads server-accepted attendance items and review required badge', async () => {

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

      renderLive();

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

      renderLive();

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

      renderLive();

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

    it('renders corrections column in live mode, shows append-only history, and allows submitting a correction', async () => {
      const user = userEvent.setup();

      const mockAttendance = [
        {
          id: 'att-live-100',
          profile_id: 'staff-charly',
          branch_id: testBranchId,
          full_name: 'Charly',
          position: 'Staff',
          recorded_by: 'Supervisor Central',
          occurred_at: '2026-10-23T08:00:00Z',
          business_date: '2026-10-23',
          status: 'present',
          expected_entry_time: '08:00:00',
          grace_tolerance_minutes: 10,
          checkout_at: null,
          checkout_recorded_by: null,
          series_id: null,
          occurrence_date: '2026-10-23',
          device_captured_at: '2026-10-23T08:00:00Z',
          server_received_at: '2026-10-23T08:00:02Z',
          idempotency_key: 'idem-charly-1',
          clock_validation_status: 'accepted',
          review_required: false,
          schedule_conflict: false,
        },
      ];

      const mockExistingCorrections = [
        {
          id: 'corr-001',
          attendance_id: 'att-live-100',
          correction_number: 1,
          field_name: 'notes',
          original_value: null,
          corrected_value: 'Registro verificado por supervisor',
          reason: 'Aclaración de registro inicial',
          actor_user_id: 'user-admin-1',
          created_at: '2026-10-23T08:05:00Z',
        },
      ];

      let submittedCorrection: any = null;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (url.includes('/api/v1/staff-attendance/branches/') && url.includes('/corrections') && method === 'GET') {
          return new Response(JSON.stringify(mockExistingCorrections), { status: 200 });
        }

        if (url.includes('/api/v1/staff-attendance') && method === 'GET') {
          return new Response(JSON.stringify({ items: mockAttendance, total: mockAttendance.length }), { status: 200 });
        }

        if (url.includes('/att-live-100/corrections') && method === 'POST') {
          submittedCorrection = JSON.parse(String(init?.body || '{}'));
          return new Response(
            JSON.stringify({
              id: 'corr-002',
              attendance_id: 'att-live-100',
              correction_number: 2,
              field_name: submittedCorrection.field_name,
              original_value: submittedCorrection.original_value,
              corrected_value: submittedCorrection.corrected_value,
              reason: submittedCorrection.reason,
              actor_user_id: 'user-admin-1',
              created_at: '2026-10-23T08:10:00Z',
            }),
            { status: 201 }
          );
        }

        return new Response('Not Found', { status: 404 });
      });

      renderLive();

      // Verify the Correcciones header exists in the audit table
      await waitFor(() => {
        expect(screen.getByRole('columnheader', { name: 'Correcciones' })).toBeInTheDocument();
      });

      // Verify the existing correction history is shown beneath the cell without overwriting original times
      expect(screen.getByText('notes:')).toBeInTheDocument();
      expect(screen.getByText(/Registro verificado por supervisor/)).toBeInTheDocument();
      expect(screen.getByText(/Aclaración de registro inicial/)).toBeInTheDocument();

      // Original entry time remains visible in the row
      expect(screen.getAllByText(/hrs/).length).toBeGreaterThanOrEqual(1);

      // Find Corregir button and click it to open the form
      const correctBtn = screen.getByRole('button', { name: 'Corregir' });
      await user.click(correctBtn);

      // Button toggles to Cerrar
      expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();

      // Form fields are visible
      const fieldSelect = screen.getByLabelText('Campo');
      const valInput = screen.getByLabelText('Valor corregido');
      const reasonInput = screen.getByLabelText('Motivo *');
      const saveCorrectionBtn = screen.getByRole('button', { name: 'Guardar corrección' });

      // Save button is initially disabled (empty inputs)
      expect(saveCorrectionBtn).toBeDisabled();

      // Select status and fill values
      await user.selectOptions(fieldSelect, 'status');
      await user.type(valInput, 'late');
      // Less than 5 chars reason should keep button disabled
      await user.type(reasonInput, 'abc');
      expect(saveCorrectionBtn).toBeDisabled();

      // Add full reason
      await user.type(reasonInput, ' Llegó con retraso confirmado');
      expect(saveCorrectionBtn).not.toBeDisabled();

      // Submit the correction
      await user.click(saveCorrectionBtn);

      // Verify success feedback
      await waitFor(() => {
        expect(screen.getByText('Corrección registrada')).toBeInTheDocument();
      });

      // Verify submitted payload
      expect(submittedCorrection).not.toBeNull();
      expect(submittedCorrection.field_name).toBe('status');
      expect(submittedCorrection.corrected_value).toBe('late');
      expect(submittedCorrection.reason).toContain('Llegó con retraso confirmado');

      // Verify new correction appears in the history
      expect(screen.getByText('status:')).toBeInTheDocument();
      expect(screen.getByText(/late/)).toBeInTheDocument();
    });

    it('prompts confirmation when unscheduled employee clocks in to cover colleague or perform support shift', async () => {
      const user = userEvent.setup();

      const liveStaffList = [
        { id: 'staff-alex', name: 'Alex', active: true, avatarInitials: 'A', department: 'Staff' },
        { id: 'staff-bob', name: 'Bob', shift: '08:00 - 16:00', active: true, avatarInitials: 'B', department: 'Entrenador' },
      ];

      const mockSchedules = [
        {
          id: 'series-bob',
          profile_id: 'staff-bob',
          branch_id: testBranchId,
          start_date: '2026-01-01',
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          start_time: '08:00:00',
          end_time: '16:00:00',
          end_date: null,
          occurrence_count: null,
          cancelled_from: null,
        },
      ];

      let recordedPayload: any = null;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (url.includes('/api/v1/staff-schedules/branches/') && method === 'GET') {
          return new Response(JSON.stringify(mockSchedules), { status: 200 });
        }

        if (url.includes('/api/v1/staff-attendance/branches/') && url.includes('/corrections') && method === 'GET') {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        if (url.includes('/api/v1/staff-attendance') && method === 'GET') {
          return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
        }

        if (url.includes('/profiles/staff-alex') && method === 'POST') {
          recordedPayload = JSON.parse(String(init?.body || '{}'));
          return new Response(
            JSON.stringify({
              id: 'att-alex-1',
              profile_id: 'staff-alex',
              branch_id: testBranchId,
              full_name: 'Alex',
              position: 'Staff',
              recorded_by: 'Operador',
              occurred_at: '2026-10-27T08:00:00Z',
              business_date: '2026-10-27',
              status: 'present',
              expected_entry_time: '08:00:00',
              grace_tolerance_minutes: 15,
              checkout_at: null,
              checkout_recorded_by: null,
              series_id: recordedPayload.series_id,
              occurrence_date: '2026-10-27',
              device_captured_at: '2026-10-27T08:00:00Z',
              server_received_at: '2026-10-27T08:00:01Z',
              idempotency_key: recordedPayload.idempotency_key,
              clock_validation_status: 'accepted',
              review_required: false,
              schedule_conflict: false,
              notes: recordedPayload.notes,
            }),
            { status: 201 }
          );
        }

        return new Response('Not Found', { status: 404 });
      });

      render(
        <DemoProvider>
          <StaffAttendanceView liveRequest={liveRequest} liveStaff={liveStaffList} branchId={testBranchId} />
        </DemoProvider>
      );

      // Wait for schedules to load from live API
      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/staff-schedules/branches/'), expect.anything());
      });

      // Bob has scheduled shift, Alex does not
      const clockInAlexBtn = screen.getByRole('button', { name: 'Marcar entrada para Alex' });
      await user.click(clockInAlexBtn);

      // Confirmation modal appears
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      expect(screen.getByRole('heading', { name: 'Confirmar Entrada' })).toBeInTheDocument();
      expect(screen.getByText(/no tiene turno programado para hoy/)).toBeInTheDocument();

      // Option A: Cubrir a un compañero is available with Bob in dropdown
      expect(screen.getByText('Cubrir a un compañero')).toBeInTheDocument();
      const selectDropdown = screen.getByLabelText('Seleccionar compañero a cubrir');
      expect(selectDropdown).toBeInTheDocument();
      expect(screen.getByText('Bob (08:00 - 16:00)')).toBeInTheDocument();

      // Confirm button is disabled until a colleague is chosen
      const confirmBtn = screen.getByRole('button', { name: 'Confirmar Entrada' });
      expect(confirmBtn).toBeDisabled();

      // Select Bob to cover in AnimatedList
      await user.click(screen.getByText('Bob (08:00 - 16:00)'));
      expect(confirmBtn).toBeEnabled();

      // Confirm covering Bob
      await user.click(confirmBtn);

      // Verify success feedback and API payload
      await waitFor(() => {
        expect(screen.getByText('Entrada registrada')).toBeInTheDocument();
      });
      expect(recordedPayload).not.toBeNull();
      expect(recordedPayload.series_id).toBe('series-bob');
      expect(recordedPayload.covered_profile_id).toBe('staff-bob');
      expect(recordedPayload.notes).toBe('Cubriendo turno de Bob');

      // In the audit table, the coverage note is displayed
      expect(screen.getByText('Cubriendo turno de Bob')).toBeInTheDocument();
    });

    it('requests attendance, corrections for the CDMX business day (not the UTC day)', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        // 19:00 in Mexico City on 2026-11-03 is already 2026-11-04 in UTC.
        vi.setSystemTime(new Date('2026-11-04T01:00:00Z'));
        const urls: string[] = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
          urls.push(String(input));
          if (String(input).includes('/staff-attendance') && !String(input).includes('/corrections')) {
            return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        });

        render(
          <DemoProvider>
            <StaffAttendanceView liveRequest={liveRequest} liveStaff={[]} branchId={testBranchId} />
          </DemoProvider>
        );

        await waitFor(() => {
          expect(urls.some(u => u.includes('/corrections'))).toBe(true);
        });
        const attendanceUrl = urls.find(u => u.includes('/api/v1/staff-attendance?'));
        expect(attendanceUrl).toContain('business_date=2026-11-03');
        expect(urls.find(u => u.includes('/corrections'))).toContain('business_date=2026-11-03');
        expect(urls.some(u => u.includes('2026-11-04'))).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows a secondary warning when corrections or schedules fail to load but keeps attendance', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/corrections')) return new Response('boom', { status: 500 });
        if (url.includes('/staff-schedules/')) return new Response('boom', { status: 500 });
        return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
      });

      render(
        <DemoProvider>
          <StaffAttendanceView liveRequest={liveRequest} liveStaff={[]} branchId={testBranchId} />
        </DemoProvider>
      );

      expect(await screen.findByText('No se pudieron cargar las correcciones.')).toBeInTheDocument();
      expect(screen.getByText('No se pudieron cargar los horarios.')).toBeInTheDocument();
      expect(screen.queryByText('Error al sincronizar asistencia.')).not.toBeInTheDocument();
    });

    it('does not render stale data from a previous branch after switching branches', async () => {
      const branchA = '00000000-0000-4000-8000-0000000000aa';
      const branchB = '00000000-0000-4000-8000-0000000000bb';
      const staff = [{ id: 'staff-x', name: 'Xavier', active: true, avatarInitials: 'X', department: 'Staff' }];
      const record = {
        id: 'att-a-1', profile_id: 'staff-x', branch_id: branchA, full_name: 'Xavier', position: 'Staff',
        recorded_by: 'Operador', occurred_at: '2026-11-03T14:00:00Z', business_date: '2026-11-03', status: 'present',
        expected_entry_time: null, grace_tolerance_minutes: 15, checkout_at: null, checkout_recorded_by: null,
        series_id: null, occurrence_date: null, device_captured_at: '2026-11-03T14:00:00Z',
        server_received_at: '2026-11-03T14:00:01Z', idempotency_key: 'k', clock_validation_status: 'accepted',
        review_required: false, schedule_conflict: false, notes: null,
      };
      let releaseA: () => void = () => {};
      const gateA = new Promise<void>(resolve => { releaseA = resolve; });
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        const isA = url.includes(branchA);
        if (url.includes('/corrections') || url.includes('/staff-schedules/')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (isA) {
          await gateA;
          return new Response(JSON.stringify({ items: [record], total: 1 }), { status: 200 });
        }
        return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
      });

      const view = (id: string) => (
        <DemoProvider>
          <StaffAttendanceView liveRequest={liveRequest} liveStaff={staff} branchId={id} />
        </DemoProvider>
      );
      const { rerender } = render(view(branchA));
      rerender(view(branchB));
      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining(branchB), expect.anything());
      });
      releaseA();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(screen.getByTestId('staff-card-staff-x')).toHaveTextContent('Fuera del gym');
    });

    const shiftSeries = (id: string, start: string, end: string) => ({
      id, profile_id: 'staff-bob', branch_id: testBranchId, start_date: '2026-01-01', weekdays: [0, 1, 2, 3, 4, 5, 6],
      start_time: start, end_time: end, end_date: null, occurrence_count: null, cancelled_from: null,
    });

    function mockBobApi(options: { attendance?: unknown[]; failFirstClockIn?: 'network' | 409 } = {}) {
      const bodies: Array<Record<string, string>> = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (url.includes('/staff-schedules/branches/')) {
          return new Response(JSON.stringify([shiftSeries('series-am', '06:00:00', '10:00:00'), shiftSeries('series-pm', '16:00:00', '20:00:00')]), { status: 200 });
        }
        if (url.includes('/corrections')) return new Response('[]', { status: 200 });
        if (method === 'GET') return new Response(JSON.stringify({ items: options.attendance ?? [], total: 0 }), { status: 200 });
        bodies.push(JSON.parse(String(init?.body)));
        if (options.failFirstClockIn === 'network' && bodies.length === 1) throw new TypeError('offline');
        if (options.failFirstClockIn === 409 && bodies.length === 1) return new Response('{}', { status: 409 });
        return new Response(JSON.stringify({ ...bodies.at(-1), id: 'att-new', profile_id: 'staff-bob', full_name: 'Bob', recorded_by: 'Op', occurred_at: '2026-10-23T16:00:00Z' }), { status: 201 });
      });
      render(
        <DemoProvider>
          <StaffAttendanceView
            liveRequest={liveRequest}
            liveStaff={[{ id: 'staff-bob', name: 'Bob', active: true, avatarInitials: 'B', department: 'Entrenador' }]}
            branchId={testBranchId}
          />
        </DemoProvider>
      );
      return bodies;
    }

    it('clocks in the next scheduled shift when the first shift of the day already has a closed record', async () => {
      const user = userEvent.setup();
      const today = businessDate();
      const bodies = mockBobApi({
        attendance: [{
          id: 'att-am', profile_id: 'staff-bob', full_name: 'Bob', position: 'Entrenador', recorded_by: 'Op', occurred_at: `${today}T12:00:00Z`,
          status: 'present', checkout_at: `${today}T16:00:00Z`, series_id: 'series-am', occurrence_date: today,
          device_captured_at: null, clock_validation_status: 'accepted', review_required: false,
        }],
      });
      await waitFor(() => expect(screen.getByTestId('staff-card-staff-bob')).toHaveTextContent('Fuera del gym'));
      await user.click(screen.getByRole('button', { name: 'Marcar entrada para Bob' }));
      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0].series_id).toBe('series-pm');
      expect(bodies[0].occurrence_date).toBe(today);
    });

    it('keeps key and capture time after a network error, and drops them after a 409', async () => {
      const user = userEvent.setup();
      for (const failure of ['network', 409] as const) {
        const bodies = mockBobApi({ failFirstClockIn: failure });
        const button = await screen.findByRole('button', { name: 'Marcar entrada para Bob' });
        await user.click(button);
        await screen.findByText('Error al marcar entrada');
        await new Promise(resolve => setTimeout(resolve, 5));
        await user.click(screen.getByRole('button', { name: 'Marcar entrada para Bob' }));
        await waitFor(() => expect(bodies).toHaveLength(2));
        const same = bodies[1].idempotency_key === bodies[0].idempotency_key;
        expect(same).toBe(failure === 'network');
        expect(bodies[1].device_captured_at === bodies[0].device_captured_at).toBe(failure === 'network');
        cleanup();
      }
    });

    it('does not resend a scheduled series once every shift of the day has a record', async () => {
      const user = userEvent.setup();
      const today = businessDate();
      const done = (id: string, series: string) => ({
        id, profile_id: 'staff-bob', full_name: 'Bob', position: 'Entrenador', recorded_by: 'Op', occurred_at: `${today}T12:00:00Z`,
        status: 'present', checkout_at: `${today}T13:00:00Z`, series_id: series, occurrence_date: today,
        device_captured_at: null, clock_validation_status: 'accepted', review_required: false,
      });
      const bodies = mockBobApi({ attendance: [done('att-am', 'series-am'), done('att-pm', 'series-pm')] });
      await waitFor(() => expect(screen.getByTestId('staff-card-staff-bob')).toHaveTextContent('Fuera del gym'));
      await user.click(screen.getByRole('button', { name: 'Marcar entrada para Bob' }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(bodies).toHaveLength(0);
    });
  });
});
