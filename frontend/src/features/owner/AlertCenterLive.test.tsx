import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AlertCenter } from './AlertCenter';
import type { AuthenticatedRequest } from '../../api/inventoryApi';
import type { RentalAlertPage, RentalCancellationDTO } from '../../api/rentalsApi';
import type { AttendanceCorrectionAlert, DebtOverrideCheckInAlert, SalesAlert } from '../../api/ownerOverviewApi';

const mockCancellationAlert: RentalCancellationDTO = {
  id: 'cancel-123',
  rental_id: 'rental-456',
  member_id: 'member-789',
  member_name: 'Carlos Ruiz',
  member_number: '1042',
  asset_id: 'asset-01',
  asset_code: '#05',
  actor_id: 'staff-admin-id',
  actor_name: 'Admin General',
  reason: 'Mudanza de ciudad antes de tiempo',
  refund_method: 'cash',
  refund_amount_minor: 15000,
  suggested_refund_minor: 15000,
  settled_minor: 35000,
  cancelled_debt_minor: 0,
  reviewed: false,
  reviewed_by: null,
  reviewed_by_name: null,
  reviewed_at: null,
  created_at: '2026-10-31T10:00:00.000Z',
};

const reviewedCancellationAlert: RentalCancellationDTO = {
  ...mockCancellationAlert,
  reviewed: true,
  reviewed_by: 'admin-owner-id',
  reviewed_by_name: 'Dueño Principal',
  reviewed_at: '2026-10-31T11:30:00.000Z',
};

const mockDebtOverrideAlert: DebtOverrideCheckInAlert = {
  id: 'alert-debt-1',
  category: 'debt_override_checkin',
  branch_id: 'branch-1',
  branch_name: 'Sucursal Centro',
  member_id: 'member-789',
  member_name: 'Rodrigo Mendez',
  member_number: '2045',
  authorized_by_id: 'staff-sofia',
  authorized_by_name: 'Recepcionista Sofia',
  occurred_at: '2026-11-10T14:30:00.000Z',
  notes: 'Excepción autorizada con adeudo de mensualidad',
};

const mockAttendanceCorrectionAlert: AttendanceCorrectionAlert = {
  id: 'alert-corr-1',
  category: 'attendance_correction',
  branch_id: 'branch-1',
  branch_name: 'Sucursal Centro',
  staff_profile_id: 'staff-miguel',
  staff_member_name: 'Entrenador Miguel',
  corrected_by_id: 'staff-sofia',
  corrected_by_name: 'Recepcionista Sofia',
  reason: 'Olvido de check-in al inicio de turno',
  details: 'Ajustado de 09:00 a 08:00',
  occurred_at: '2026-11-10T15:00:00.000Z',
};

