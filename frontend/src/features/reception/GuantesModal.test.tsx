import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GuantesModal } from './GuantesModal';

const branchId = 'branch-001';
const registerId = 'reg-001';

const glove = (over: Record<string, unknown> = {}) => ({
  id: 'asset-1', branch_id: branchId, kind: 'glove', code: '#01', color: 'Rojo', ounces: 12,
  price_minor: 2500, deposit_minor: 0, status: 'available', is_active: true, active_rental_id: null, ...over,
});

const rental = (over: Record<string, unknown> = {}) => ({
  id: 'rental-1', asset_id: 'asset-2', asset_code: '#02', member_id: 'member-2', member_name: 'Carlos Rivera',
  status: 'active', kind: 'glove', paid_minor: 2500, outstanding_minor: 0, created_at: '2026-11-04T15:00:00Z',
  deposit_minor: 0, deposit_status: 'none', deposit_held_minor: 0, deposit_refunded_minor: 0,
  deposit_retained_minor: 0, deposit_reason: null, charges: [], ...over,
});

function makeRequest(assets: unknown[], rentals: unknown[], extra?: (url: string, init?: RequestInit) => Response | undefined) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const custom = extra?.(url, init);
    if (custom) return Promise.resolve(custom);
    if (url.includes('/api/v1/rentals/assets')) {
      return Promise.resolve(new Response(JSON.stringify({ items: assets, total: assets.length }), { status: 200 }));
    }
    if (url.includes('/api/v1/rentals?')) {
      return Promise.resolve(new Response(JSON.stringify({ items: rentals, total: rentals.length }), { status: 200 }));
    }
    if (url.includes('/api/v1/members?')) {
      return Promise.resolve(new Response(JSON.stringify({ items: [{ id: 'member-9', full_name: 'Mariana López', phone: '555' }] }), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
}

function renderModal(apiRequest: ReturnType<typeof makeRequest>, props: Record<string, unknown> = {}) {
  return render(
    <GuantesModal isOpen onClose={vi.fn()} apiRequest={apiRequest} branchId={branchId} registerId={registerId} {...props} />
  );
}

async function assignMember() {
  await userEvent.type(screen.getByRole('combobox', { name: 'Buscar socio activo' }), 'Mariana');
  await userEvent.click(await screen.findByText('Mariana López'));
  await userEvent.click(screen.getByRole('button', { name: /revisar cobro|proceder al cobro/i }));
}

function postBody(apiRequest: ReturnType<typeof makeRequest>, urlPart: string) {
  const call = apiRequest.mock.calls.find(([url, init]) => String(url).includes(urlPart) && (init as RequestInit | undefined)?.method === 'POST');
  return call ? JSON.parse((call[1] as RequestInit).body as string) : undefined;
}

describe('GuantesModal (live only)', () => {
  it('renders server gloves with available and rented states and no demo data', async () => {
    const request = makeRequest(
      [glove(), glove({ id: 'asset-2', code: '#02', color: 'Negro', ounces: 14, active_rental_id: 'rental-1' })],
      [rental()]
    );
    renderModal(request);

    expect(await screen.findByText('#01 · Rojo · 12 oz')).toBeVisible();
    const card02 = screen.getByText('#02 · Negro · 14 oz').closest('button');
    expect(card02).toHaveTextContent('Carlos Rivera');
    expect(card02).toHaveTextContent('En uso');
    expect(screen.getAllByRole('button').filter(b => b.classList.contains('guante-card'))).toHaveLength(2);
  });

  it('flags only the glove rentals the server marks overdue', async () => {
    const request = makeRequest(
      [glove(), glove({ id: 'asset-2', code: '#02', active_rental_id: 'rental-1' }),
        glove({ id: 'asset-3', code: '#03', active_rental_id: 'rental-3' })],
      [rental({ overdue: true }), rental({ id: 'rental-3', asset_id: 'asset-3', overdue: false })]
    );
    renderModal(request);

    await screen.findByText('#01 · Rojo · 12 oz');
    expect(screen.getAllByText('Sin devolver (de otro día)')).toHaveLength(1);
    expect(screen.getByText('#02 · Rojo · 12 oz').closest('button')).toHaveTextContent('Sin devolver');
  });

  it('does not render when closed and closes with button and Escape', async () => {
    const onClose = vi.fn();
    const request = makeRequest([glove()], []);
    const { rerender } = render(
      <GuantesModal isOpen onClose={onClose} apiRequest={request} branchId={branchId} registerId={registerId} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar modal de guantes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(<GuantesModal isOpen={false} onClose={onClose} apiRequest={request} branchId={branchId} registerId={registerId} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the cash deposit to collect and sends expected_deposit_minor when renting', async () => {
    const request = makeRequest([glove({ deposit_minor: 20000 })], [], (url, init) =>
      url === '/api/v1/rentals/gloves' && init?.method === 'POST'
        ? new Response(JSON.stringify(rental({ id: 'new', deposit_status: 'held', deposit_held_minor: 20000 })), { status: 201 })
        : undefined
    );
    renderModal(request);
    await screen.findByText('#01 · Rojo · 12 oz');
    await assignMember();

    expect(screen.getByText(/cobra en efectivo el depósito reembolsable: \$200\.00 MXN/)).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cobro y entregar' }));

    await screen.findByText('Renta confirmada');
    expect(postBody(request, '/api/v1/rentals/gloves')).toMatchObject({
      expected_total_minor: 2500,
      expected_deposit_minor: 20000,
      register_id: registerId,
      components: [{ method: 'cash', amount_minor: 2500 }],
    });
  });

  it('shows a Spanish message when the backend rejects a stale deposit (409)', async () => {
    const request = makeRequest([glove({ deposit_minor: 20000 })], [], (url, init) =>
      url === '/api/v1/rentals/gloves' && init?.method === 'POST'
        ? new Response(JSON.stringify({ detail: 'Expected deposit does not match the asset deposit.' }), { status: 409 })
        : undefined
    );
    renderModal(request);
    await screen.findByText('#01 · Rojo · 12 oz');
    await assignMember();
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cobro y entregar' }));

    expect(await screen.findByText(/depósito cambió/)).toBeInTheDocument();
  });

  it('rents with card by creating the rental with pending balance and starting a terminal attempt', async () => {
    const charge = { id: 'charge-1', charge_kind: 'initial', amount_minor: 2500, outstanding_minor: 2500, starts_on: '2026-11-04', ends_on: '2026-11-04' };
    const request = makeRequest([glove()], [], (url, init) => {
      if (url === '/api/v1/rentals/gloves' && init?.method === 'POST') {
        return new Response(JSON.stringify(rental({ id: 'new', outstanding_minor: 2500, charges: [charge] })), { status: 201 });
      }
      if (url.endsWith('/charges/charge-1/card-attempts') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'att-1', status: 'confirmed', rental_id: 'new', charge_id: 'charge-1', amount_minor: 2500 }), { status: 200 });
      }
      return undefined;
    });
    renderModal(request);
    await screen.findByText('#01 · Rojo · 12 oz');
    await assignMember();
    await userEvent.click(screen.getByRole('radio', { name: 'Tarjeta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cobro y entregar' }));

    await screen.findByText('Renta confirmada');
    expect(postBody(request, '/api/v1/rentals/gloves')).toMatchObject({ components: [], accepted_shortfall_minor: 2500 });
    expect(postBody(request, '/card-attempts')).toEqual({ register_id: registerId, amount_minor: 2500 });
  });

  it('warns when the card attempt is not confirmed', async () => {
    const charge = { id: 'charge-1', charge_kind: 'initial', amount_minor: 2500, outstanding_minor: 2500, starts_on: '2026-11-04', ends_on: '2026-11-04' };
    const request = makeRequest([glove()], [], (url, init) => {
      if (url === '/api/v1/rentals/gloves' && init?.method === 'POST') {
        return new Response(JSON.stringify(rental({ id: 'new', outstanding_minor: 2500, charges: [charge] })), { status: 201 });
      }
      if (url.endsWith('/card-attempts') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'att-1', status: 'failed', failure_reason: 'Rechazada' }), { status: 200 });
      }
      return undefined;
    });
    renderModal(request);
    await screen.findByText('#01 · Rojo · 12 oz');
    await assignMember();
    await userEvent.click(screen.getByRole('radio', { name: 'Tarjeta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cobro y entregar' }));

    expect(await screen.findByText('Renta registrada con saldo pendiente')).toBeInTheDocument();
    expect(screen.getByText(/Rechazada/)).toBeInTheDocument();
  });

  it('returns gloves with full deposit refund by default', async () => {
    const held = rental({ deposit_status: 'held', deposit_minor: 20000, deposit_held_minor: 20000 });
    const request = makeRequest([glove({ id: 'asset-2', code: '#02', active_rental_id: 'rental-1' })], [held], (url, init) =>
      url.endsWith('/rental-1/return') && init?.method === 'POST'
        ? new Response(JSON.stringify(rental({ status: 'returned' })), { status: 200 })
        : undefined
    );
    renderModal(request);
    await screen.findByText('Retenido (en custodia)');
    expect(screen.getByLabelText(/Monto a devolver en efectivo/)).toHaveValue(200);
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como devuelto' }));

    await screen.findByText('Guantes devueltos');
    expect(postBody(request, '/rental-1/return')).toEqual({ register_id: registerId, deposit_refund_minor: 20000 });
  });

  it('requires a reason when refunding less than the held deposit, then sends it', async () => {
    const held = rental({ deposit_status: 'held', deposit_minor: 20000, deposit_held_minor: 20000 });
    const request = makeRequest([glove({ id: 'asset-2', code: '#02', active_rental_id: 'rental-1' })], [held], (url, init) =>
      url.endsWith('/rental-1/return') && init?.method === 'POST'
        ? new Response(JSON.stringify(rental({ status: 'returned' })), { status: 200 })
        : undefined
    );
    renderModal(request);
    const refund = await screen.findByLabelText(/Monto a devolver en efectivo/);
    await userEvent.clear(refund);
    await userEvent.type(refund, '150');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como devuelto' }));

    expect(await screen.findByText(/Escribe el motivo de la retención/)).toBeInTheDocument();
    expect(postBody(request, '/rental-1/return')).toBeUndefined();

    await userEvent.type(screen.getByLabelText(/Motivo de la retención/), 'Guante dañado');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como devuelto' }));
    await screen.findByText('Guantes devueltos');
    expect(postBody(request, '/rental-1/return')).toEqual({
      register_id: registerId, deposit_refund_minor: 15000, reason: 'Guante dañado',
    });
  });

  it('rejects a refund above the held amount without calling the API', async () => {
    const held = rental({ deposit_status: 'held', deposit_minor: 20000, deposit_held_minor: 20000 });
    const request = makeRequest([glove({ id: 'asset-2', code: '#02', active_rental_id: 'rental-1' })], [held]);
    renderModal(request);
    const refund = await screen.findByLabelText(/Monto a devolver en efectivo/);
    await userEvent.clear(refund);
    await userEvent.type(refund, '250');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como devuelto' }));
    expect(await screen.findByText(/No puedes devolver más de \$200\.00 MXN/)).toBeInTheDocument();
    expect(postBody(request, '/rental-1/return')).toBeUndefined();
  });

  it('returns without a body and without deposit section when no deposit is held', async () => {
    const request = makeRequest([glove({ id: 'asset-2', code: '#02', active_rental_id: 'rental-1' })], [rental()], (url, init) =>
      url.endsWith('/rental-1/return') && init?.method === 'POST'
        ? new Response(JSON.stringify(rental({ status: 'returned' })), { status: 200 })
        : undefined
    );
    renderModal(request);
    await screen.findByRole('button', { name: 'Marcar como devuelto' });
    expect(screen.queryByText('Depósito reembolsable')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como devuelto' }));
    await screen.findByText('Guantes devueltos');
    const call = request.mock.calls.find(([url]) => String(url).endsWith('/rental-1/return'))!;
    expect((call[1] as RequestInit).body).toBeUndefined();
  });

  it('lets an admin edit the deposit only while the asset is free', async () => {
    const request = makeRequest(
      [glove({ deposit_minor: 10000 }), glove({ id: 'asset-2', code: '#02', active_rental_id: 'rental-1' })],
      [rental()],
      (url, init) => url.endsWith('/assets/asset-1') && init?.method === 'PATCH'
        ? new Response(JSON.stringify(glove({ deposit_minor: 30000 })), { status: 200 })
        : undefined
    );
    renderModal(request, { isAdmin: true });
    await screen.findByText('#01 · Rojo · 12 oz');
    await userEvent.click(screen.getByRole('button', { name: /Gestionar activos/ }));

    await userEvent.type(screen.getByLabelText(/Nuevo depósito reembolsable/), '300');
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar depósito' }));
    await waitFor(() => expect(screen.getByText('Depósito actualizado')).toBeInTheDocument());
    const patch = request.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ deposit_minor: 30000 });

    await userEvent.click(screen.getByText('#02 · Rojo · 12 oz').closest('button')!);
    expect(screen.getByLabelText(/Nuevo depósito reembolsable/)).toBeDisabled();
    expect(screen.getByText(/Solo se edita con el activo libre/)).toBeVisible();
  });
});

