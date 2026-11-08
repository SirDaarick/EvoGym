import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CasillerosModal } from './CasillerosModal';

const branchId = 'branch-001';
const registerId = 'reg-001';

function makeRequest(balance: number, rentals: unknown[] = []) {
  const asset = { id: 'asset-1', branch_id: branchId, kind: 'locker', code: '#01', locker_number: 1, price_minor: 18000, deposit_minor: 0, is_active: true, active_rental_id: rentals.length ? 'r-1' : null };
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (url.includes('/api/v1/rentals/assets')) return json({ items: [asset], total: 1 });
    if (url.includes('/api/v1/rentals?')) return json({ items: rentals, total: rentals.length });
    if (url.includes('/api/v1/members?')) return json({ items: [{ id: 'member-1', full_name: 'Ana Karen', phone: '555' }] });
    if (url === '/api/v1/members/member-1') return json({ id: 'member-1', credit_balance_minor: balance });
    if (url === '/api/v1/rentals/lockers' && init?.method === 'POST') return json({ id: 'r-1', status: 'active', kind: 'locker', asset_code: '#01' }, 201);
    return json({});
  });
}

async function openCheckout() {
  await userEvent.click((await screen.findAllByText('#01'))[0]);
  await userEvent.type(screen.getByRole('combobox', { name: 'Buscar socio activo' }), 'Ana');
  await userEvent.click(await screen.findByText('Ana Karen'));
  await userEvent.click(screen.getByRole('button', { name: /revisar cobro|proceder al cobro/i }));
}

const renderModal = (request: ReturnType<typeof makeRequest>) =>
  render(<CasillerosModal isOpen onClose={vi.fn()} apiRequest={request} branchId={branchId} registerId={registerId} />);

function postBody(request: ReturnType<typeof makeRequest>, url: string) {
  const call = request.mock.calls.find(([u, init]) => u === url && (init as RequestInit | undefined)?.method === 'POST');
  return call ? JSON.parse((call[1] as RequestInit).body as string) : undefined;
}

describe('CasillerosModal saldo a favor', () => {
  it('sends credit_minor on assignment with a partial credit and cash for the rest', async () => {
    const request = makeRequest(5000);
    renderModal(request);
    await openCheckout();
    await userEvent.click(await screen.findByLabelText('Usar saldo a favor'));
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cobro y asignar' }));

    await screen.findByText('Casillero asignado');
    expect(postBody(request, '/api/v1/rentals/lockers')).toMatchObject({
      credit_minor: 5000, components: [{ method: 'cash', amount_minor: 13000 }], accepted_shortfall_minor: 0,
    });
  });

  it('hides the credit tick at balance 0', async () => {
    const request = makeRequest(0);
    renderModal(request);
    await openCheckout();
    await screen.findByRole('radio', { name: 'Efectivo' });
    expect(screen.queryByLabelText('Usar saldo a favor')).not.toBeInTheDocument();
  });

  it('deposits the excess as credit after the assignment', async () => {
    const request = makeRequest(0);
    request.mockImplementation(((impl) => (url: string, init?: RequestInit) =>
      url.endsWith('/member-credit-deposits') ? Promise.resolve(new Response('{}', { status: 201 })) : impl(url, init))(request.getMockImplementation()!));
    renderModal(request);
    await openCheckout();
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(screen.getByLabelText('Monto recibido'), { target: { value: '200' } });
    await userEvent.click(screen.getByLabelText('Dejar $20.00 como saldo a favor'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cobro y asignar' }));

    await screen.findByText('Casillero asignado');
    expect(postBody(request, '/api/v1/rentals/lockers')).toMatchObject({ components: [{ method: 'cash', amount_minor: 18000 }] });
    expect(postBody(request, '/api/v1/registers/reg-001/member-credit-deposits')).toEqual({ member_id: 'member-1', amount_minor: 2000 });
  });
});