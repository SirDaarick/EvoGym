import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiReceptionHome } from '@/app/ApiReceptionHome';
import { renderWithQuery } from '@/test/renderWithQuery';

const register = { id: 'register', branch_id: 'branch', code: 'front', name: 'Front', status: 'active', has_open_shift: true };
const water = { product_id: 'product', name: 'Water', price_minor: 500, quantity: 5, initialized: true, is_active: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function makeRequest(extra: (path: string) => Response | undefined = () => undefined) {
  return vi.fn(async (path: string) => {
    const custom = extra(path);
    if (custom) return custom;
    if (path === '/api/v1/registers/product-sale-intent') return json(null);
    if (path.endsWith('/product-sale-intent')) return json({});
    if (path === '/api/v1/registers') return json([register]);
    if (path === '/api/v1/inventory/branches') return json([{ id: 'branch', name: 'Central' }]);
    if (path.startsWith('/api/v1/inventory/branches/')) return json({ items: [water], total: 1 });
    if (path.endsWith('/product-sales/resolve')) return json({ status: 'completed', order_id: 'order', total_minor: 500 });
    if (path.endsWith('/product-sales')) return json({ order: { id: 'order', total_minor: 500 }, items: [], payment: { id: 'p', method: 'cash', status: 'confirmed', amount_minor: 500 } }, 201);
    throw new Error(path);
  });
}
const count = (request: ReturnType<typeof makeRequest>, match: (path: string) => boolean) =>
  request.mock.calls.filter(([path]) => match(path)).length;

describe('ApiReceptionHome data flow', () => {
  beforeEach(() => sessionStorage.clear());

  it('refetches stock after a successful sale', async () => {
    const request = makeRequest();
    renderWithQuery(<ApiReceptionHome request={request} actorId="actor" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Seleccionar Water' }, { timeout: 5000 }));
    const stockCalls = () => count(request, path => path.startsWith('/api/v1/inventory/branches/'));
    expect(stockCalls()).toBe(1);
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Realizar cobro' }));
    expect(await screen.findByText('Compra registrada.')).toBeVisible();
    await vi.waitFor(() => expect(stockCalls()).toBe(2));
  }, 15000);

  it('issues a single debounced request for a typed member search', async () => {
    const request = makeRequest(path => path.startsWith('/api/v1/members?')
      ? json({ items: [{ id: 'm-1', full_name: 'John Doe', phone: '555' }], total: 1, page: 1, limit: 20, pages: 1 }) : undefined);
    renderWithQuery(<ApiReceptionHome request={request} actorId="actor" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Seleccionar Water' }, { timeout: 5000 }));
    await userEvent.type(screen.getByLabelText('Asignar socio'), 'John');
    expect(await screen.findByRole('button', { name: 'John Doe' })).toBeVisible();
    const searches = request.mock.calls.filter(([path]) => path.startsWith('/api/v1/members?'));
    expect(searches).toHaveLength(1);
    expect(searches[0][0]).toContain('search=John');
  }, 15000);

  it('recovers a pending intent and the assigned member name', async () => {
    const saved = { key: 'remote', registerId: 'register', payload: { member_id: 'm-9', items: [{ product_id: 'product', quantity: 1 }], expected_total_minor: 500 } };
    const request = makeRequest(path => {
      if (path === '/api/v1/registers/product-sale-intent') return json(saved);
      if (path === '/api/v1/members/m-9') return json({ id: 'm-9', full_name: 'Ana Pérez' });
      return undefined;
    });
    renderWithQuery(<ApiReceptionHome request={request} actorId="actor" />);
    expect(await screen.findByRole('button', { name: 'Resolver compra pendiente' })).toBeVisible();
    expect(await screen.findByText(/Socio: Ana Pérez/)).toBeVisible();
    expect(JSON.parse(sessionStorage.getItem('evogym:product-sale:actor') ?? 'null')).toBeNull();
    expect(count(request, path => path.endsWith('/product-sales'))).toBe(0);
  }, 15000);
});