describe('AlertCenter live alerts integration', () => {
  it('loads rental cancellation alerts and marks them as reviewed', async () => {
    const mockRequest: AuthenticatedRequest = vi.fn().mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('/api/v1/branches')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: 'branch-1', name: 'Sucursal Centro' }],
        };
      }
      if (path.includes('/api/v1/rentals/alerts?')) {
        return {
          ok: true,
          status: 200,
          json: async (): Promise<RentalAlertPage> => ({
            items: [mockCancellationAlert],
            total: 1,
          }),
        };
      }
      if (path.includes('/api/v1/rentals/alerts/cancel-123/review') && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async (): Promise<RentalCancellationDTO> => reviewedCancellationAlert,
        };
      }
      if (path.includes('/api/v1/admin/security/alerts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ alerts: [], total: 0 }),
        };
      }
      if (path.includes('/api/v1/owner/overview/alerts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ alerts: [], total: 0 }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    });

    render(
      <MemoryRouter initialEntries={['/owner/alerts']}>
        <AlertCenter apiRequest={mockRequest} branchId="branch-1" />
      </MemoryRouter>
    );

    // Verify KPI card displays rental alert count
    await waitFor(() => {
      expect(screen.getAllByText('Cancelaciones de casilleros').length).toBeGreaterThanOrEqual(1);
    });

    // Filter by 'Cancelaciones de casilleros' pill
    const user = userEvent.setup();
    const rentalPill = screen.getByRole('button', { name: /Cancelaciones de casilleros/ });
    await user.click(rentalPill);

    // Verify cancellation details in the table
    await waitFor(() => {
      expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument();
      expect(screen.getByText('#1042')).toBeInTheDocument();
      expect(screen.getByText('#05')).toBeInTheDocument();
      expect(screen.getByText('Mudanza de ciudad antes de tiempo')).toBeInTheDocument();
      expect(screen.getByText(/\$150.00 MXN \(Efectivo\)/)).toBeInTheDocument();
    });

    // Review button should be visible
    const reviewBtn = screen.getByRole('button', { name: 'Marcar como revisado #05' });
    expect(reviewBtn).toBeInTheDocument();

    // Click review button
    await user.click(reviewBtn);

    // Assert the status updates to 'Revisado'
    await waitFor(() => {
      expect(screen.getByText('Revisado')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Marcar como revisado #05' })).not.toBeInTheDocument();
    });
  });

  it('consumes live debt_override_checkin and attendance_correction alerts from GET /owner-overview/alerts', async () => {
    const user = userEvent.setup();
    const mockRequest: AuthenticatedRequest = vi.fn().mockImplementation(async (path: string) => {
      if (path.includes('/api/v1/branches')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: 'branch-1', name: 'Sucursal Centro' }],
        };
      }
      if (path.includes('/api/v1/rentals/alerts?')) {
        return {
          ok: true,
          status: 200,
          json: async (): Promise<RentalAlertPage> => ({ items: [], total: 0 }),
        };
      }
      if (path.includes('/api/v1/admin/security/alerts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ alerts: [], total: 0 }),
        };
      }
      if (path.includes('/api/v1/owner/overview/alerts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            alerts: [mockDebtOverrideAlert, mockAttendanceCorrectionAlert],
            total: 2,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    });

    render(
      <MemoryRouter initialEntries={['/owner/alerts']}>
        <AlertCenter apiRequest={mockRequest} branchId="branch-1" />
      </MemoryRouter>
    );

    // Verify both KPI cards are present with alert counts
    await waitFor(() => {
      expect(screen.getAllByText('Entradas con adeudo').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Correcciones de asistencia').length).toBeGreaterThanOrEqual(1);
    });

    // 1. Verify D-A2: Debt Override Check-in alert
    const debtOverridePill = screen.getByRole('button', { name: /Entradas con adeudo/ });
    await user.click(debtOverridePill);

    await waitFor(() => {
      expect(screen.getByText('Rodrigo Mendez')).toBeInTheDocument();
      expect(screen.getByText('#2045')).toBeInTheDocument();
      expect(screen.getByText('Recepcionista Sofia')).toBeInTheDocument();
      expect(screen.getByText('Excepción autorizada con adeudo de mensualidad')).toBeInTheDocument();
    });

    // 2. Verify D-A3: Attendance Correction alert
    const attendancePill = screen.getByRole('button', { name: /Correcciones de asistencia/ });
    await user.click(attendancePill);

    await waitFor(() => {
      expect(screen.getByText('Entrenador Miguel')).toBeInTheDocument();
      expect(screen.getByText('Recepcionista Sofia')).toBeInTheDocument();
      expect(screen.getByText('Olvido de check-in al inicio de turno')).toBeInTheDocument();
      expect(screen.getByText('Ajustado de 09:00 a 08:00')).toBeInTheDocument();
    });
  });

  it('E2E: receptionist actions (check-in with debt override & staff attendance correction) generate live alerts in stateful store and render in AlertCenter', async () => {
    const user = userEvent.setup();

    // Shared stateful backend store
    const alertStore: Array<DebtOverrideCheckInAlert | AttendanceCorrectionAlert> = [];

    const statefulRequest: AuthenticatedRequest = vi.fn().mockImplementation(async (path: string, init?: RequestInit) => {
      // 1. Receptionist submits attendance correction
      if (path.match(/\/api\/v1\/staff-attendance\/([^/]+)\/corrections/) && init?.method === 'POST') {
        const body = JSON.parse((init.body as string) || '{}');
        const alert: AttendanceCorrectionAlert = {
          id: `corr-alert-${alertStore.length + 1}`,
          category: 'attendance_correction',
          branch_id: 'branch-1',
          branch_name: 'Sucursal Centro',
          staff_profile_id: 'staff-trainer-miguel',
          staff_member_name: 'Entrenador Miguel',
          corrected_by_id: 'staff-recep-sofia',
          corrected_by_name: 'Recepcionista Sofia',
          reason: body.reason || 'Olvido de check-in al inicio de turno',
          details: `Campo: ${body.field_name}, Nuevo valor: ${body.corrected_value}`,
          occurred_at: '2026-11-10T15:30:00.000Z',
        };
        alertStore.push(alert);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'corr-rec-1', ...body, created_at: alert.occurred_at }),
        };
      }

      // 2. Receptionist authorizes check-in with debt override
      if (path.includes('/api/v1/member-check-ins/branches/') && init?.method === 'POST') {
        const body = JSON.parse((init.body as string) || '{}');
        if (body.confirm_outstanding_balance) {
          const alert: DebtOverrideCheckInAlert = {
            id: `debt-alert-${alertStore.length + 1}`,
            category: 'debt_override_checkin',
            branch_id: 'branch-1',
            branch_name: 'Sucursal Centro',
            member_id: 'member-rodrigo',
            member_name: 'Rodrigo Mendez',
            member_number: '2045',
            authorized_by_id: 'staff-recep-sofia',
            authorized_by_name: 'Recepcionista Sofia',
            occurred_at: '2026-11-10T16:00:00.000Z',
            notes: body.notes || 'Entrada autorizada excepcionalmente con adeudo pendiente',
          };
          alertStore.push(alert);
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'checkin-1', status: 'authorized', override: true }),
        };
      }

      // 3. Branches endpoint
      if (path.includes('/api/v1/branches')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: 'branch-1', name: 'Sucursal Centro' }],
        };
      }

      // 4. Rentals and security alerts (empty)
      if (path.includes('/api/v1/rentals/alerts?')) {
        return {
          ok: true,
          status: 200,
          json: async (): Promise<RentalAlertPage> => ({ items: [], total: 0 }),
        };
      }
      if (path.includes('/api/v1/admin/security/alerts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ alerts: [], total: 0 }),
        };
      }

      // 5. Owner Overview Alerts endpoint (reads from the stateful alertStore)
      if (path.includes('/api/v1/owner/overview/alerts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            alerts: [...alertStore],
            total: alertStore.length,
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    });

    // Step A: Receptionist executes the two actions via API requests to the stateful store
    // Action 1: Staff attendance correction
    const corrResponse = await statefulRequest('/api/v1/staff-attendance/att-rec-1/corrections', {
      method: 'POST',
      body: JSON.stringify({
        field_name: 'clock_in_at',
        corrected_value: '2026-11-10T08:00:00-06:00',
        reason: 'Olvido de check-in al inicio de turno',
      }),
    });
    expect(corrResponse.ok).toBe(true);

    // Action 2: Check-in with debt override confirmation
    const checkinResponse = await statefulRequest('/api/v1/member-check-ins/branches/branch-1/periods/period-1', {
      method: 'POST',
      body: JSON.stringify({
        confirm_outstanding_balance: true,
        notes: 'Entrada autorizada excepcionalmente con adeudo pendiente',
      }),
    });
    expect(checkinResponse.ok).toBe(true);

    // Verify both items are now stored in backend alert store
    expect(alertStore).toHaveLength(2);

    // Step B: Render AlertCenter which queries GET /api/v1/owner/overview/alerts from that same store
    render(
      <MemoryRouter initialEntries={['/owner/alerts']}>
        <AlertCenter apiRequest={statefulRequest} branchId="branch-1" />
      </MemoryRouter>
    );

    // Verify both KPI cards reflect the alerts created by receptionist actions
    await waitFor(() => {
      expect(screen.getAllByText('Entradas con adeudo').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Correcciones de asistencia').length).toBeGreaterThanOrEqual(1);
    });

    // Step C: Verify Debt Override alert table renders authorizer details
    const debtPill = screen.getByRole('button', { name: /Entradas con adeudo/ });
    await user.click(debtPill);

    await waitFor(() => {
      expect(screen.getByText('Rodrigo Mendez')).toBeInTheDocument();
      expect(screen.getByText('#2045')).toBeInTheDocument();
      expect(screen.getByText('Recepcionista Sofia')).toBeInTheDocument();
      expect(screen.getByText('Entrada autorizada excepcionalmente con adeudo pendiente')).toBeInTheDocument();
    });

    // Step D: Verify Attendance Correction alert table renders corrector details, staff member, and reason
    const corrPill = screen.getByRole('button', { name: /Correcciones de asistencia/ });
    await user.click(corrPill);

    await waitFor(() => {
      expect(screen.getByText('Entrenador Miguel')).toBeInTheDocument();
      expect(screen.getByText('Recepcionista Sofia')).toBeInTheDocument();
      expect(screen.getByText('Olvido de check-in al inicio de turno')).toBeInTheDocument();
      expect(screen.getByText('Campo: clock_in_at, Nuevo valor: 2026-11-10T08:00:00-06:00')).toBeInTheDocument();
    });
  });

  it('shows confirmed debt admissions to administrators', async () => {
    const request = vi.fn().mockImplementation(async (path: string) => ({
      ok: true, status: 200, json: async () => path.includes('/debt-alerts')
        ? [{ id: 'entry-1', member_name: 'Ana López', member_number: '42', occurred_at: '2026-11-10T12:00:00Z' }]
        : path.includes('/rentals/alerts?') ? { items: [], total: 0 } : [],
    }));
    render(<MemoryRouter><AlertCenter apiRequest={request} branchId="branch-1" /></MemoryRouter>);
    expect(await screen.findByText(/Ana López/)).toBeInTheDocument();
  });

  it('shows purchase cost increases to the administrator', async () => {
    const request: AuthenticatedRequest = vi.fn(async (path: string) => {
      if (path.includes('/purchase-cost-alerts')) return new Response(JSON.stringify({ items: [{ purchase_id: 'purchase', product_id: 'water', product_name: 'Agua', previous_cost_minor: 1000, unit_cost_minor: 1200, recorded_at: '2026-10-31T10:00:00Z' }] }));
      if (path.includes('/rentals/alerts')) return new Response(JSON.stringify({ items: [], total: 0 }));
      return new Response(JSON.stringify([]));
    });
    render(<MemoryRouter><AlertCenter apiRequest={request} branchId="branch-1" /></MemoryRouter>);
    const alertItem = await screen.findByText(/Agua:.*\$10\.00.*\$12\.00/);
    expect(alertItem).toBeVisible();
    const timeElement = alertItem.closest('li')?.querySelector('time');
    expect(timeElement).toBeInTheDocument();
    expect(timeElement).toHaveAttribute('dateTime', '2026-10-31T10:00:00Z');
  });

  it('renders empty state when there are no cost-increase alerts', async () => {
    const request: AuthenticatedRequest = vi.fn(async (path: string) => {
      if (path.includes('/purchase-cost-alerts')) return new Response(JSON.stringify({ items: [] }));
      if (path.includes('/rentals/alerts')) return new Response(JSON.stringify({ items: [], total: 0 }));
      return new Response(JSON.stringify([]));
    });
    render(<MemoryRouter><AlertCenter apiRequest={request} branchId="branch-1" /></MemoryRouter>);
    expect(await screen.findByText('No hay alertas de aumento de costo registradas.')).toBeVisible();
  });

  it('shows shift cash discrepancies and inventory count discrepancies from owner overview', async () => {
    const request: AuthenticatedRequest = vi.fn(async (path: string) => {
      if (path.includes('/purchase-cost-alerts')) return new Response(JSON.stringify({ items: [] }));
      if (path.includes('/rentals/alerts')) return new Response(JSON.stringify({ items: [], total: 0 }));
      if (path.includes('/api/v1/owner/overview')) {
        return new Response(JSON.stringify({
          period: { from: '2026-10-01', to: '2026-10-31', branch_id: 'branch-1', timezone: 'America/Mexico_City' },
          pulse: { confirmed_minor: 0, alerts_count: 2 },
          finances: {
            cash_minor: 0,
            card_minor: 0,
            confirmed_count: 0,
            pending_transfer_minor: 0,
            pending_transfer_count: 0,
            shift_discrepancies: [
              { shift_id: 'shift-101', difference_minor: -5000, register_name: 'Caja Principal' },
              { shift_id: 'shift-102', difference_minor: 2000, register_name: 'Caja Tarde' },
            ],
            count_discrepancies: [
              { shift_id: 'shift-101', product: 'Proteína Barra', expected_quantity: 10, physical_quantity: 8 },
            ],
          },
          members: { total_members: 0, active_members: 0, active_percent: 0, median_tenure_months: 0, expiring_soon_count: 0, expired_count: 0 },
          attendance: { live_occupancy_count: 0, gym_capacity: 0, peak_hour: null, valley_hour: null, total_check_ins: 0, memberships_sold_count: 0, memberships_renewed_count: 0 },
          inventory: { active_products_count: 0, low_stock_count: 0, retail_units_sold: 0, retail_revenue_minor: 0 },
          staff: { next_payday: '', days_until_payday: 0, estimated_payroll_minor: 0, staff_on_duty_count: 0, staff_absent_count: 0 },
          alerts: { total_count: 0, category_counts: [] },
        }));
      }
      return new Response(JSON.stringify([]));
    });

    render(
      <MemoryRouter>
        <AlertCenter apiRequest={request} branchId="branch-1" />
      </MemoryRouter>
    );

    expect(await screen.findByText('Diferencias de efectivo en turnos')).toBeVisible();
    expect(screen.getByText(/Turno \(Caja Principal\):/)).toBeInTheDocument();
    expect(screen.getByText(/Faltante:\s*\$50\.00 MXN/)).toBeInTheDocument();
    expect(screen.getByText(/Turno \(Caja Tarde\):/)).toBeInTheDocument();
    expect(screen.getByText(/Sobrante:\s*\$20\.00 MXN/)).toBeInTheDocument();

    expect(await screen.findByText('Diferencias de conteo de inventario')).toBeVisible();
    expect(screen.getByText(/Proteína Barra:/)).toBeInTheDocument();
    expect(screen.getByText(/Esperado 10, contado 8/)).toBeInTheDocument();
    expect(screen.getByText('(-2)')).toBeInTheDocument();
  });

  it('displays inventory waste alerts in the live panel, KPI card, and category table', async () => {
    const request: AuthenticatedRequest = vi.fn(async (path: string) => {
      if (path.includes('/api/v1/owner/overview/alerts')) {
        return new Response(JSON.stringify({
          alerts: [
            {
              id: 'waste-1',
              category: 'inventory_waste',
              branch_id: 'branch-1',
              branch_name: 'Central',
              product_id: 'prod-1',
              product_name: 'Agua mineral',
              product_unit: 'piece',
              quantity: 2,
              unit_cost_minor: 1000,
              unit_price_minor: 1500,
              total_cost_minor: 2000,
              total_price_minor: 3000,
              reason: 'Botella rota en almacén',
              recorded_by_id: 'staff-1',
              recorded_by_name: 'Recepción Demo',
              occurred_at: '2026-10-31T14:30:00Z',
            },
            {
              id: 'waste-2',
              category: 'inventory_waste',
              branch_id: 'branch-1',
              branch_name: 'Central',
              product_id: 'prod-2',
              product_name: 'Shaker',
              product_unit: 'piece',
              quantity: 1,
              unit_cost_minor: 0,
              unit_price_minor: 15000,
              total_cost_minor: 0,
              total_price_minor: 15000,
              reason: 'Tapa quebrada',
              recorded_by_id: 'staff-2',
              recorded_by_name: 'María',
              occurred_at: '2026-10-31T15:00:00Z',
            },
          ],
          total: 2,
        }));
      }
      if (path.includes('/purchase-cost-alerts')) return new Response(JSON.stringify({ items: [] }));
      if (path.includes('/rentals/alerts')) return new Response(JSON.stringify({ items: [], total: 0 }));
      if (path.includes('/api/v1/owner/overview')) {
        return new Response(JSON.stringify({
          period: { from: '2026-10-01', to: '2026-10-31', branch_id: 'branch-1', timezone: 'America/Mexico_City' },
          pulse: { confirmed_minor: 0, alerts_count: 2 },
          finances: {
            cash_minor: 0,
            card_minor: 0,
            confirmed_count: 0,
            pending_transfer_minor: 0,
            pending_transfer_count: 0,
            shift_discrepancies: [],
            count_discrepancies: [],
          },
          members: { total_members: 0, active_members: 0, active_percent: 0, median_tenure_months: 0, expiring_soon_count: 0, expired_count: 0 },
          attendance: { live_occupancy_count: 0, gym_capacity: 0, peak_hour: null, valley_hour: null, total_check_ins: 0, memberships_sold_count: 0, memberships_renewed_count: 0 },
          inventory: { active_products_count: 0, low_stock_count: 0, retail_units_sold: 0, retail_revenue_minor: 0 },
          staff: { next_payday: '', days_until_payday: 0, estimated_payroll_minor: 0, staff_on_duty_count: 0, staff_absent_count: 0 },
          alerts: { total_count: 2, category_counts: [['Mermas de inventario', 2]] },
        }));
      }
      return new Response(JSON.stringify([]));
    });

    render(
      <MemoryRouter>
        <AlertCenter apiRequest={request} branchId="branch-1" />
      </MemoryRouter>
    );

    const wasteHeading = await screen.findByRole('heading', { name: 'Mermas de inventario' });
    expect(wasteHeading).toBeVisible();
    expect(await screen.findByText(/Agua mineral/)).toBeVisible();
    expect(screen.getByText(/Botella rota en almacén/)).toBeVisible();
    expect(screen.getByText(/Recepción Demo/)).toBeVisible();
    expect(screen.getByText(/Costo:\s*\$20\.00/)).toBeVisible();
    expect(screen.getByText(/Valor ref\.:\s*\$150\.00/)).toBeVisible();

    const kpiLink = screen.getByRole('button', { name: 'Ver mermas →' });
    await userEvent.click(kpiLink);

    const tableRegion = await screen.findByRole('region', { name: 'Mermas de inventario' });
    expect(tableRegion).toBeVisible();
    expect(tableRegion).toHaveTextContent('Agua mineral');
    expect(tableRegion).toHaveTextContent('Tapa quebrada');
  });

  it('shows live mermas in Todos table without duplicate pills and switches across all filters and sort columns without crashing', async () => {
    const user = userEvent.setup();
    const mockRequest: AuthenticatedRequest = vi.fn().mockImplementation(async (path: string) => {
      if (path.includes('/api/v1/branches')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: 'branch-1', name: 'Sucursal Centro' }],
        };
      }
      if (path.includes('/api/v1/rentals/alerts?')) {
        return {
          ok: true,
          status: 200,
          json: async (): Promise<RentalAlertPage> => ({ items: [], total: 0 }),
        };
      }
      if (path.includes('/api/v1/admin/security/alerts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ alerts: [], total: 0 }),
        };
      }
      if (path.includes('/api/v1/owner/overview/alerts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            alerts: [
              {
                id: 'waste-all-1',
                category: 'inventory_waste',
                occurred_at: '2026-11-10T10:30:00-06:00',
                branch_id: 'branch-1',
                branch_name: 'Sucursal Centro',
                product_id: 'prod-1',
                product_name: 'Proteina Whey',
                product_unit: 'bote',
                quantity: 1,
                unit_cost_minor: 50000,
                total_cost_minor: 50000,
                total_price_minor: 85000,
                reason: 'Envase fracturado',
                recorded_by_name: 'Ana Recepción',
              },
              mockDebtOverrideAlert,
              mockAttendanceCorrectionAlert,
            ],
            total: 3,
          }),
        };
      }
      if (path.includes('/api/v1/owner/overview')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ finances: { shift_discrepancies: [], count_discrepancies: [], pending_transfer_minor: 0 } }),
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    });

    render(
      <MemoryRouter initialEntries={['/owner/alerts']}>
        <AlertCenter apiRequest={mockRequest} branchId="branch-1" />
      </MemoryRouter>
    );

    const unifiedRegion = await screen.findByRole('region', { name: 'Centro de alertas operativas' });
    expect(within(unifiedRegion).getByText('Proteina Whey')).toBeVisible();
    expect(within(unifiedRegion).getByText(/Envase fracturado/)).toBeVisible();
    expect(within(unifiedRegion).getByText('Ana Recepción')).toBeVisible();

    const filterGroup = screen.getByRole('group', { name: 'Filtrar incidencias por categoría' });
    expect(within(filterGroup).queryByRole('button', { name: /^Merma de inventario/ })).not.toBeInTheDocument();
    expect(within(filterGroup).getByRole('button', { name: /Todos\s*3/ })).toBeVisible();

    await user.click(within(filterGroup).getByRole('button', { name: /Mermas de inventario\s*1/ }));
    expect(await screen.findByRole('region', { name: 'Mermas de inventario' })).toHaveTextContent('Proteina Whey');

    await user.click(within(filterGroup).getByRole('button', { name: /Cancelaciones de casilleros/ }));
    expect(await screen.findByText('Sin cancelaciones de casilleros')).toBeVisible();

    await user.click(within(filterGroup).getByRole('button', { name: /Entradas con adeudo/ }));
    expect(await screen.findByRole('region', { name: 'Entradas con adeudo autorizadas' })).toBeVisible();

    await user.click(within(filterGroup).getByRole('button', { name: /Correcciones de asistencia/ }));
    expect(await screen.findByRole('region', { name: 'Correcciones de asistencia' })).toBeVisible();

    await user.click(within(filterGroup).getByRole('button', { name: /Seguridad \/ Bloqueos/ }));
    expect(await screen.findByText('Sin bloqueos de seguridad')).toBeVisible();

    await user.click(within(filterGroup).getByRole('button', { name: /Ventas/ }));
    expect(await screen.findByText('Sin alertas de ventas')).toBeVisible();

    await user.click(within(filterGroup).getByRole('button', { name: /Todos\s*3/ }));
    const restoredRegion = await screen.findByRole('region', { name: 'Centro de alertas operativas' });
    expect(within(restoredRegion).getByText('Proteina Whey')).toBeVisible();

    await user.click(within(restoredRegion).getByRole('button', { name: /Impacto/ }));
    await user.click(within(restoredRegion).getByRole('button', { name: /Fecha \/ Turno/ }));
    expect(within(restoredRegion).getByText('Proteina Whey')).toBeVisible();
    expect(screen.queryByText(/Cargando (centro|incidencias|mermas|ventas|entradas|correcciones|cancelaciones|bloqueos)/i)).not.toBeInTheDocument();
  });

  it('displays live sales alerts (pending payments, pending transfers, and refunds) in KPI card, pill, and Ventas table', async () => {
    const user = userEvent.setup();
    const mockSalesAlerts: SalesAlert[] = [
      {
        id: 'sale-debt-1',
        category: 'sales',
        subtype: 'pending_payment',
        subtype_label: 'Pago pendiente',
        branch_id: 'branch-1',
        branch_name: 'Sucursal Centro',
        order_id: 'ord-1',
        order_kind: 'product',
        member_id: 'mem-1',
        member_name: 'Ana Perez',
        member_number: '1001',
        items_summary: 'Proteina Whey',
        amount_minor: 5000,
        total_minor: 10000,
        paid_minor: 5000,
        reason: 'Saldo pendiente por liquidar',
        recorded_by_name: 'Recepcionista Sofia',
        occurred_at: '2026-11-11T10:00:00.000Z',
      },
      {
        id: 'sale-refund-1',
        category: 'sales',
        subtype: 'product_refund',
        subtype_label: 'Devolución',
        branch_id: 'branch-1',
        branch_name: 'Sucursal Centro',
        order_id: 'ord-2',
        order_kind: 'product',
        member_id: null,
        member_name: null,
        member_number: null,
        items_summary: 'Agua Mineral x2',
        amount_minor: 4000,
        payout_method: 'cash',
        disposition: 'restock',
        reason: 'Producto equivocado',
        recorded_by_name: 'Ana Recepción',
        occurred_at: '2026-11-11T09:00:00.000Z',
      },
      {
        id: 'sale-transfer-1',
        category: 'sales',
        subtype: 'pending_transfer',
        subtype_label: 'Transferencia pendiente',
        branch_id: 'branch-1',
        branch_name: 'Sucursal Centro',
        order_id: 'ord-3',
        order_kind: 'membership',
        member_id: 'mem-2',
        member_name: 'Carlos Lopez',
        member_number: '1002',
        items_summary: 'Plan Mensual',
        amount_minor: 12000,
        payment_status: 'pending',
        reason: 'Transferencia por conciliar',
        recorded_by_name: 'Recepcionista Sofia',
        occurred_at: '2026-11-11T08:00:00.000Z',
      },
    ];

    const mockRequest: AuthenticatedRequest = vi.fn().mockImplementation(async (path: string) => {
      if (path.includes('/api/v1/branches')) {
        return { ok: true, status: 200, json: async () => [{ id: 'branch-1', name: 'Sucursal Centro' }] };
      }
      if (path.includes('/api/v1/rentals/alerts?')) {
        return { ok: true, status: 200, json: async () => ({ items: [], total: 0 }) };
      }
      if (path.includes('/api/v1/admin/security/alerts')) {
        return { ok: true, status: 200, json: async () => ({ alerts: [], total: 0 }) };
      }
      if (path.includes('/api/v1/owner/overview/alerts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ alerts: mockSalesAlerts, total: 3, sales_count: 3 }),
        };
      }
      if (path.includes('/api/v1/owner/overview')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            finances: { shift_discrepancies: [], count_discrepancies: [], pending_transfer_minor: 12000 },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    });

    render(
      <MemoryRouter initialEntries={['/owner/alerts']}>
        <AlertCenter apiRequest={mockRequest} branchId="branch-1" />
      </MemoryRouter>
    );

    const filterGroup = await screen.findByRole('group', { name: 'Filtrar incidencias por categoría' });
    expect(within(filterGroup).getByRole('button', { name: /Ventas\s*3/ })).toBeVisible();
    expect(screen.getByText('2 pagos pendientes · 1 devolución.')).toBeVisible();

    const unifiedRegion = await screen.findByRole('region', { name: 'Centro de alertas operativas' });
    expect(within(unifiedRegion).getByText(/Pago pendiente · Proteina Whey/)).toBeVisible();
    expect(within(unifiedRegion).getByText(/Devolución · Agua Mineral x2/)).toBeVisible();
    expect(within(unifiedRegion).getByText('Saldo: $50.00 MXN')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Ver ventas/i }));
    const salesRegion = await screen.findByRole('region', { name: 'Ventas' });
    expect(within(salesRegion).getByText('Ana Perez (#1001)')).toBeVisible();
    expect(within(salesRegion).getByText('Cliente de mostrador')).toBeVisible();
    expect(within(salesRegion).getByText(/Total: \$100\.00 · Abonado: \$50\.00/)).toBeVisible();
    expect(within(salesRegion).getByText(/Reembolso: Efectivo · Reingreso a stock · Producto equivocado/)).toBeVisible();
    expect(within(salesRegion).getByText('Por conciliar: $120.00 MXN')).toBeVisible();
  });
});
