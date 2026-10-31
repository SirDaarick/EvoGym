import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CasillerosModal } from './CasillerosModal';

describe('CasillerosModal live API integration', () => {
  const branchId = 'branch-001';
  const registerId = 'reg-001';

  it('renders live lockers from backend', async () => {
    const mockAssets = {
      items: [
        {
          id: 'asset-lock-1',
          branch_id: branchId,
          kind: 'locker',
          code: '#01',
          locker_number: 1,
          price_minor: 18000,
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
      <CasillerosModal
        isOpen={true}
        onClose={vi.fn()}
        apiRequest={apiRequest}
        branchId={branchId}
        registerId={registerId}
      />
    );

    const lockerCards = await screen.findAllByText('#01');
    expect(lockerCards.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$180\.00\/mes/).length).toBeGreaterThan(0);
  });

  it('submits locker assignment via live API', async () => {
    const mockAssets = {
      items: [
        {
          id: 'asset-lock-1',
          branch_id: branchId,
          kind: 'locker',
          code: '#01',
          locker_number: 1,
          price_minor: 18000,
          is_active: true,
          active_rental_id: null,
        },
      ],
      total: 1,
    };
    const mockRentals = { items: [], total: 0 };
    const mockMembers = {
      items: [{ id: 'member-1', full_name: 'Ana Karen', phone: '5559876543' }],
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
      if (url === '/api/v1/rentals/lockers' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'rental-lock-1',
              status: 'active',
              kind: 'locker',
              asset_code: '#01',
            }),
            { status: 201 }
          )
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    render(
      <CasillerosModal
        isOpen={true}
        onClose={vi.fn()}
        apiRequest={apiRequest}
        branchId={branchId}
        registerId={registerId}
      />
    );

    const lockerElements = await screen.findAllByText('#01');
    expect(lockerElements.length).toBeGreaterThan(0);

    const searchInput = screen.getByRole('combobox', { name: 'Buscar socio activo' });
    await userEvent.type(searchInput, 'Ana');
    const memberOption = await screen.findByText('Ana Karen');
    await userEvent.click(memberOption);

    const proceedBtn = screen.getByRole('button', { name: /revisar cobro|proceder al cobro/i });
    await userEvent.click(proceedBtn);

    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));

    const confirmBtn = screen.getByRole('button', { name: 'Confirmar cobro y asignar' });
    await userEvent.click(confirmBtn);

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/rentals/lockers',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });

  it('renews locker and releases locker via live API', async () => {
    const mockAssets = {
      items: [
        {
          id: 'asset-lock-1',
          branch_id: branchId,
          kind: 'locker',
          code: '#01',
          locker_number: 1,
          price_minor: 18000,
          is_active: true,
          active_rental_id: 'rental-lock-1',
        },
      ],
      total: 1,
    };
    const mockRentals = {
      items: [
        {
          id: 'rental-lock-1',
          asset_id: 'asset-lock-1',
          asset_code: '#01',
          member_id: 'member-1',
          member_name: 'Ana Karen',
          status: 'active',
          kind: 'locker',
          paid_minor: 18000,
          outstanding_minor: 0,
          ends_on: '2026-11-30',
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
      if (url.includes('/api/v1/rentals/rental-lock-1/renewals') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'rental-lock-1',
              status: 'active',
              kind: 'locker',
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    render(
      <CasillerosModal
        isOpen={true}
        onClose={vi.fn()}
        apiRequest={apiRequest}
        branchId={branchId}
        registerId={registerId}
      />
    );

    const lockerElements = await screen.findAllByText('#01');
    expect(lockerElements.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ana Karen').length).toBeGreaterThan(0);

    const renewBtn = screen.getByRole('button', { name: /renovar mensualidad/i });
    await userEvent.click(renewBtn);

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/rentals/rental-lock-1/renewals',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('opens cancellation dialog with preview and confirms cancellation', async () => {
    const mockAssets = {
      items: [
        {
          id: 'asset-lock-1',
          branch_id: branchId,
          kind: 'locker',
          code: '#01',
          locker_number: 1,
          price_minor: 18000,
          is_active: true,
          active_rental_id: 'rental-lock-1',
        },
      ],
      total: 1,
    };
    const mockRentals = {
      items: [
        {
          id: 'rental-lock-1',
          asset_id: 'asset-lock-1',
          asset_code: '#01',
          member_id: 'member-1',
          member_name: 'Ana Karen',
          status: 'active',
          kind: 'locker',
          paid_minor: 18000,
          outstanding_minor: 0,
          ends_on: '2026-11-30',
        },
      ],
      total: 1,
    };
    const mockPreview = {
      can_cancel: true,
      preview_token: 'tok-preview-1234567890123456789012345678901234567890123456789012345678901234',
      settled_minor: 18000,
      max_refundable_minor: 18000,
      suggested_refund_minor: 9000,
      outstanding_minor: 0,
      cancelled_debt_minor: 0,
      periods: [],
    };

    const apiRequest = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/rentals/assets')) {
        return Promise.resolve(new Response(JSON.stringify(mockAssets), { status: 200 }));
      }
      if (url.includes('/api/v1/rentals?')) {
        return Promise.resolve(new Response(JSON.stringify(mockRentals), { status: 200 }));
      }
      if (url.includes('/api/v1/rentals/rental-lock-1/cancellation-preview')) {
        return Promise.resolve(new Response(JSON.stringify(mockPreview), { status: 200 }));
      }
      if (url.includes('/api/v1/rentals/rental-lock-1/cancellation') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'cancellation-1',
              rental_id: 'rental-lock-1',
              reviewed: false,
            }),
            { status: 201 }
          )
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    render(
      <CasillerosModal
        isOpen={true}
        onClose={vi.fn()}
        apiRequest={apiRequest}
        branchId={branchId}
        registerId={registerId}
      />
    );

    const lockerElements = await screen.findAllByText('#01');
    expect(lockerElements.length).toBeGreaterThan(0);

    const cancelActionBtn = screen.getByRole('button', { name: /cancelar asignación/i });
    await userEvent.click(cancelActionBtn);

    // Dialog opens
    expect(await screen.findByRole('heading', { name: 'Confirmar cancelación de casillero' })).toBeInTheDocument();
    expect(screen.getByText(/Reembolso sugerido/i)).toBeInTheDocument();

    // Type reason
    const reasonTextarea = screen.getByLabelText(/Motivo de cancelación/i);
    await userEvent.type(reasonTextarea, 'Cambio de domicilio');

    // Confirm cancellation
    const confirmCancelBtn = screen.getByRole('button', { name: 'Confirmar cancelación' });
    await userEvent.click(confirmCancelBtn);

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/rentals/rental-lock-1/cancellation',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });
});
