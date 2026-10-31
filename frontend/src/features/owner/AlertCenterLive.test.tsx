import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AlertCenter } from './AlertCenter';
import type { AuthenticatedRequest } from '../../api/inventoryApi';
import type { RentalAlertPage, RentalCancellationDTO } from '../../api/rentalsApi';

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

describe('AlertCenter live rental alerts integration', () => {
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
});
