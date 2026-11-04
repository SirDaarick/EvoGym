import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Inventory } from '../Inventory';
import { withQuery, createTestQueryClient } from '../../../test/renderWithQuery';

const item = (quantity: number) => ({
  product_id: 'p-1', code: 'p', name: 'Suero', category: 'Bebidas', price_minor: 3500, cost_minor: 1800,
  is_active: true, unit: 'piece', initialized: true, opening_quantity: 20, restocked_quantity: 0,
  waste_quantity: 0, quantity, initialized_at: null,
});

function setup(overrides: { stockFails?: boolean; openFailsOnce?: boolean; unit?: 'scoop' } = {}) {
  let quantity = 20;
  let openFailures = overrides.openFailsOnce ? 1 : 0;
  const keys: string[] = [];
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/inventory/branches') return new Response(JSON.stringify([{ id: 'b1', code: 'c', name: 'Central' }]));
    if (path.includes('/stock?')) {
      if (overrides.stockFails) return new Response(JSON.stringify({ detail: 'Inventario no disponible' }), { status: 500 });
      const base = item(quantity);
      const items = overrides.unit === 'scoop'
        ? [{ ...base, unit: 'scoop', servings_per_container: 30, container_product_id: 'bottle' }]
        : [base];
      return new Response(JSON.stringify({ items, total: 1 }));
    }
    if (path.endsWith('/movements') && init?.method === 'POST') {
      quantity += JSON.parse(String(init.body)).quantity;
      return new Response(JSON.stringify({ id: 'm' }), { status: 201 });
    }
    if (path.endsWith('/open-container')) {
      keys.push(JSON.parse(String(init?.body ?? '{}')).idempotency_key ?? String((init?.headers as Record<string, string> | undefined)?.['Idempotency-Key']));
      if (openFailures-- > 0) return new Response(JSON.stringify({ detail: 'Fallo temporal' }), { status: 503 });
      return new Response(JSON.stringify({ opened: true }), { status: 201 });
    }
    throw new Error(path);
  });
  return { request, keys };
}

const mount = (request: ReturnType<typeof setup>['request']) => {
  const client = createTestQueryClient();
  render(withQuery(<Inventory role="RECEPTION" apiRequest={request} />, client));
  return client;
};

describe('inventory hooks', () => {
  beforeEach(() => sessionStorage.clear());

  it('refetches stock after a movement (invalidation)', async () => {
    const { request } = setup();
    mount(request);
    expect(await screen.findByText('Stock: 20')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar Suero/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));
    expect(await screen.findByText('Recepción de 1 unidad(es) confirmada.')).toBeInTheDocument();
    expect(await screen.findByText('Stock: 21')).toBeInTheDocument();
    expect(request.mock.calls.filter(([p]) => String(p).includes('/stock?')).length).toBeGreaterThanOrEqual(2);
  });

  it('shows an error when listBranchInventory rejects', async () => {
    const { request } = setup({ stockFails: true });
    mount(request);
    expect(await screen.findByRole('alert')).toHaveTextContent('Inventario no disponible');
  });

  it('keeps the container-opening intent after a failure and reuses the same key', async () => {
    const { request, keys } = setup({ openFailsOnce: true, unit: 'scoop' });
    mount(request);
    const button = await screen.findByRole('button', { name: '+1 bote (+30 scoops)' });
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Fallo temporal');
    const stored = sessionStorage.getItem('evogym:container-opening');
    expect(stored).not.toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+1 bote (+30 scoops)' })); });
    expect(await screen.findByText('Bote abierto y porciones agregadas al inventario.')).toBeInTheDocument();
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(JSON.parse(stored!).key);
    expect(sessionStorage.getItem('evogym:container-opening')).toBeNull();
  });
});