describe('GuantesModal saldo a favor', () => {
  const withMember = (balance: number, extra?: (url: string, init?: RequestInit) => Response | undefined) =>
    makeRequest([glove()], [], (url, init) => {
      if (url === '/api/v1/members/member-9') return new Response(JSON.stringify({ id: 'member-9', credit_balance_minor: balance }), { status: 200 });
      if (url === '/api/v1/rentals/gloves' && init?.method === 'POST') return new Response(JSON.stringify(rental({ id: 'new' })), { status: 201 });
      return extra?.(url, init);
    });

  it('applies credit and sends credit_minor with no components when it covers the total', async () => {
    const request = withMember(5000);
    renderModal(request);
    await screen.findByText('#01 · Rojo · 12 oz');
    await assignMember();
    await userEvent.click(await screen.findByLabelText('Usar saldo a favor'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cobro y entregar' }));

    await screen.findByText('Renta confirmada');
    expect(postBody(request, '/api/v1/rentals/gloves')).toMatchObject({
      components: [], credit_minor: 2500, accepted_shortfall_minor: 0,
    });
  });

  it('hides the credit tick at balance 0 and sends no credit_minor', async () => {
    const request = withMember(0);
    renderModal(request);
    await screen.findByText('#01 · Rojo · 12 oz');
    await assignMember();
    await screen.findByRole('radio', { name: 'Efectivo' });
    expect(screen.queryByLabelText('Usar saldo a favor')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cobro y entregar' }));
    await screen.findByText('Renta confirmada');
    expect(postBody(request, '/api/v1/rentals/gloves')).not.toHaveProperty('credit_minor');
  });

  it('deposits the excess as credit after the rental and warns when the deposit fails', async () => {
    const request = withMember(0, (url, init) =>
      url.endsWith('/member-credit-deposits') && init?.method === 'POST'
        ? new Response(JSON.stringify({ detail: 'boom' }), { status: 500 })
        : undefined
    );
    renderModal(request);
    await screen.findByText('#01 · Rojo · 12 oz');
    await assignMember();
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    fireEvent.change(screen.getByLabelText('Monto recibido'), { target: { value: '30' } });
    await userEvent.click(screen.getByLabelText('Dejar $5.00 como saldo a favor'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cobro y entregar' }));

    expect(await screen.findByText(/Puedes agregarlo desde el perfil del socio/)).toBeInTheDocument();
    expect(postBody(request, '/api/v1/rentals/gloves')).toMatchObject({ components: [{ method: 'cash', amount_minor: 2500 }] });
    expect(postBody(request, '/member-credit-deposits')).toEqual({ member_id: 'member-9', amount_minor: 500 });
  });
});