import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GuantesModal } from './GuantesModal';

describe('GuantesModal live API integration', () => {
  const branchId = 'branch-001';
  const registerId = 'reg-001';

  it('loads live assets and renders live cards', async () => {
    const mockAssets = {
      items: [
        {
          id: 'asset-glove-1',
          branch_id: branchId,
          kind: 'glove',
          code: 'G-101',
          color: 'Rojo',
          ounces: 14,
          price_minor: 3500,
          is_active: true,
          active_rental_id: null,
        },
      ],
      total: 1,
    };
    const mockRentals = { items: [], total: 0 };

    const apiRequest = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/rentals/assets')) {
        return Promise.resolve(new Response(JSON.stringify(mockAssets), { status: 200 }));
      }
      if (url.includes('/api/v1/rentals?')) {
        return Promise.resolve(new Response(JSON.stringify(mockRentals), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    render(
      <GuantesModal
        isOpen={true}
        onClose={vi.fn()}
        apiRequest={apiRequest}
        branchId={branchId}
        registerId={registerId}
      />
    );

    expect(await screen.findByText('G-101 · Rojo · 14 oz')).toBeInTheDocument();
    expect(screen.getAllByText(/\$35\.00 MXN/).length).toBeGreaterThan(0);
  });

  it('submits live glove rental with components', async () => {
    const mockAssets = {
      items: [
        {
          id: 'asset-glove-1',
          branch_id: branchId,
          kind: 'glove',
          code: 'G-101',
          color: 'Rojo',
          ounces: 14,
          price_minor: 3500,
          is_active: true,
          active_rental_id: null,
        },
      ],
      total: 1,
    };
    const mockRentals = { items: [], total: 0 };
    const mockMembers = {
      items: [{ id: 'member-10', full_name: 'Roberto Gómez', phone: '5551234567' }],
    };

    const apiRequest = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/rentals/assets')) {
        return Promise.resolve(new Response(JSON.stringify(mockAssets), { status: 200 }));
      }
      if (url.includes('/api/v1/rentals?')) {
        return Promise.resolve(new Response(JSON.stringify(mockRentals), { status: 200 }));
      }
      if (url.includes('/api/v1/members?')) {
        return Promise.resolve(new Response(JSON.stringify(mockMembers), { status: 200 }));
      }
      if (url === '/api/v1/rentals/gloves' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'rental-glove-10',
              status: 'active',
              kind: 'glove',
              asset_code: 'G-101',
            }),
            { status: 201 }
          )
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    render(
      <GuantesModal
        isOpen={true}
        onClose={vi.fn()}
        apiRequest={apiRequest}
        branchId={branchId}
        registerId={registerId}
      />
    );

    expect(await screen.findByText('G-101 · Rojo · 14 oz')).toBeInTheDocument();

    // Search member
    const searchInput = screen.getByRole('combobox', { name: 'Buscar socio activo' });
    await userEvent.type(searchInput, 'Roberto');
    const memberOption = await screen.findByText('Roberto Gómez');
    await userEvent.click(memberOption);

    // Proceed to payment
    const proceedBtn = screen.getByRole('button', { name: /revisar cobro|proceder al cobro/i });
    await userEvent.click(proceedBtn);

    // Select cash
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));

    // Confirm rental
    const confirmBtn = screen.getByRole('button', { name: 'Confirmar cobro y entregar' });
    await userEvent.click(confirmBtn);

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/rentals/gloves',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });

  it('marks live glove as returned', async () => {
    const mockAssets = {
      items: [
        {
          id: 'asset-glove-2',
          branch_id: branchId,
          kind: 'glove',
          code: 'G-102',
          color: 'Negro',
          ounces: 16,
          price_minor: 4000,
          is_active: true,
          active_rental_id: 'rental-glove-2',
        },
      ],
      total: 1,
    };
    const mockRentals = {
      items: [
        {
          id: 'rental-glove-2',
          asset_id: 'asset-glove-2',
          asset_code: 'G-102',
          member_id: 'member-2',
          member_name: 'Laura Sánchez',
          status: 'active',
          kind: 'glove',
          paid_minor: 4000,
          outstanding_minor: 0,
        },
      ],
      total: 1,
    };

    const apiRequest = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/rentals/assets')) {
        return Promise.resolve(new Response(JSON.stringify(mockAssets), { status: 200 }));
      }
      if (url.includes('/api/v1/rentals?')) {
        return Promise.resolve(new Response(JSON.stringify(mockRentals), { status: 200 }));
      }
      if (url.includes('/api/v1/rentals/rental-glove-2/return') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'rental-glove-2',
              status: 'returned',
              kind: 'glove',
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    render(
      <GuantesModal
        isOpen={true}
        onClose={vi.fn()}
        apiRequest={apiRequest}
        branchId={branchId}
        registerId={registerId}
      />
    );

    expect(await screen.findByText('G-102 · Negro · 16 oz')).toBeInTheDocument();
    expect(screen.getAllByText('Laura Sánchez').length).toBeGreaterThan(0);

    const returnBtn = screen.getByRole('button', { name: 'Marcar como devuelto' });
    await userEvent.click(returnBtn);

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/rentals/rental-glove-2/return',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });
});
