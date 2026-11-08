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

describe('CasillerosModal deposits and card (live)', () => {
  const branchId = 'branch-001';
  const registerId = 'reg-001';
  const asset = (over: Record<string, unknown> = {}) => ({
    id: 'asset-lock-1', branch_id: branchId, kind: 'locker', code: '#01', locker_number: 1,
    price_minor: 18000, deposit_minor: 5000, status: 'available', is_active: true, active_rental_id: null, ...over,
  });
  const lockerRental = (over: Record<string, unknown> = {}) => ({
    id: 'rental-lock-1', asset_id: 'asset-lock-1', asset_code: '#01', member_id: 'member-1', member_name: 'Ana Karen',
    status: 'active', kind: 'locker', paid_minor: 18000, outstanding_minor: 0, ends_on: '2026-01-01', lifecycle_status: 'evicted',
    deposit_minor: 5000, deposit_status: 'held', deposit_held_minor: 5000, deposit_refunded_minor: 0,
    deposit_retained_minor: 0, deposit_reason: null, charges: [], ...over,
  });
  function makeRequest(assets: unknown[], rentals: unknown[], extra?: (url: string, init?: RequestInit) => Response | undefined) {
    return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const custom = extra?.(url, init);
      if (custom) return Promise.resolve(custom);
      if (url.includes('/api/v1/rentals/assets')) return Promise.resolve(new Response(JSON.stringify({ items: assets, total: assets.length }), { status: 200 }));
      if (url.includes('/api/v1/rentals?')) return Promise.resolve(new Response(JSON.stringify({ items: rentals, total: rentals.length }), { status: 200 }));
      if (url.includes('/api/v1/members?')) return Promise.resolve(new Response(JSON.stringify({ items: [{ id: 'member-9', full_name: 'Mariana López', phone: '555' }] }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
  }
  const body = (request: ReturnType<typeof makeRequest>, part: string) => {
    const call = request.mock.calls.find(([url, init]) => String(url).includes(part) && (init as RequestInit | undefined)?.method === 'POST');
    return call ? JSON.parse((call[1] as RequestInit).body as string) : undefined;
  };
  const open = (request: ReturnType<typeof makeRequest>, props: Record<string, unknown> = {}) =>
    render(<CasillerosModal isOpen onClose={vi.fn()} apiRequest={request} branchId={branchId} registerId={registerId} {...props} />);

  it('assigns with expected_deposit_minor and shows the cash deposit', async () => {
    const request = makeRequest([asset()], [], (url, init) =>
      url === '/api/v1/rentals/lockers' && init?.method === 'POST'
        ? new Response(JSON.stringify(lockerRental({ id: 'new' })), { status: 201 })
        : undefined);
    open(request);
    await screen.findAllByText('#01');
    await userEvent.type(screen.getByRole('combobox', { name: 'Buscar socio activo' }), 'Mariana');
    await userEvent.click(await screen.findByText('Mariana López'));
    await userEvent.click(screen.getByRole('button', { name: /revisar cobro|proceder al cobro/i }));
    expect(screen.getByText(/cobra en efectivo el depósito reembolsable: \$50\.00 MXN/)).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cobro y asignar' }));
    await screen.findByText('Casillero asignado');
    expect(body(request, '/api/v1/rentals/lockers')).toMatchObject({ expected_deposit_minor: 5000, expected_total_minor: 18000 });
  });

  it.each([[true, 0], [false, 1]])('hasOpenShift=%s shows %i overtime banners at checkout', async (hasOpenShift, banners) => {
    open(makeRequest([asset()], []), { hasOpenShift });
    await screen.findAllByText('#01');
    await userEvent.type(screen.getByRole('combobox', { name: 'Buscar socio activo' }), 'Mariana');
    await userEvent.click(await screen.findByText('Mariana López'));
    await userEvent.click(screen.getByRole('button', { name: /revisar cobro|proceder al cobro/i }));
    expect(screen.queryAllByTestId('overtime-sale-banner')).toHaveLength(banners);
  });

  it('evicts an overdue locker returning the deposit with a retention reason', async () => {
    const request = makeRequest([asset({ active_rental_id: 'rental-lock-1' })], [lockerRental()], (url, init) =>
      url.endsWith('/rental-lock-1/release') && init?.method === 'POST'
        ? new Response(JSON.stringify(lockerRental({ status: 'released' })), { status: 200 })
        : undefined);
    open(request);
    const refund = await screen.findByLabelText(/Monto a devolver en efectivo/);
    await userEvent.clear(refund);
    await userEvent.type(refund, '20');
    await userEvent.click(screen.getByRole('button', { name: 'Desalojar casillero' }));
    expect(await screen.findByText(/Escribe el motivo de la retención/)).toBeInTheDocument();
    expect(body(request, '/release')).toBeUndefined();

    await userEvent.type(screen.getByLabelText(/Motivo de la retención/), 'Candado perdido');
    await userEvent.click(screen.getByRole('button', { name: 'Desalojar casillero' }));
    await screen.findByText('Casillero desalojado');
    expect(body(request, '/release')).toEqual({ register_id: registerId, deposit_refund_minor: 2000, reason: 'Candado perdido' });
  });

  it('explains that cancelling an active locker returns the full deposit', async () => {
    const request = makeRequest([asset({ active_rental_id: 'rental-lock-1' })], [lockerRental({ ends_on: '2099-12-31', lifecycle_status: 'active' })]);
    open(request);
    expect(await screen.findByText(/el depósito se devuelve completo en efectivo/)).toBeVisible();
    expect(screen.queryByLabelText(/Monto a devolver en efectivo/)).not.toBeInTheDocument();
  });

  it('shows ends_on as the branch-local calendar day even when the browser is ahead of UTC', async () => {
    const previous = process.env.TZ;
    process.env.TZ = 'Pacific/Auckland'; // UTC+12/13: '2026-11-30T23:59:59Z' would read as Dec 1
    try {
      const request = makeRequest([asset({ active_rental_id: 'rental-lock-1' })],
        [lockerRental({ ends_on: '2026-11-30', lifecycle_status: 'active' })]);
      open(request);
      expect(await screen.findByText(/Vence: .*30.*nov/i)).toBeVisible();
      expect(screen.queryByText(/Vence: .*1.*dic/i)).not.toBeInTheDocument();
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
  });

  it('uses the server lifecycle_status instead of the browser clock', async () => {
    // ends_on far in the future, yet the server says expired: the badge follows the server.
    const request = makeRequest([asset({ active_rental_id: 'rental-lock-1' })],
      [lockerRental({ ends_on: '2099-12-31', lifecycle_status: 'expired', overdue_days: 3 })]);
    open(request);
    expect(await screen.findByText(/Ana Karen \(Vencido\)/)).toBeVisible();
  });

  it('collects the card portion through a terminal attempt', async () => {
    const charge = { id: 'charge-9', charge_kind: 'initial', amount_minor: 18000, outstanding_minor: 18000, starts_on: '2026-11-04', ends_on: '2026-11-30' };
    const request = makeRequest([asset({ deposit_minor: 0 })], [], (url, init) => {
      if (url === '/api/v1/rentals/lockers' && init?.method === 'POST') {
        return new Response(JSON.stringify(lockerRental({ id: 'new', outstanding_minor: 18000, charges: [charge] })), { status: 201 });
      }
      if (url.endsWith('/charges/charge-9/card-attempts') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'att', status: 'confirmed' }), { status: 200 });
      }
      return undefined;
    });
    open(request);
    await screen.findAllByText('#01');
    await userEvent.type(screen.getByRole('combobox', { name: 'Buscar socio activo' }), 'Mariana');
    await userEvent.click(await screen.findByText('Mariana López'));
    await userEvent.click(screen.getByRole('button', { name: /revisar cobro|proceder al cobro/i }));
    await userEvent.click(screen.getByRole('radio', { name: 'Tarjeta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cobro y asignar' }));
    await screen.findByText('Casillero asignado');
    expect(body(request, '/api/v1/rentals/lockers')).toMatchObject({ components: [], accepted_shortfall_minor: 18000 });
    expect(body(request, '/card-attempts')).toEqual({ register_id: registerId, amount_minor: 18000 });
  });
});
